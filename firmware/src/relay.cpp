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
      if (!outbox->notify(data, length, handles[i])) {
        Serial.printf("relay notify (broadcast) failed for connection %u\n", handles[i]);
      }
    }
  } else {
    uint16_t targetHandle;
    if (table.connHandleFor(recipient, &targetHandle)) {
      if (!outbox->notify(data, length, targetHandle)) {
        Serial.printf("relay notify (unicast) failed for connection %u\n", targetHandle);
      }
    }
  }
}
