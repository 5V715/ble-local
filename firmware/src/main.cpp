#include <Arduino.h>
#include <NimBLEDevice.h>
#include "ble_protocol.h"

static NimBLECharacteristic* outboxCharacteristic = nullptr;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("BLE local chat hub booting");

  NimBLEDevice::init("BLE Local Chat Hub");

  NimBLEServer* server = NimBLEDevice::createServer();
  NimBLEService* service = server->createService(HUB_SERVICE_UUID);

  service->createCharacteristic(INBOX_CHARACTERISTIC_UUID, NIMBLE_PROPERTY::WRITE);
  outboxCharacteristic = service->createCharacteristic(OUTBOX_CHARACTERISTIC_UUID, NIMBLE_PROPERTY::NOTIFY);

  service->start();

  NimBLEAdvertising* advertising = NimBLEDevice::getAdvertising();
  advertising->addServiceUUID(HUB_SERVICE_UUID);
  advertising->start();

  Serial.println("Advertising started");
}

void loop() {
  delay(1000);
}
