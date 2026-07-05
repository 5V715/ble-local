#include "connection_table.h"

int16_t ConnectionTable::assign(uint16_t connHandle) {
  for (uint8_t i = 0; i < MAX_CONNECTIONS; i++) {
    if (!slots_[i].occupied) {
      uint8_t shortId = i + 1;
      slots_[i] = ConnectionSlot(true, connHandle, shortId);
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

uint8_t ConnectionTable::occupiedCount() const {
  uint8_t count = 0;
  for (uint8_t i = 0; i < MAX_CONNECTIONS; i++) {
    if (slots_[i].occupied) count++;
  }
  return count;
}
