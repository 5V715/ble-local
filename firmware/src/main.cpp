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

  server->start();

  NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(HUB_SERVICE_UUID);
  advertising->start();

  Serial.println("Advertising started");
}

void loop() {
  delay(1000);
}
