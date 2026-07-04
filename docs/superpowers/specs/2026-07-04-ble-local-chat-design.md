# BLE Local Chat — Design

## Summary

A static single-page app (SPA), deployed to GitHub Pages, that lets people
physically near each other chat over Bluetooth Low Energy (BLE) — with no
internet connection, no backend server, and end-to-end encrypted messages.
Chrome (desktop or Android) is the only supported browser, since the design
depends on the Web Bluetooth API.

Group chat and private 1:1 threads are both supported, and both use BLE as
the sole transport.

## Background: why this needs a hub device

Chrome's Web Bluetooth API only implements the BLE **central/client** role:
a page can scan for and connect to an existing BLE peripheral, but it cannot
make itself discoverable or act as a peripheral/GATT server. There is also no
API for a webpage to broadcast BLE advertisements. This means two browser
tabs cannot discover each other or connect to each other directly over
Bluetooth — there is no "browser-to-browser BLE" in Chrome today.

Sources confirming this (checked 2026-07-04):
- https://developer.chrome.com/docs/capabilities/bluetooth
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API
- https://github.com/WebBluetoothCG/web-bluetooth/blob/main/implementation-status.md
- https://chromestatus.com/feature/5180688812736512

To get real Bluetooth chat, this project includes a small piece of dedicated
hardware — a **hub** — that acts as the BLE peripheral. Every participant's
browser connects to the same physical hub as a BLE central. The hub is a
dumb relay: it forwards opaque encrypted bytes between connected clients and
never has the ability to read message contents.

## Scope

In scope:
- Browser SPA client (GitHub Pages, static hosting, no backend)
- ESP32 hub firmware (BLE peripheral / relay)
- End-to-end encrypted group chat and 1:1 private threads, both over BLE via
  the hub
- Per-device persistent identity (keypairs stored client-side)
- Text-only messages

Out of scope (documented limitations / future work, not MVP):
- Images/attachments/voice
- Message delivery acknowledgements / guaranteed delivery
- Group key rotation on member departure (see "Key lifecycle" below —
  rotation happens naturally at room-empty, not on individual leave)
- Multi-hub mesh (a room is capped by one hub's BLE connection limit,
  targeted at ~6-8 simultaneous devices on an ESP32)
- Browsers other than Chrome/Chromium (Web Bluetooth is not implemented
  elsewhere)

## Architecture

```
┌─────────────┐  BLE (GATT)  ┌──────────────┐  BLE (GATT)  ┌─────────────┐
│ Chrome SPA  │◄────────────►│  ESP32 Hub   │◄────────────►│ Chrome SPA  │
│ (Device A)  │              │ (dumb relay) │              │ (Device B)  │
└─────────────┘              └──────────────┘              └─────────────┘
                                    ▲
                                    │ BLE (GATT)
                                    ▼
                             ┌─────────────┐
                             │ Chrome SPA  │
                             │ (Device C)  │
                             └─────────────┘
```

- **Client (GitHub Pages SPA):** pure static site, uses Web Bluetooth as a
  GATT central. Owns all identity, cryptography, room/roster state, and UI.
  No backend, no build-time secrets, no server-side component at all.
- **Hub (ESP32 firmware):** a single BLE peripheral exposing one GATT
  service with two characteristics:
  - `inbox` (write) — clients write outgoing frames here
  - `outbox` (notify) — clients subscribe to receive incoming frames
  The hub inspects only a small routing header on each frame (recipient
  short ID: a specific device, or broadcast) and forwards the remaining
  opaque payload accordingly. It never touches keys or plaintext.
- **Trust boundary:** the hub is untrusted for confidentiality (it's a
  relay, not a participant in the conversation) but trusted for
  availability/routing. A malicious or compromised hub could drop, delay,
  or reorder messages, or attempt to man-in-the-middle the very first
  key exchange — the optional safety-number verification (below) exists to
  detect the latter.

