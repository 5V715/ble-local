# ESP32 Hub Firmware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build ESP32 firmware that acts as the "dumb relay hub" the already-shipped client SPA depends on, plus the small client-side patch that closes the previously-blocking `myShortId` gap.

**Architecture:** A single BLE peripheral (NimBLE-Arduino) exposes the client's existing GATT layout (`inbox` write / `outbox` notify characteristics). A fixed-size connection-slot table maps each active BLE connection to an assigned short ID. Relay logic is table-driven and content-blind: it reads one byte (the recipient field) from each `inbox` write and forwards the untouched bytes to the matching `outbox`(es) via NimBLE's per-connection notify targeting. Four system frame types (`your_id`, `member_list`, `member_joined`, `member_left`) handle presence bookkeeping. The firmware never touches keys, signatures, or plaintext.

**Tech Stack:** PlatformIO, Arduino framework, NimBLE-Arduino (C++), targeting the `esp32dev` board (ESP32 DevKit classic). Client patch: TypeScript, Vitest (existing client toolchain).

## Global Constraints

- Board: `esp32dev` (ESP32 DevKit classic), framework `arduino`, library `h2zero/NimBLE-Arduino@^2.1.0` (verified working at 2.5.0 in this environment; this version range guarantees the per-connection `notify(value, length, connHandle)` overload used throughout this plan — that overload was introduced in NimBLE-Arduino 2.0.0).
- NimBLE-Arduino 2.x callback signatures (verified against the library's own docs, not assumed): `void onConnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo)`, `void onDisconnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo, int reason)`, `void onWrite(NimBLECharacteristic* pCharacteristic, NimBLEConnInfo& connInfo)`. `NimBLEConnInfo::getConnHandle()` returns `uint16_t`. `NimBLECharacteristic::getValue()` returns a `NimBLEAttValue`, which exposes `.data()` (returns `const uint8_t*`) and `.length()` (if `.length()` doesn't compile against the installed version, `.size()` is the documented alternative — try that instead, don't guess further).
- Advertising does **not** auto-resume after a disconnect in NimBLE-Arduino 2.x — resuming it (only when the table had been full) is this firmware's explicit responsibility, not a library default.
- GATT UUIDs and sentinel byte values must exactly match `src/transport/ble-protocol.ts` on the `main` branch of this repo:
  - `HUB_SERVICE_UUID = "7b4a1000-8a2b-4c3d-9e8f-1123456789ab"`
  - `INBOX_CHARACTERISTIC_UUID = "7b4a1001-8a2b-4c3d-9e8f-1123456789ab"`
  - `OUTBOX_CHARACTERISTIC_UUID = "7b4a1002-8a2b-4c3d-9e8f-1123456789ab"`
  - `SYSTEM_FRAME_MEMBER_LIST = 0xf0`, `SYSTEM_FRAME_MEMBER_JOINED = 0xf1`, `SYSTEM_FRAME_MEMBER_LEFT = 0xf2`
  - `SYSTEM_FRAME_YOUR_ID = 0xf3` (new — added in this plan, on both firmware and client)
  - `BROADCAST_RECIPIENT = 0xff` (matches the client's `src/protocol/framing.ts`)
- The recipient short ID lives at **byte offset 2** of any frame written to `inbox` (matches the client's frame header layout in `src/protocol/framing.ts`: `msgType`(1) `senderShortId`(1) `recipientShortId`(1) ...). This is the only byte the hub ever inspects.
- `MAX_CONNECTIONS = 7` (compile-time constant).
- No crypto, identity, or persistence in firmware — it is a dumb relay by design.
- No automated firmware unit tests (explicit spec scope decision — the relay logic's surface area is small enough that this is disproportionate for this project). Verification is a `pio run` compile check (run in this development environment) plus manual hardware testing (run by the user — this environment has no physical ESP32 attached).
- Client patch touches only `src/transport/ble-protocol.ts`, `src/transport/web-bluetooth-transport.ts`, and `src/transport/web-bluetooth-transport.test.ts` in the existing repo (Node ≥20, TypeScript strict mode, Vitest already configured from the earlier client plan — verify with `npx tsc --noEmit`, not just `npm test`/`npm run build`).
- **Environment setup already done in this development session, but a fresh implementer must verify it themselves:** PlatformIO CLI was installed via `pipx install platformio`, and a missing `intelhex` Python module (needed by the bundled `esptool.py`, otherwise bootloader image generation fails with `ModuleNotFoundError: No module named 'intelhex'`) was fixed via `pipx inject platformio intelhex`. Run `pio --version` first; if it's missing, or if a build fails with that specific `ModuleNotFoundError`, apply the same two commands.

---

### Task 1: PlatformIO project scaffolding + shared protocol constants

**Files:**
- Create: `firmware/.gitignore`
- Create: `firmware/platformio.ini`
- Create: `firmware/src/ble_protocol.h`
- Create: `firmware/src/main.cpp`

**Interfaces:**
- Produces: `HUB_SERVICE_UUID`, `INBOX_CHARACTERISTIC_UUID`, `OUTBOX_CHARACTERISTIC_UUID` (C string literals); `SYSTEM_FRAME_MEMBER_LIST`, `SYSTEM_FRAME_MEMBER_JOINED`, `SYSTEM_FRAME_MEMBER_LEFT`, `SYSTEM_FRAME_YOUR_ID`, `BROADCAST_RECIPIENT` (all `constexpr uint8_t`); `RECIPIENT_BYTE_OFFSET` (`constexpr size_t`); `MAX_CONNECTIONS` (`constexpr uint8_t`); `INVALID_SHORT_ID` (`constexpr int16_t`) — every later task includes `ble_protocol.h` and uses these.

- [ ] **Step 1: Verify or install PlatformIO**

```bash
pio --version
```

Expected: prints a version (e.g. `PlatformIO Core, version 6.1.19`). If the command is not found:

```bash
sudo apt-get install -y pipx
pipx install platformio
```

Then re-run `pio --version` to confirm.

- [ ] **Step 2: Create `firmware/.gitignore`**

```
.pio
```

PlatformIO's build directory (`.pio/`) contains thousands of compiled object files and downloaded toolchain/library artifacts — it must never be tracked in git. Create this file **before** any `git add firmware` step below, or the build directory will be swept into the commit.

- [ ] **Step 3: Create `firmware/platformio.ini`**

```ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
lib_deps = h2zero/NimBLE-Arduino@^2.1.0
monitor_speed = 115200
```

- [ ] **Step 4: Create `firmware/src/ble_protocol.h`**

```cpp
#pragma once

#include <Arduino.h>

// This file's constants must exactly match src/transport/ble-protocol.ts
// in this repo's client SPA (main branch). Any change here requires a
// matching change there, and vice versa — they define the wire protocol
// between this firmware and every browser client.

#define HUB_SERVICE_UUID           "7b4a1000-8a2b-4c3d-9e8f-1123456789ab"
#define INBOX_CHARACTERISTIC_UUID  "7b4a1001-8a2b-4c3d-9e8f-1123456789ab"
#define OUTBOX_CHARACTERISTIC_UUID "7b4a1002-8a2b-4c3d-9e8f-1123456789ab"

// Sentinel first-byte values for outbox notifications that are system
// frames rather than relayed application frames.
constexpr uint8_t SYSTEM_FRAME_MEMBER_LIST   = 0xf0;
constexpr uint8_t SYSTEM_FRAME_MEMBER_JOINED = 0xf1;
constexpr uint8_t SYSTEM_FRAME_MEMBER_LEFT   = 0xf2;
constexpr uint8_t SYSTEM_FRAME_YOUR_ID       = 0xf3;

// Recipient byte value meaning "broadcast to everyone" — matches
// BROADCAST_RECIPIENT in the client's src/protocol/framing.ts.
constexpr uint8_t BROADCAST_RECIPIENT = 0xff;

// Byte offset of the recipient short id within any application frame
// written to `inbox` — the only byte this firmware ever inspects.
constexpr size_t RECIPIENT_BYTE_OFFSET = 2;

// Maximum simultaneous BLE connections this hub supports.
constexpr uint8_t MAX_CONNECTIONS = 7;

// Reserved value meaning "no short id assigned" / "not found".
constexpr int16_t INVALID_SHORT_ID = -1;
```

- [ ] **Step 5: Create `firmware/src/main.cpp`**

```cpp
#include <Arduino.h>
#include <NimBLEDevice.h>
#include "ble_protocol.h"

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("BLE local chat hub booting");
  NimBLEDevice::init("BLE Local Chat Hub");
}

void loop() {
  delay(1000);
}
```

- [ ] **Step 6: Compile check**

```bash
cd firmware && pio run
```

Expected: `[SUCCESS]` — PlatformIO will download the `espressif32` platform and `NimBLE-Arduino` library on first run (a couple of minutes); subsequent runs are fast. If the build fails with `ModuleNotFoundError: No module named 'intelhex'`, run `pipx inject platformio intelhex` and re-run.

- [ ] **Step 7: Commit**

```bash
git add firmware
git commit -m "feat: scaffold PlatformIO ESP32 firmware project with shared protocol constants"
```

---

### Task 2: BLE service, characteristics, and advertising

**Files:**
- Modify: `firmware/src/main.cpp`

**Interfaces:**
- Consumes: `HUB_SERVICE_UUID`, `INBOX_CHARACTERISTIC_UUID`, `OUTBOX_CHARACTERISTIC_UUID` from `ble_protocol.h` (Task 1).
- Produces: a running, advertising BLE peripheral; a module-level `static NimBLECharacteristic* outboxCharacteristic` that Tasks 4 and 5 will use to send notifications.

- [ ] **Step 1: Replace `firmware/src/main.cpp` with:**

```cpp
#include <Arduino.h>
#include <NimBLEDevice.h>
#include "ble_protocol.h"

static NimBLECharacteristic* outboxCharacteristic = nullptr;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("BLE local chat hub booting");

  NimBLEDevice::init("BLE Local Chat Hub");

  NimBLEServer* server = NimBLEDevice::createServer();
  NimBLEService* service = server->createService(HUB_SERVICE_UUID);

  service->createCharacteristic(INBOX_CHARACTERISTIC_UUID, NIMBLE_PROPERTY::WRITE);
  outboxCharacteristic = service->createCharacteristic(OUTBOX_CHARACTERISTIC_UUID, NIMBLE_PROPERTY::NOTIFY);

  service->start();

  NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(HUB_SERVICE_UUID);
  advertising->start();

  Serial.println("Advertising started");
}

void loop() {
  delay(1000);
}
```

- [ ] **Step 2: Compile check**

```bash
cd firmware && pio run
```

Expected: `[SUCCESS]`.

- [ ] **Step 3: Manual hardware verification (run by you — flash and observe)**

```bash
cd firmware && pio run --target upload && pio device monitor
```

Expected serial output ending in "Advertising started". Using a BLE scanner app (e.g. nRF Connect on a phone, or `chrome://bluetooth-internals` in Chrome), confirm a device named "BLE Local Chat Hub" is advertising and exposes service `7b4a1000-8a2b-4c3d-9e8f-1123456789ab` with two characteristics (`...1001` write-only, `...1002` notify-only).

- [ ] **Step 4: Commit**

```bash
git add firmware
git commit -m "feat: add BLE service, characteristics, and advertising"
```

---

### Task 3: Connection table and connect/disconnect callbacks

**Files:**
- Create: `firmware/src/connection_table.h`
- Create: `firmware/src/connection_table.cpp`
- Modify: `firmware/src/main.cpp`

**Interfaces:**
- Consumes: `MAX_CONNECTIONS`, `INVALID_SHORT_ID` from `ble_protocol.h` (Task 1).
- Produces:
  ```cpp
  class ConnectionTable {
  public:
    int16_t assign(uint16_t connHandle);
    int16_t free(uint16_t connHandle);
    int16_t shortIdFor(uint16_t connHandle) const;
    bool connHandleFor(uint8_t shortId, uint16_t* outConnHandle) const;
    uint8_t otherShortIds(uint8_t excludeShortId, uint8_t* outIds) const;
    uint8_t otherConnHandles(uint8_t excludeShortId, uint16_t* outHandles) const;
    bool isFull() const;
    bool isEmpty() const;
  };
  ```
  — used by Task 4 (system frames) and Task 5 (relay).

- [ ] **Step 1: Create `firmware/src/connection_table.h`**

```cpp
#pragma once

#include <Arduino.h>
#include "ble_protocol.h"

struct ConnectionSlot {
  bool occupied = false;
  uint16_t connHandle = 0;
  uint8_t shortId = 0;
};

// Fixed-size table mapping BLE connection handles to assigned short ids.
// Short ids are 1-indexed (1..MAX_CONNECTIONS); 0 and 0xff (broadcast) are
// never assigned. No heap allocation — everything is a static array sized
// at compile time, appropriate for this memory-constrained target.
class ConnectionTable {
public:
  // Assigns the next free short id to connHandle. Returns the assigned
  // short id, or INVALID_SHORT_ID if the table is already full.
  int16_t assign(uint16_t connHandle);

  // Frees the slot for connHandle. Returns the freed short id, or
  // INVALID_SHORT_ID if connHandle was not found.
  int16_t free(uint16_t connHandle);

  // Looks up the short id for a connection handle, or INVALID_SHORT_ID.
  int16_t shortIdFor(uint16_t connHandle) const;

  // Looks up the connection handle for a short id. Returns true and sets
  // *outConnHandle if found; returns false otherwise.
  bool connHandleFor(uint8_t shortId, uint16_t* outConnHandle) const;

  // Fills outIds (capacity MAX_CONNECTIONS) with every occupied slot's
  // short id except excludeShortId. Returns the count written.
  uint8_t otherShortIds(uint8_t excludeShortId, uint8_t* outIds) const;

  // Fills outHandles (capacity MAX_CONNECTIONS) with every occupied slot's
  // connection handle except the slot whose short id is excludeShortId.
  // Returns the count written.
  uint8_t otherConnHandles(uint8_t excludeShortId, uint16_t* outHandles) const;

  bool isFull() const;
  bool isEmpty() const;

private:
  ConnectionSlot slots_[MAX_CONNECTIONS];
};
```

- [ ] **Step 2: Create `firmware/src/connection_table.cpp`**

```cpp
#include "connection_table.h"

int16_t ConnectionTable::assign(uint16_t connHandle) {
  for (uint8_t i = 0; i < MAX_CONNECTIONS; i++) {
    if (!slots_[i].occupied) {
      uint8_t shortId = i + 1;
      slots_[i] = { true, connHandle, shortId };
      return shortId;
    }
  }
  return INVALID_SHORT_ID;
}

int16_t ConnectionTable::free(uint16_t connHandle) {
  for (uint8_t i = 0; i < MAX_CONNECTIONS; i++) {
    if (slots_[i].occupied && slots_[i].connHandle == connHandle) {
      uint8_t freedId = slots_[i].shortId;
      slots_[i] = ConnectionSlot();
      return freedId;
    }
  }
  return INVALID_SHORT_ID;
}

int16_t ConnectionTable::shortIdFor(uint16_t connHandle) const {
  for (uint8_t i = 0; i < MAX_CONNECTIONS; i++) {
    if (slots_[i].occupied && slots_[i].connHandle == connHandle) {
      return slots_[i].shortId;
    }
  }
  return INVALID_SHORT_ID;
}

bool ConnectionTable::connHandleFor(uint8_t shortId, uint16_t* outConnHandle) const {
  for (uint8_t i = 0; i < MAX_CONNECTIONS; i++) {
    if (slots_[i].occupied && slots_[i].shortId == shortId) {
      *outConnHandle = slots_[i].connHandle;
      return true;
    }
  }
  return false;
}

uint8_t ConnectionTable::otherShortIds(uint8_t excludeShortId, uint8_t* outIds) const {
  uint8_t count = 0;
  for (uint8_t i = 0; i < MAX_CONNECTIONS; i++) {
    if (slots_[i].occupied && slots_[i].shortId != excludeShortId) {
      outIds[count++] = slots_[i].shortId;
    }
  }
  return count;
}

uint8_t ConnectionTable::otherConnHandles(uint8_t excludeShortId, uint16_t* outHandles) const {
  uint8_t count = 0;
  for (uint8_t i = 0; i < MAX_CONNECTIONS; i++) {
    if (slots_[i].occupied && slots_[i].shortId != excludeShortId) {
      outHandles[count++] = slots_[i].connHandle;
    }
  }
  return count;
}

bool ConnectionTable::isFull() const {
  for (uint8_t i = 0; i < MAX_CONNECTIONS; i++) {
    if (!slots_[i].occupied) return false;
  }
  return true;
}

bool ConnectionTable::isEmpty() const {
  for (uint8_t i = 0; i < MAX_CONNECTIONS; i++) {
    if (slots_[i].occupied) return false;
  }
  return true;
}
```

- [ ] **Step 3: Wire connect/disconnect callbacks into `firmware/src/main.cpp`**

Replace the full contents of `firmware/src/main.cpp` with:

```cpp
#include <Arduino.h>
#include <NimBLEDevice.h>
#include "ble_protocol.h"
#include "connection_table.h"

static NimBLECharacteristic* outboxCharacteristic = nullptr;
static ConnectionTable connectionTable;

class HubServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* server, NimBLEConnInfo& connInfo) override {
    uint16_t connHandle = connInfo.getConnHandle();
    int16_t shortId = connectionTable.assign(connHandle);

    if (shortId == INVALID_SHORT_ID) {
      Serial.printf("Connection %u rejected: table full\n", connHandle);
      server->disconnect(connHandle);
      return;
    }

    Serial.printf("Connection %u assigned short id %d\n", connHandle, shortId);
  }

  void onDisconnect(NimBLEServer* server, NimBLEConnInfo& connInfo, int reason) override {
    uint16_t connHandle = connInfo.getConnHandle();
    int16_t shortId = connectionTable.free(connHandle);

    if (shortId == INVALID_SHORT_ID) {
      Serial.printf("Disconnect for unknown connection %u\n", connHandle);
      return;
    }

    Serial.printf("Connection %u (short id %d) disconnected, reason %d\n", connHandle, shortId, reason);
  }
};

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("BLE local chat hub booting");

  NimBLEDevice::init("BLE Local Chat Hub");

  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new HubServerCallbacks());

  NimBLEService* service = server->createService(HUB_SERVICE_UUID);

  service->createCharacteristic(INBOX_CHARACTERISTIC_UUID, NIMBLE_PROPERTY::WRITE);
  outboxCharacteristic = service->createCharacteristic(OUTBOX_CHARACTERISTIC_UUID, NIMBLE_PROPERTY::NOTIFY);

  service->start();

  NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(HUB_SERVICE_UUID);
  advertising->start();

  Serial.println("Advertising started");
}

void loop() {
  delay(1000);
}
```

- [ ] **Step 4: Compile check**

```bash
cd firmware && pio run
```

Expected: `[SUCCESS]`.

- [ ] **Step 5: Manual hardware verification (run by you)**

```bash
cd firmware && pio run --target upload && pio device monitor
```

Connect with a BLE scanner app. Expected serial output: `Connection <handle> assigned short id 1`. Disconnect. Expected: `Connection <handle> (short id 1) disconnected, reason <code>`. Connect a second device while the first is still connected; expected: it gets short id `2`, not `1` again.

- [ ] **Step 6: Commit**

```bash
git add firmware
git commit -m "feat: add connection table and connect/disconnect short id assignment"
```

---

### Task 4: System frames and advertising pause/resume at capacity

**Files:**
- Create: `firmware/src/system_frames.h`
- Create: `firmware/src/system_frames.cpp`
- Modify: `firmware/src/main.cpp`

**Interfaces:**
- Consumes: `ConnectionTable` (Task 3); `SYSTEM_FRAME_MEMBER_LIST`, `SYSTEM_FRAME_MEMBER_JOINED`, `SYSTEM_FRAME_MEMBER_LEFT`, `SYSTEM_FRAME_YOUR_ID`, `MAX_CONNECTIONS` from `ble_protocol.h` (Task 1); `NimBLECharacteristic` (the `outboxCharacteristic` from Task 2).
- Produces:
  ```cpp
  void sendYourId(NimBLECharacteristic* outbox, uint16_t connHandle, uint8_t assignedShortId);
  void sendMemberList(NimBLECharacteristic* outbox, uint16_t connHandle, const ConnectionTable& table, uint8_t excludeShortId);
  void broadcastMemberJoined(NimBLECharacteristic* outbox, const ConnectionTable& table, uint8_t joinedShortId);
  void broadcastMemberLeft(NimBLECharacteristic* outbox, const ConnectionTable& table, uint8_t leftShortId);
  ```
  — called from `main.cpp`'s connect/disconnect callbacks (this task) and not needed elsewhere.

- [ ] **Step 1: Create `firmware/src/system_frames.h`**

```cpp
#pragma once

#include <Arduino.h>
#include <NimBLEDevice.h>
#include "ble_protocol.h"
#include "connection_table.h"

// Sends SYSTEM_FRAME_YOUR_ID to exactly one connection, confirming its
// assigned short id.
void sendYourId(NimBLECharacteristic* outbox, uint16_t connHandle, uint8_t assignedShortId);

// Sends SYSTEM_FRAME_MEMBER_LIST to exactly one connection (the newcomer),
// containing every other currently-occupied short id. Matches the client's
// MockHubTransport semantics: a member list represents others, never
// yourself.
void sendMemberList(NimBLECharacteristic* outbox, uint16_t connHandle, const ConnectionTable& table, uint8_t excludeShortId);

// Broadcasts SYSTEM_FRAME_MEMBER_JOINED (joinedShortId) to every occupied
// slot except joinedShortId itself.
void broadcastMemberJoined(NimBLECharacteristic* outbox, const ConnectionTable& table, uint8_t joinedShortId);

// Broadcasts SYSTEM_FRAME_MEMBER_LEFT (leftShortId) to every remaining
// occupied slot. Call this AFTER ConnectionTable::free() has already
// removed leftShortId's slot.
void broadcastMemberLeft(NimBLECharacteristic* outbox, const ConnectionTable& table, uint8_t leftShortId);
```

- [ ] **Step 2: Create `firmware/src/system_frames.cpp`**

```cpp
#include "system_frames.h"

void sendYourId(NimBLECharacteristic* outbox, uint16_t connHandle, uint8_t assignedShortId) {
  uint8_t frame[2] = { SYSTEM_FRAME_YOUR_ID, assignedShortId };
  outbox->notify(frame, sizeof(frame), connHandle);
}

void sendMemberList(NimBLECharacteristic* outbox, uint16_t connHandle, const ConnectionTable& table, uint8_t excludeShortId) {
  uint8_t ids[MAX_CONNECTIONS];
  uint8_t count = table.otherShortIds(excludeShortId, ids);

  uint8_t frame[2 + MAX_CONNECTIONS];
  frame[0] = SYSTEM_FRAME_MEMBER_LIST;
  frame[1] = count;
  for (uint8_t i = 0; i < count; i++) {
    frame[2 + i] = ids[i];
  }
  outbox->notify(frame, 2 + count, connHandle);
}

void broadcastMemberJoined(NimBLECharacteristic* outbox, const ConnectionTable& table, uint8_t joinedShortId) {
  uint16_t handles[MAX_CONNECTIONS];
  uint8_t count = table.otherConnHandles(joinedShortId, handles);

  uint8_t frame[2] = { SYSTEM_FRAME_MEMBER_JOINED, joinedShortId };
  for (uint8_t i = 0; i < count; i++) {
    outbox->notify(frame, sizeof(frame), handles[i]);
  }
}

void broadcastMemberLeft(NimBLECharacteristic* outbox, const ConnectionTable& table, uint8_t leftShortId) {
  uint16_t handles[MAX_CONNECTIONS];
  // leftShortId's slot has already been freed by the caller, so every
  // remaining occupied slot is a valid recipient; excluding leftShortId
  // here is harmless since it's no longer present in the table anyway.
  uint8_t count = table.otherConnHandles(leftShortId, handles);

  uint8_t frame[2] = { SYSTEM_FRAME_MEMBER_LEFT, leftShortId };
  for (uint8_t i = 0; i < count; i++) {
    outbox->notify(frame, sizeof(frame), handles[i]);
  }
}
```

- [ ] **Step 3: Wire into `firmware/src/main.cpp`**

Replace the full contents of `firmware/src/main.cpp` with:

```cpp
#include <Arduino.h>
#include <NimBLEDevice.h>
#include "ble_protocol.h"
#include "connection_table.h"
#include "system_frames.h"

static NimBLECharacteristic* outboxCharacteristic = nullptr;
static ConnectionTable connectionTable;

class HubServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* server, NimBLEConnInfo& connInfo) override {
    uint16_t connHandle = connInfo.getConnHandle();
    int16_t shortId = connectionTable.assign(connHandle);

    if (shortId == INVALID_SHORT_ID) {
      Serial.printf("Connection %u rejected: table full\n", connHandle);
      server->disconnect(connHandle);
      return;
    }

    Serial.printf("Connection %u assigned short id %d\n", connHandle, shortId);

    sendYourId(outboxCharacteristic, connHandle, (uint8_t)shortId);
    sendMemberList(outboxCharacteristic, connHandle, connectionTable, (uint8_t)shortId);
    broadcastMemberJoined(outboxCharacteristic, connectionTable, (uint8_t)shortId);

    if (connectionTable.isFull()) {
      Serial.println("Table full, pausing advertising");
      NimBLEDevice::stopAdvertising();
    }
  }

  void onDisconnect(NimBLEServer* server, NimBLEConnInfo& connInfo, int reason) override {
    uint16_t connHandle = connInfo.getConnHandle();
    bool wasFull = connectionTable.isFull();
    int16_t shortId = connectionTable.free(connHandle);

    if (shortId == INVALID_SHORT_ID) {
      Serial.printf("Disconnect for unknown connection %u\n", connHandle);
      return;
    }

    Serial.printf("Connection %u (short id %d) disconnected, reason %d\n", connHandle, shortId, reason);
    broadcastMemberLeft(outboxCharacteristic, connectionTable, (uint8_t)shortId);

    if (wasFull) {
      Serial.println("Resuming advertising");
      NimBLEDevice::startAdvertising();
    }
  }
};

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("BLE local chat hub booting");

  NimBLEDevice::init("BLE Local Chat Hub");

  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new HubServerCallbacks());

  NimBLEService* service = server->createService(HUB_SERVICE_UUID);

  service->createCharacteristic(INBOX_CHARACTERISTIC_UUID, NIMBLE_PROPERTY::WRITE);
  outboxCharacteristic = service->createCharacteristic(OUTBOX_CHARACTERISTIC_UUID, NIMBLE_PROPERTY::NOTIFY);

  service->start();

  NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(HUB_SERVICE_UUID);
  advertising->start();

  Serial.println("Advertising started");
}

void loop() {
  delay(1000);
}
```

- [ ] **Step 4: Compile check**

```bash
cd firmware && pio run
```

Expected: `[SUCCESS]`.

- [ ] **Step 5: Manual hardware verification (run by you)**

Flash and connect two BLE tools/devices in sequence (using nRF Connect or similar, subscribing to notifications on the outbox characteristic before connecting the second device). Expected: the first connection receives `[0xf3, 1]` (your_id) then `[0xf0, 0]` (member_list, empty since it's alone) on connect. The second connection receives `[0xf3, 2]` then `[0xf0, 1, 1]` (member_list containing short id 1). The first connection additionally receives `[0xf1, 2]` (member_joined) at that moment. Disconnect the second device; the first receives `[0xf2, 2]` (member_left). Connect up to 7 total devices, then attempt an 8th — confirm it no longer appears in scans (advertising paused). Disconnect one of the 7; confirm the 8th can now see and connect to the hub again.

- [ ] **Step 6: Commit**

```bash
git add firmware
git commit -m "feat: add system frames and advertising pause/resume at capacity"
```

---

### Task 5: Inbox relay dispatcher

**Files:**
- Create: `firmware/src/relay.h`
- Create: `firmware/src/relay.cpp`
- Modify: `firmware/src/main.cpp`

**Interfaces:**
- Consumes: `ConnectionTable` (Task 3); `RECIPIENT_BYTE_OFFSET`, `BROADCAST_RECIPIENT`, `MAX_CONNECTIONS`, `INVALID_SHORT_ID` from `ble_protocol.h` (Task 1).
- Produces: `relayFrame(NimBLECharacteristic* outbox, const ConnectionTable& table, uint16_t senderConnHandle, const uint8_t* data, size_t length)`, wired as the `inbox` characteristic's write callback.

- [ ] **Step 1: Create `firmware/src/relay.h`**

```cpp
#pragma once

#include <Arduino.h>
#include <NimBLEDevice.h>
#include "ble_protocol.h"
#include "connection_table.h"

// Reads the recipient byte (at RECIPIENT_BYTE_OFFSET) from a frame written
// to `inbox` and relays the complete, unmodified byte array to the matching
// outbox notification(s): every other occupied connection if the recipient
// is BROADCAST_RECIPIENT, or just the one connection whose short id
// matches otherwise. Frames shorter than RECIPIENT_BYTE_OFFSET + 1 bytes,
// or written by a connection not present in the table, are dropped
// silently.
void relayFrame(NimBLECharacteristic* outbox, const ConnectionTable& table, uint16_t senderConnHandle, const uint8_t* data, size_t length);
```

- [ ] **Step 2: Create `firmware/src/relay.cpp`**

```cpp
#include "relay.h"

void relayFrame(NimBLECharacteristic* outbox, const ConnectionTable& table, uint16_t senderConnHandle, const uint8_t* data, size_t length) {
  if (length < RECIPIENT_BYTE_OFFSET + 1) {
    return;
  }

  int16_t senderShortId = table.shortIdFor(senderConnHandle);
  if (senderShortId == INVALID_SHORT_ID) {
    return;
  }

  uint8_t recipient = data[RECIPIENT_BYTE_OFFSET];

  if (recipient == BROADCAST_RECIPIENT) {
    uint16_t handles[MAX_CONNECTIONS];
    uint8_t count = table.otherConnHandles((uint8_t)senderShortId, handles);
    for (uint8_t i = 0; i < count; i++) {
      outbox->notify(data, length, handles[i]);
    }
  } else {
    uint16_t targetHandle;
    if (table.connHandleFor(recipient, &targetHandle)) {
      outbox->notify(data, length, targetHandle);
    }
  }
}
```

- [ ] **Step 3: Wire into `firmware/src/main.cpp`**

Replace the full contents of `firmware/src/main.cpp` with:

```cpp
#include <Arduino.h>
#include <NimBLEDevice.h>
#include "ble_protocol.h"
#include "connection_table.h"
#include "system_frames.h"
#include "relay.h"

static NimBLECharacteristic* outboxCharacteristic = nullptr;
static ConnectionTable connectionTable;

class HubServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* server, NimBLEConnInfo& connInfo) override {
    uint16_t connHandle = connInfo.getConnHandle();
    int16_t shortId = connectionTable.assign(connHandle);

    if (shortId == INVALID_SHORT_ID) {
      Serial.printf("Connection %u rejected: table full\n", connHandle);
      server->disconnect(connHandle);
      return;
    }

    Serial.printf("Connection %u assigned short id %d\n", connHandle, shortId);

    sendYourId(outboxCharacteristic, connHandle, (uint8_t)shortId);
    sendMemberList(outboxCharacteristic, connHandle, connectionTable, (uint8_t)shortId);
    broadcastMemberJoined(outboxCharacteristic, connectionTable, (uint8_t)shortId);

    if (connectionTable.isFull()) {
      Serial.println("Table full, pausing advertising");
      NimBLEDevice::stopAdvertising();
    }
  }

  void onDisconnect(NimBLEServer* server, NimBLEConnInfo& connInfo, int reason) override {
    uint16_t connHandle = connInfo.getConnHandle();
    bool wasFull = connectionTable.isFull();
    int16_t shortId = connectionTable.free(connHandle);

    if (shortId == INVALID_SHORT_ID) {
      Serial.printf("Disconnect for unknown connection %u\n", connHandle);
      return;
    }

    Serial.printf("Connection %u (short id %d) disconnected, reason %d\n", connHandle, shortId, reason);
    broadcastMemberLeft(outboxCharacteristic, connectionTable, (uint8_t)shortId);

    if (wasFull) {
      Serial.println("Resuming advertising");
      NimBLEDevice::startAdvertising();
    }
  }
};

class InboxCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* characteristic, NimBLEConnInfo& connInfo) override {
    NimBLEAttValue value = characteristic->getValue();
    relayFrame(outboxCharacteristic, connectionTable, connInfo.getConnHandle(), value.data(), value.length());
  }
};

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("BLE local chat hub booting");

  NimBLEDevice::init("BLE Local Chat Hub");

  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new HubServerCallbacks());

  NimBLEService* service = server->createService(HUB_SERVICE_UUID);

  NimBLECharacteristic* inbox = service->createCharacteristic(INBOX_CHARACTERISTIC_UUID, NIMBLE_PROPERTY::WRITE);
  inbox->setCallbacks(new InboxCallbacks());

  outboxCharacteristic = service->createCharacteristic(OUTBOX_CHARACTERISTIC_UUID, NIMBLE_PROPERTY::NOTIFY);

  service->start();

  NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(HUB_SERVICE_UUID);
  advertising->start();

  Serial.println("Advertising started");
}

void loop() {
  delay(1000);
}
```

- [ ] **Step 4: Compile check**

```bash
cd firmware && pio run
```

Expected: `[SUCCESS]`. If `value.length()` fails to compile against the installed NimBLE-Arduino version, replace it with `value.size()` (both are documented accessors on `NimBLEAttValue`; try `.length()` first).

- [ ] **Step 5: Manual hardware verification (run by you)**

Using a BLE tool that can both write to `inbox` and subscribe to `outbox` from two separate connections: write a crafted byte array to `inbox` from connection A with byte offset 2 set to connection B's short id (e.g. `[0, 0, 2, 0,0,0,0, 0, 0, 0, 3, 65, 66, 67]` — a well-formed-enough frame with recipient=2 and payload "ABC"). Confirm connection B's `outbox` receives exactly those bytes, and connection A (or any third connection) does not. Then try recipient byte `0xff` and confirm every other connection receives it.

- [ ] **Step 6: Commit**

```bash
git add firmware
git commit -m "feat: add inbox relay dispatcher"
```

---

### Task 6: Client-side patch — SYSTEM_FRAME_YOUR_ID

**Files:**
- Modify: `src/transport/ble-protocol.ts`
- Modify: `src/transport/web-bluetooth-transport.ts`
- Modify: `src/transport/web-bluetooth-transport.test.ts`

**Interfaces:**
- Consumes: existing `WebBluetoothTransport` class and its private `_myShortId` field, existing `SYSTEM_FRAME_*` handling pattern in `handleNotification`.
- Produces: `SYSTEM_FRAME_YOUR_ID = 0xf3` exported from `ble-protocol.ts`; `WebBluetoothTransport` sets `_myShortId` when it receives a frame starting with that byte.

This task's changes are on the **client SPA** repo (same repo, `main` branch — this is the already-shipped, previously-merged codebase from the earlier plan). Work from the repo root (`/home/me/ble-local`), not `firmware/`.

- [ ] **Step 1: Write the failing test**

Add this `it` block to the `describe('WebBluetoothTransport', ...)` block in `src/transport/web-bluetooth-transport.test.ts` (insert it after the existing `'routes a member-list system frame to onMemberList'` test):

```ts
  it('sets myShortId when it receives a your-id system frame', async () => {
    const device = installFakeBluetooth()
    const transport = new WebBluetoothTransport()
    await transport.connect()

    expect(transport.myShortId).toBeNull()

    device.gatt.service.outbox.notify(new Uint8Array([0xf3, 4]))

    expect(transport.myShortId).toBe(4)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/transport/web-bluetooth-transport.test.ts
```

Expected: FAIL on the new test — `transport.myShortId` remains `null` after the notification, since nothing handles `0xf3` yet.

- [ ] **Step 3: Add the constant to `src/transport/ble-protocol.ts`**

Add this line after the existing `SYSTEM_FRAME_MEMBER_LEFT` export:

```ts
export const SYSTEM_FRAME_YOUR_ID = 0xf3
```

The full file should now read:

```ts
export const HUB_SERVICE_UUID = '7b4a1000-8a2b-4c3d-9e8f-1123456789ab'
export const INBOX_CHARACTERISTIC_UUID = '7b4a1001-8a2b-4c3d-9e8f-1123456789ab'
export const OUTBOX_CHARACTERISTIC_UUID = '7b4a1002-8a2b-4c3d-9e8f-1123456789ab'

export const SYSTEM_FRAME_MEMBER_LIST = 0xf0
export const SYSTEM_FRAME_MEMBER_JOINED = 0xf1
export const SYSTEM_FRAME_MEMBER_LEFT = 0xf2
export const SYSTEM_FRAME_YOUR_ID = 0xf3
```

- [ ] **Step 4: Update `src/transport/web-bluetooth-transport.ts`**

Update the import list at the top of the file:

```ts
import type { Transport } from './transport'
import {
  HUB_SERVICE_UUID,
  INBOX_CHARACTERISTIC_UUID,
  OUTBOX_CHARACTERISTIC_UUID,
  SYSTEM_FRAME_MEMBER_LIST,
  SYSTEM_FRAME_MEMBER_JOINED,
  SYSTEM_FRAME_MEMBER_LEFT,
  SYSTEM_FRAME_YOUR_ID
} from './ble-protocol'
```

Add a branch in `handleNotification`, right before the existing `SYSTEM_FRAME_MEMBER_LIST` check:

```ts
  private handleNotification = (event: Event): void => {
    const characteristic = event.target as unknown as { value: DataView }
    const view = characteristic.value
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    const firstByte = bytes[0]

    if (firstByte === SYSTEM_FRAME_YOUR_ID) {
      this._myShortId = bytes[1]
      return
    }
    if (firstByte === SYSTEM_FRAME_MEMBER_LIST) {
      const count = bytes[1]
      const ids = [...bytes.slice(2, 2 + count)]
      this.listCbs.forEach((cb) => cb(ids))
      return
    }
    if (firstByte === SYSTEM_FRAME_MEMBER_JOINED) {
      this.joinedCbs.forEach((cb) => cb(bytes[1]))
      return
    }
    if (firstByte === SYSTEM_FRAME_MEMBER_LEFT) {
      this.leftCbs.forEach((cb) => cb(bytes[1]))
      return
    }

    this.frameCbs.forEach((cb) => cb(bytes))
  }
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run src/transport/web-bluetooth-transport.test.ts
```

Expected: PASS, all tests in the file passing (8 tests: the 7 existing plus the new one).

- [ ] **Step 6: Run the full client suite and type-check**

```bash
npx tsc --noEmit
npm test
```

Expected: `tsc --noEmit` exits with no output; `npm test` reports all test files passing (57 tests: the 56 from the merged client plan plus this task's new one).

- [ ] **Step 7: Commit**

```bash
git add src/transport
git commit -m "feat: set myShortId from the hub's SYSTEM_FRAME_YOUR_ID confirmation"
```

---

### Task 7: End-to-end manual hardware verification

This task has no code changes — it is the final, full-system checklist that exercises the firmware (Tasks 1-5) together with the patched client (Task 6), run by you since this development environment has no physical ESP32 or Bluetooth-capable browser attached. Work through each item and confirm before considering the firmware plan complete.

- [ ] **Step 1: Flash the final firmware**

```bash
cd firmware && pio run --target upload
```

- [ ] **Step 2: Run the patched client locally**

```bash
npm run dev
```

Open the printed local URL in Chrome, on two separate devices (or two Chrome profiles/incognito windows on devices with Bluetooth adapters) within range of the flashed hub.

- [ ] **Step 3: Verify pairing and group chat**

On both devices: enter a nickname, select "Bluetooth hub" mode, click Join, and pick the "BLE Local Chat Hub" device when Chrome's picker appears. Confirm both devices' rosters show each other within a few seconds, and that a group message sent from one appears on the other.

- [ ] **Step 4: Verify 1:1 messaging**

From one device, click the other's roster entry to open a direct thread, send a message, and confirm it appears only in that thread on the recipient's screen (not in the group room, and not on a third connected device if one is present).

- [ ] **Step 5: Verify disconnect propagation**

Close one device's tab (or turn off its Bluetooth). Confirm the remaining device's roster updates to remove that member within a few seconds.

- [ ] **Step 6: Verify room-full behavior**

Connect devices until the hub has 7 active connections. Attempt to connect an 8th; confirm it does not appear in Chrome's Bluetooth device picker. Disconnect one of the 7 and confirm the 8th can now see and join the hub.

- [ ] **Step 7: Record the outcome**

If every step above passes, the ESP32 hub firmware plan is complete and the BLE local chat app works end-to-end over real Bluetooth. If any step fails, note which one and return to the relevant task above to investigate — do not mark this plan complete with a known-failing step.
