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

  server->start();

  NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(HUB_SERVICE_UUID);
  advertising->start();

  Serial.println("Advertising started");
}

void loop() {
  delay(1000);
}
