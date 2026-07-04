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