Rationale for keeping the hub "dumb": all interesting logic (identity,
crypto, room/roster bookkeeping) lives in the browser client, where it's
fast to iterate on and easy to unit test. Firmware changes require
physically reflashing every hub in the field, so firmware is kept as small
and stable as possible. A design where the hub tracks roster/session state
itself was considered and rejected for this reason.

## Components

### Client-side (browser SPA)

- **BLE Connection Manager** — wraps Web Bluetooth: `requestDevice`,
  connects to the hub's GATT service, negotiates MTU, subscribes to
  `outbox`. Retains the granted `BluetoothDevice` reference so that
  reconnecting after a drop does not require a new user gesture.
- **Identity Manager** — on first use, generates an Ed25519 signing
  keypair and an X25519 DH keypair via WebCrypto, persisted in IndexedDB so
  identity survives across sessions. Exposes a short fingerprint for
  safety-number verification.
- **Roster Manager** — tracks currently connected members: the hub-assigned
  short IDs, and the public keys/nicknames learned via presence broadcasts.
- **Group Key Manager** — implements a simplified sender-keys scheme:
  - The first device present in an otherwise-empty room mints a random
    256-bit room key.
  - Each subsequent joiner receives the room key from an existing member:
    the existing member performs ECDH with the joiner's X25519 public key,
    uses the resulting secret to AES-GCM-wrap the room key, and addresses
    the wrapped key 1:1 to the joiner via the hub. If multiple existing
    members race to do this, the joiner accepts the first valid delivery
    and discards duplicates.
  - **Key lifecycle:** the room key's lifetime is tied to room occupancy,
    not individual departures. It lives as long as at least one member has
    remained continuously connected since it was created. Once the hub
    goes idle (zero connected devices), the next joiner starts a fresh
    room — mints a brand-new key rather than requesting the old one. This
    is a deliberate, documented simplification: a member who leaves and
    later reconnects while others are still present will still be handed
    the *same* room key that was live before they left (no revocation on
    leave), but there is no way to decrypt anything from a room that fully
    emptied out and restarted.
- **Crypto Engine** — WebCrypto primitives: AES-GCM for message
  confidentiality, X25519 for ECDH, Ed25519 for signing every outgoing
  message (so recipients can verify sender authenticity even though the
  hub itself does no authentication).
- **Framing/Chunking** — BLE ATT writes/notifications are limited in size
  (roughly 20-500 bytes depending on negotiated MTU). A small envelope
  (message type, sender short ID, recipient short ID or broadcast marker,
  chunk index/count, per-sender sequence number) fragments larger encrypted
  payloads for transmission and reassembles them on receipt.
- **Chat UI** — group room view, 1:1 thread view, member list with
  safety-number verification affordance.

### Hub firmware (ESP32)

- One BLE GATT service with `inbox` (write) and `outbox` (notify)
  characteristics.
- Maintains only a session-local table mapping BLE connection handles to
  small numeric IDs (assigned on connect, freed on disconnect) — used
  purely for routing. Stores no identity/key material and no message
  content.
- On connect: assigns a short ID, notifies existing clients of the new ID
  via a `member_joined` system frame, and tells the newcomer the current
  set of connected short IDs via a `member_list` system frame.
- On disconnect: notifies remaining clients via a `member_left` system
  frame.
- On receiving a frame on `inbox`: reads the recipient field and relays the
  remaining opaque bytes via `outbox` notification(s) to either the single
  matching connection (1:1) or all other connections (broadcast).
- Target: ESP32 (or ESP32-C3/S3), supporting roughly 6-8 simultaneous BLE
  connections.

## Data flow

**New member joins a room already in progress:**
1. Device connects to the hub over BLE, discovers the service, negotiates
   MTU, subscribes to `outbox`.
2. Hub assigns a short ID, broadcasts `member_joined` to existing clients,
   and sends the newcomer a `member_list` of current short IDs.
3. Newcomer broadcasts a signed presence frame containing its Ed25519 and
   X25519 public keys and chosen nickname.
4. An existing member (deterministic tie-break, e.g. lowest short ID)
   performs ECDH with the newcomer's public key, wraps the current room
   key, and addresses it 1:1 back to the newcomer via the hub.
