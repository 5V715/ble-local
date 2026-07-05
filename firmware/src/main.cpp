#include <Arduino.h>
#include <NimBLEDevice.h>
#include "ble_protocol.h"
#include "connection_table.h"
#include "system_frames.h"
#include "relay.h"

static NimBLECharacteristic* outboxCharacteristic = nullptr;
static NimBLEAdvertising* advertising = nullptr;
static ConnectionTable connectionTable;

// Publishes the number of free connection slots as one-byte service data
// on HUB_SERVICE_UUID, so a scanning client can see room availability
// before attempting to connect. The primary advertising packet is already
// packed with flags + the 128-bit service UUID (close to the 31-byte
// legacy limit), so the slot count goes in the scan response packet
// instead — built fresh each call and pushed wholesale, which both avoids
// exceeding the payload budget and sidesteps NimBLEAdvertisementData's
// service-data field simply appending rather than replacing on repeat
// calls. Safe to call before advertising has started or while it's live.
static void advertiseOpenSlots() {
  uint8_t openSlots = MAX_CONNECTIONS - connectionTable.occupiedCount();
  NimBLEAdvertisementData scanResponse;
  scanResponse.setServiceData(NimBLEUUID(HUB_SERVICE_UUID), std::string(1, (char)openSlots));
  advertising->setScanResponseData(scanResponse);
}

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
    advertiseOpenSlots();

    // Onboarding notifications (your-id / member-list / member-joined) are
    // deliberately NOT sent here. onConnect fires at BLE link-connect time,
    // before this client has discovered the outbox characteristic or
    // written its CCCD to subscribe to notifications — a notify() targeted
    // at this brand-new connHandle at this point is silently dropped by
    // every client BLE stack (it hasn't subscribed yet). They're sent from
    // OutboxCallbacks::onSubscribe below instead, once this connection has
    // actually subscribed and can receive them.

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
    advertiseOpenSlots();

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

class OutboxCallbacks : public NimBLECharacteristicCallbacks {
  // Fires whenever a connection writes the outbox characteristic's CCCD.
  // subValue is 0 on unsubscribe, non-zero (notifications and/or
  // indications enabled) on subscribe. This is the earliest point at which
  // a notify() targeted at connInfo's connHandle is actually deliverable,
  // so the new connection's onboarding frames are sent from here rather
  // than from HubServerCallbacks::onConnect.
  void onSubscribe(NimBLECharacteristic* characteristic, NimBLEConnInfo& connInfo, uint16_t subValue) override {
    if (subValue == 0) {
      return;
    }

    uint16_t connHandle = connInfo.getConnHandle();
    int16_t shortId = connectionTable.shortIdFor(connHandle);
    if (shortId == INVALID_SHORT_ID) {
      return;
    }

    Serial.printf("Connection %u (short id %d) subscribed, sending onboarding frames\n", connHandle, shortId);

    sendYourId(outboxCharacteristic, connHandle, (uint8_t)shortId);
    sendMemberList(outboxCharacteristic, connHandle, connectionTable, (uint8_t)shortId);
    broadcastMemberJoined(outboxCharacteristic, connectionTable, (uint8_t)shortId);
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
  outboxCharacteristic->setCallbacks(new OutboxCallbacks());

  server->start();

  advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(HUB_SERVICE_UUID);
  advertising->enableScanResponse(true);
  advertiseOpenSlots();
  advertising->start();

  Serial.println("Advertising started");
}

void loop() {
  delay(1000);
}
