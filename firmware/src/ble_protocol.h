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
