# Firmware Build CI + Install Docs — Design

## Summary

Add a GitHub Actions workflow that builds the ESP32 hub firmware
(`firmware/`) with PlatformIO and publishes a single, ready-to-flash binary
as a workflow artifact. Pair it with a `firmware/README.md` documenting how
to build from source and how to flash the published binary onto a device
with `esptool.py`.

Today `firmware/` has no CI coverage at all — only the web app's
`.github/workflows/deploy.yml` exists. There's also no `firmware/README.md`.

## Scope

In scope:
- New `.github/workflows/firmware-build.yml`: builds `firmware/` with
  PlatformIO, merges the bootloader/partition-table/app binaries into one
  flashable image, uploads it as a workflow artifact.
- New `firmware/README.md`: build-from-source instructions plus step-by-step
  flashing instructions for the published artifact using `esptool.py`.

Out of scope:
- No GitHub Release creation or version tagging — artifact download from
  the Actions run is sufficient for now.
- No browser-based (ESP Web Tools) flashing path — CLI-only.
- No firmware code changes.
- No OTA update mechanism.

## Design

### Workflow: `.github/workflows/firmware-build.yml`

Triggers:
```yaml
on:
  push:
    branches: [main]
    paths: ["firmware/**"]
  workflow_dispatch: {}
```

Single `build` job on `ubuntu-latest`:

1. `actions/checkout@v4`
2. `actions/setup-python@v5` (Python 3.x)
3. Cache `~/.platformio`, keyed on `firmware/platformio.ini`'s hash — avoids
   re-downloading the ESP32 toolchain/framework on every run.
4. `pip install platformio esptool`
5. `pio run -d firmware` — produces `bootloader.bin`, `partitions.bin`, and
   `firmware.bin` under `firmware/.pio/build/esp32dev/`.
6. Merge into one flashable image:
   ```bash
   python -m esptool --chip esp32 merge_bin \
     -o merged-firmware.bin \
     --flash_mode dio --flash_freq 40m --flash_size 4MB \
     0x1000  firmware/.pio/build/esp32dev/bootloader.bin \
     0x8000  firmware/.pio/build/esp32dev/partitions.bin \
     0x10000 firmware/.pio/build/esp32dev/firmware.bin
   ```
   (`esptool` is a PlatformIO dependency already, but it's installed
   explicitly via pip so this step doesn't depend on PlatformIO's internal
   package layout.)
7. `actions/upload-artifact@v4` uploads `merged-firmware.bin` (artifact name
   `merged-firmware`).

Flash parameters (`dio` mode, `40m` freq, `4MB` size) match the default
`esp32dev` board profile used by `firmware/platformio.ini` — no board
override is configured there today, so these are the values PlatformIO's
own upload step would use.

### Documentation: `firmware/README.md`

Sections:

1. **Building from source** — `cd firmware && pio run` (assumes PlatformIO
   Core installed locally, per existing project convention).
2. **Getting a pre-built binary** — download the `merged-firmware` artifact
   from the relevant GitHub Actions run (linked from the commit that
   triggered it, or from a manual `workflow_dispatch` run), unzip to get
   `merged-firmware.bin`.
3. **Installing esptool** — `pip install esptool`.
4. **Finding the serial port** — `esptool.py --port <port> chip_id` as a
   sanity check, with example port names for Linux (`/dev/ttyUSB0`), macOS
   (`/dev/cu.usbserial-*`), and Windows (`COM3`).
5. **Flashing** — one command:
   ```bash
   esptool.py --chip esp32 --port <port> write_flash 0x0 merged-firmware.bin
   ```
6. **Troubleshooting** — hold the BOOT button while connecting on boards
   without auto-reset circuitry; `dialout` group / serial permissions on
   Linux if the port can't be opened.

## Testing

No automated tests apply — this is CI configuration and documentation, not
application code. Verification is:
- Trigger the workflow (via `workflow_dispatch` after merging) and confirm
  the build succeeds and `merged-firmware.bin` is attached to the run.
- Review `firmware/README.md` for accuracy against the actual workflow
  step names/artifact name.

Manual end-to-end flashing onto a physical ESP32 is left to the user (no
hardware available in this environment), same as the prior firmware plan's
Task 7.
