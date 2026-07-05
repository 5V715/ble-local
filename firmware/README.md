# ESP32 Hub Firmware

BLE relay hub firmware for the ble-local chat app, built with [PlatformIO](https://platformio.org/).

## Building from source

Requires [PlatformIO Core](https://docs.platformio.org/en/latest/core/installation/index.html) (`pip install platformio`).

```bash
cd firmware
pio run
```

The build output is `.pio/build/esp32dev/firmware.bin`, plus `bootloader.bin` and `partitions.bin` alongside it — three separate files that each need flashing at a different offset. See "Flashing" below for the easier route: a single merged binary that flashes at offset `0x0`.

## Getting a pre-built binary

Every push to `main` that touches `firmware/` (and every manual run) builds the firmware via the "Build Firmware" GitHub Actions workflow and publishes a single ready-to-flash binary:

1. Open the [Actions tab](../actions/workflows/firmware-build.yml) and pick the run you want (or trigger one yourself with "Run workflow").
2. Download the `merged-firmware` artifact from the run summary page.
3. Unzip it — you'll get `merged-firmware.bin`.

## Installing esptool

```bash
pip install esptool
```

## Finding your device's serial port

Plug in the ESP32 via USB, then check:

- **Linux:** usually `/dev/ttyUSB0` (run `ls /dev/ttyUSB*` if unsure)
- **macOS:** usually `/dev/cu.usbserial-*` (run `ls /dev/cu.usbserial-*` if unsure)
- **Windows:** a `COM` port, e.g. `COM3` (check Device Manager)

Sanity-check the connection:

```bash
esptool.py --port <port> chip-id
```

If this prints chip info, the port and cable are good.

## Flashing

Flash the merged binary in one command:

```bash
esptool.py --chip esp32 --port <port> write-flash 0x0 merged-firmware.bin
```

## Troubleshooting

- **No response / "Failed to connect":** some boards without auto-reset circuitry need you to hold the **BOOT** button while the flash command starts, releasing it once it prints "Connecting...".
- **Permission denied opening the port (Linux):** add your user to the `dialout` group (`sudo usermod -aG dialout $USER`, then log out and back in), or run the command with `sudo` as a one-off.
