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
