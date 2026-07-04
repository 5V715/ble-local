#include <Arduino.h>
#include <NimBLEDevice.h>
#include "ble_protocol.h"

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("BLE local chat hub booting");
  NimBLEDevice::init("BLE Local Chat Hub");
}

void loop() {
  delay(1000);
}