5. Newcomer decrypts the wrapped room key and can now send/receive group
   messages.

**Group message send:** sender encrypts plaintext with the current room key
(fresh random nonce per message), signs ciphertext + metadata with its
Ed25519 key, addresses the frame as broadcast, fragments if needed, and
writes chunk(s) to `inbox`. The hub relays each chunk to every other
connected client's `outbox`. Recipients reassemble, verify the signature
against the sender's known public key, decrypt, and render.

**1:1 message send:** sender must already know the recipient's X25519
public key (learned via presence broadcast). Sender derives (or reuses a
cached) pairwise ECDH secret, encrypts and signs the message, addresses it
to the recipient's short ID. The hub relays only to that one connection.

**Member leaves:** hub detects the BLE disconnect and broadcasts
`member_left` with the departing short ID; clients remove that ID from
their roster/UI. See "Key lifecycle" above for what this does and does not
do to the group key.

## Safety-number verification (optional, non-blocking)

Because the hub is untrusted, a compromised hub could in principle attempt
to substitute its own public key during the very first ECDH-based key
handoff to a new joiner (a classic MITM). To let users detect this, the
client can derive a short fingerprint from the combination of both parties'
identity public keys (Signal-style safety number) and display it on both
devices for an in-person comparison. Marking a peer "verified" is a UI
affordance layered on top of the base protocol — it is not required to
send or receive messages, but is recommended and should be easy to find in
the UI.

## Error handling

- **BLE disconnect / out of range:** client detects the GATT disconnect,
  shows a "reconnecting…" state, and retries using the already-granted
  `BluetoothDevice` reference (no repeated permission prompt).
- **Hub at capacity:** a connection attempt beyond the hub's BLE connection
  limit is rejected at the BLE stack level; the client shows "room full."
- **Replay/duplicate frames:** each signed message carries a per-sender
  monotonic sequence number; receivers silently drop frames with a
  sequence number they've already seen, mitigating a hub that replays old
  ciphertext.
- **Lost/partial chunked messages:** reassembly times out and discards the
  partial message. There is no delivery-acknowledgement layer in this
  design — BLE relay is explicitly best-effort, not guaranteed delivery.
- **Unsupported browser:** the client feature-detects `navigator.bluetooth`
  on load and shows a clear "this requires Chrome/Chromium with Web
  Bluetooth support" message rather than failing silently mid-flow.
- **Hub firmware reset or crash:** all clients see a simultaneous
  disconnect and treat it as the room having ended; reconnecting starts a
  fresh room and, per the key lifecycle rule, a fresh room key.

## Testing

- **Crypto and framing (unit-testable, no hardware needed):** key
  generation, ECDH agreement, AES-GCM encrypt/decrypt round-trips,
  signing/verification, group-key wrap/unwrap, and chunk fragmentation and
  reassembly (including out-of-order and dropped-chunk cases). Run with a
  standard JS test runner (e.g. Vitest).
- **BLE integration:** Web Bluetooth requires real hardware and a user
  gesture, so this is not automatable in CI. A manual test checklist is
  run against the real ESP32 hub covering: multi-device join, group
  send/receive, 1:1 send/receive, disconnect/reconnect behavior, and
  room-full behavior.
- **Optional mock-hub dev mode:** a `BroadcastChannel`-based fake peripheral
  that lets multiple browser tabs on one machine simulate hub relay
  behavior, so the crypto/UI stack can be exercised locally without
  physical hardware.
- **Hub firmware:** kept intentionally minimal; verified via manual smoke
  testing (flash + serial log inspection of connect/relay/disconnect
  events) rather than an automated suite.

## Open questions / future work

- Group key rotation on individual member departure (currently: room key
  persists as long as the room isn't fully empty; see Key lifecycle).
- Multi-hub mesh support for rooms larger than one hub's connection limit.
- Image/attachment support (would need a real chunking/backpressure
  protocol given BLE throughput).
- Message delivery acknowledgements.
