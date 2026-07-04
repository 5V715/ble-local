# ESP32 Hub Firmware — Design

## Summary

Firmware for a cheap BLE peripheral (ESP32 DevKit classic) that acts as the
"dumb relay hub" the [BLE local chat client design](2026-07-04-ble-local-chat-design.md)
depends on. Every participant's browser connects to this one physical device
as a BLE central. The hub relays opaque encrypted bytes between connected
clients — it never touches keys, signatures, or plaintext — and manages
short-ID assignment, presence announcements, and connection-limit handling
for the group.

This plan also includes a small, tightly-coupled patch to the already-shipped
client (`src/transport/ble-protocol.ts` and `WebBluetoothTransport` in the
`ble-local` repo's `main` branch): the client currently has no way to learn
its own hub-assigned short ID over real BLE, which the client plan explicitly
flagged as a blocking prerequisite for real Bluetooth chat to work at all.

## Background: the protocol contract this firmware must implement

The client SPA (already built and merged) defines the GATT layout and relay
semantics this firmware must match exactly. From
`src/transport/ble-protocol.ts` on `main`:

```ts
export const HUB_SERVICE_UUID = '7b4a1000-8a2b-4c3d-9e8f-1123456789ab'
export const INBOX_CHARACTERISTIC_UUID = '7b4a1001-8a2b-4c3d-9e8f-1123456789ab'
export const OUTBOX_CHARACTERISTIC_UUID = '7b4a1002-8a2b-4c3d-9e8f-1123456789ab'

export const SYSTEM_FRAME_MEMBER_LIST = 0xf0
export const SYSTEM_FRAME_MEMBER_JOINED = 0xf1
export const SYSTEM_FRAME_MEMBER_LEFT = 0xf2
```

Clients write application frames to `inbox` and subscribe to `outbox`
notifications. Every application frame's first three bytes are (per
`src/protocol/framing.ts`): `msgType`(1) `senderShortId`(1)
`recipientShortId`(1), followed by a 4-byte sequence number, chunk index,
chunk count, and a 2-byte payload length before the payload itself. The hub
only ever needs to read **one byte — offset 2, the recipient short ID**
(`0xff` means broadcast) — to decide where to relay. It never needs to
understand `msgType`, sequence numbers, or chunking; that's entirely a
client-side concern.

This design adds one new sentinel value to that contract:

```ts
export const SYSTEM_FRAME_YOUR_ID = 0xf3
```

Sent by the hub to a newly-connected client, addressed only to that
connection, containing its just-assigned short ID. Nothing today emits or
consumes this value; both firmware and client need the matching halves.

## Scope

In scope:
- ESP32 (DevKit classic) firmware: BLE peripheral, GATT layout matching the
  client's existing constants, connection-table management, byte-level
  relay, system-frame emission (`member_list`/`member_joined`/`member_left`,
  plus the new `your_id`), advertising pause/resume at capacity.
- Client patch: add `SYSTEM_FRAME_YOUR_ID` to `ble-protocol.ts`, and update
  `WebBluetoothTransport`'s notification handler to set `_myShortId` when
  it receives this frame.
- Toolchain: PlatformIO, Arduino framework, NimBLE-Arduino library.

Out of scope (documented limitations / future work, not this plan):
- Multi-hub mesh (a room is still capped by one hub's connection table size).
- Any hub-side persistence, identity, or cryptography — the hub remains a
  dumb relay by design.
- Automated firmware unit tests (see Testing) — validated via manual
  hardware testing instead, given the relay logic's small surface area.
- OTA firmware updates, power management, or any hardware beyond a single
  ESP32 DevKit board.

## Architecture

```
┌─────────────┐                    ┌──────────────┐
│ Chrome SPA  │◄──── BLE GATT ────►│  ESP32 Hub   │
│ (Device A)  │                    │ (NimBLE-     │
└─────────────┘                    │  Arduino)    │
                                    │              │
┌─────────────┐                    │ Fixed slot   │
│ Chrome SPA  │◄──── BLE GATT ────►│ table (N=7)  │
│ (Device B)  │                    └──────────────┘
└─────────────┘
```

A single BLE peripheral exposes one GATT service with the `inbox`
(write)/`outbox` (notify) characteristics already fixed by the client. A
fixed-size slot array (`N = 7`, a compile-time constant) maps each active
BLE connection handle to an assigned short ID (1-`N`; `0` and `0xff` are
reserved/broadcast and never assigned). Relay logic is table-driven and
content-blind: on an `inbox` write, it reads the recipient byte at offset 2
of the incoming frame and forwards the byte array — completely untouched —
to the matching slot's `outbox` (unicast) or every other occupied slot's
`outbox` (broadcast, when the recipient byte is `0xff`). Nothing else in the
frame is parsed. The firmware never sees keys, signatures, or plaintext.

**Technical risk to resolve first, not assume:** it is not yet confirmed
whether NimBLE-Arduino's `notify()` can target one specific connection
directly, or whether it always notifies every subscribed central at once.
This matters for `SYSTEM_FRAME_YOUR_ID`, `member_list`, and any
`DIRECT_MESSAGE`/`KEY_PACKAGE` relay, all of which require unicast to
exactly one connection. The first implementation task is a minimal spike
that connects two centrals and confirms per-connection notify targeting
works as expected, before any relay logic is built on top of that
assumption. If the Arduino wrapper doesn't expose this directly, the
fallback is dropping to the lower-level NimBLE host API
(`ble_gatts_notify_custom` or equivalent) that PlatformIO's NimBLE component
exposes underneath the Arduino wrapper.

## Components

- **Connection table** — a fixed array of `N` slots
  (`{occupied: bool, connHandle: uint16_t, shortId: uint8_t}`). Linear scan
  for a free slot on connect; the slot is cleared on disconnect. No heap
  allocation — everything is a static array sized at compile time.
- **BLE server setup** — GATT service registration, `inbox`/`outbox`
  characteristics, and NimBLE server connect/disconnect callbacks that drive
  the connection table.
- **Relay dispatcher** — invoked from the `inbox` write callback: reads the
  recipient byte, looks up the matching slot(s), and calls the per-connection
  notify primitive with the untouched byte array.
- **System frame sender** — small helper that builds and sends each of the
  four system frame types (`your_id`, `member_list`, `member_joined`,
  `member_left`) to the correct target (unicast for `your_id`/`member_list`,
  broadcast-to-others for `member_joined`/`member_left`).
- **Advertising control** — starts advertising on boot; stops the instant
  the table has zero free slots; resumes on the next disconnect.

## Data flow

**New connection:**
1. NimBLE connect callback fires. Assign the first free slot and short ID.
2. Send `SYSTEM_FRAME_YOUR_ID` (unicast, this connection only) containing
   the assigned short ID.
3. Send `SYSTEM_FRAME_MEMBER_LIST` (unicast, this connection only)
   containing every *other* currently-occupied slot's short ID (matching
   the client's `MockHubTransport` semantics: a member list represents
   others, never yourself).
