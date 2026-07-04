#pragma once

#include <Arduino.h>
#include "ble_protocol.h"

struct ConnectionSlot {
  bool occupied = false;
  uint16_t connHandle = 0;
  uint8_t shortId = 0;

  ConnectionSlot() : occupied(false), connHandle(0), shortId(0) {}
  ConnectionSlot(bool occ, uint16_t handle, uint8_t id)
    : occupied(occ), connHandle(handle), shortId(id) {}
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
