#include "system_frames.h"

void sendYourId(NimBLECharacteristic* outbox, uint16_t connHandle, uint8_t assignedShortId) {
  uint8_t frame[2] = { SYSTEM_FRAME_YOUR_ID, assignedShortId };
  if (!outbox->notify(frame, sizeof(frame), connHandle)) {
    Serial.printf("notify(YOUR_ID) failed for connection %u\n", connHandle);
  }
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
  if (!outbox->notify(frame, 2 + count, connHandle)) {
    Serial.printf("notify(MEMBER_LIST) failed for connection %u\n", connHandle);
  }
}

void broadcastMemberJoined(NimBLECharacteristic* outbox, const ConnectionTable& table, uint8_t joinedShortId) {
  uint16_t handles[MAX_CONNECTIONS];
  uint8_t count = table.otherConnHandles(joinedShortId, handles);

  uint8_t frame[2] = { SYSTEM_FRAME_MEMBER_JOINED, joinedShortId };
  for (uint8_t i = 0; i < count; i++) {
    if (!outbox->notify(frame, sizeof(frame), handles[i])) {
      Serial.printf("notify(MEMBER_JOINED) failed for connection %u\n", handles[i]);
    }
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
    if (!outbox->notify(frame, sizeof(frame), handles[i])) {
      Serial.printf("notify(MEMBER_LEFT) failed for connection %u\n", handles[i]);
    }
  }
}