4. Broadcast `SYSTEM_FRAME_MEMBER_JOINED` (this new short ID) to every other
   occupied slot.
5. If the table is now full (zero free slots), stop advertising.

**Inbox write received:**
1. Read byte offset 2 (the recipient short ID) from the written value.
2. If `0xff`, relay the full, untouched byte array via `outbox` notify to
   every other occupied slot.
3. Otherwise, relay it only to the slot whose assigned short ID matches. If
   no slot matches (stale reference racing a disconnect), drop silently.

**Disconnect:**
1. NimBLE disconnect callback fires (any reason code, handled uniformly).
2. Free that slot.
3. Broadcast `SYSTEM_FRAME_MEMBER_LEFT` (the freed short ID) to all
   remaining occupied slots.
4. If advertising had been stopped (table was full), resume it.

**Room full:** covered by step 5 above — the hub simply isn't advertising
while full, so a scanning client won't see it at all until a slot frees up.

## Error handling

- **Table full:** no advertising while full, so there's no connection
  attempt to reject in the first place — matches the "pause advertising"
  choice over "advertise but reject."
- **Malformed/too-short `inbox` write** (fewer than 3 bytes — can't even
  read the recipient byte): dropped silently. The hub has no meaningful way
  to signal an error back at this layer; frame correctness is entirely the
  client's responsibility.
- **Recipient byte matches no current slot:** dropped silently.
- **Unexpected disconnects** (any BLE disconnect reason code): handled
  identically to a clean disconnect.

## Testing

- **Compile check:** `pio run` targeting the `esp32dev` board — verifiable
  without physical hardware attached, and will be run as part of
  implementation.
- **Manual hardware verification** (run by the user, on their own machine —
  this development environment has no physical ESP32 attached): serial
  monitor log lines for connect/assign/relay/disconnect events; a real
  multi-device test using the already-deployed web client (multiple
  tabs/phones in "Bluetooth hub" mode) confirming group and 1:1 messages
  relay correctly, roster updates propagate on disconnect, and an
  `N+1`th device stops appearing in Chrome's Bluetooth device picker once
  the table is full.
- **No automated unit tests for the firmware itself.** The relay logic's
  surface area is small enough (peek one byte, forward bytes, manage a
  fixed-size table) that embedded C++ unit testing (PlatformIO + Unity)
  would be disproportionate scope here; validated instead via the manual
  hardware test above. Matches the same scope call made for the client's
  UI layer (Task 10 of the client plan), which also has no automated tests.

## Client-side patch (included in this plan's scope)

- `src/transport/ble-protocol.ts`: add
  `export const SYSTEM_FRAME_YOUR_ID = 0xf3`.
- `src/transport/web-bluetooth-transport.ts`: in the notification handler
  that currently branches on `SYSTEM_FRAME_MEMBER_LIST` /
  `SYSTEM_FRAME_MEMBER_JOINED` / `SYSTEM_FRAME_MEMBER_LEFT`, add a branch for
  `SYSTEM_FRAME_YOUR_ID` that sets `this._myShortId` to the byte following
  the sentinel.
- This directly resolves the blocking gap the client plan flagged: without
  it, `ChatController`'s recipient-scoping checks (which compare a frame's
  `recipientShortId` against `transport.myShortId`) can never match on a
  real BLE connection, so a real device could never receive its room key or
  any direct message.

## Open questions / future work

- Multi-hub mesh support for rooms larger than one hub's connection table.
- Whether NimBLE-Arduino's per-connection notify targeting works as assumed
  (see the "Technical risk" note in Architecture) — resolved by the first
  implementation task's spike, not deferred to "someday."
- Automated firmware testing, if this hub design grows more complex than a
  byte-relay in the future.
