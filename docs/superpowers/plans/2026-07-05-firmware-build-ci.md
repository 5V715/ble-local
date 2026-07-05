# Firmware Build CI + Install Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions workflow that builds the ESP32 hub firmware with PlatformIO and publishes a single ready-to-flash binary, plus a `firmware/README.md` documenting how to build from source and flash that binary with `esptool`.

**Architecture:** One new workflow file that installs PlatformIO + esptool via pip, runs `pio run`, merges the three build outputs (bootloader/partition-table/app) into one image with `esptool merge-bin`, and uploads it as a workflow artifact. One new README documenting the download-and-flash path with `esptool`.

**Tech Stack:** GitHub Actions, Python/pip, PlatformIO Core, esptool (both already vendored as PlatformIO's own flashing dependency, but installed explicitly here so this workflow doesn't depend on PlatformIO's internal package layout).

## Global Constraints

- No firmware source code changes — this plan touches only `.github/workflows/firmware-build.yml` and `firmware/README.md`.
- No GitHub Release creation or version tagging — the artifact is downloaded from the Actions run itself.
- No browser-based (ESP Web Tools) flashing path — CLI-only, using `esptool`.
- Use modern hyphenated esptool subcommands (`merge-bin`, `write-flash`, `chip-id`, `flash-id`) and flags (`--flash-mode`, `--flash-freq`, `--flash-size`) — the underscored forms (`merge_bin`, `write_flash`, `--flash_mode`, etc.) are deprecated in esptool 5.x and print warnings. Verified locally: `esptool` version 5.3.1 (installed via `pip install esptool` in a throwaway venv) accepts the hyphenated forms with zero warnings; the underscored forms work but print `Deprecated: ...` warnings for each one.
- Flash parameters for the merge step are `--flash-mode dio --flash-freq 40m --flash-size 4MB` — these match `firmware/platformio.ini`'s `esp32dev` board profile (no board override is configured there), and were confirmed by actually running `pio run -d firmware` locally (PlatformIO Core 6.1.19), which produced `firmware/.pio/build/esp32dev/bootloader.bin` (17536 bytes), `partitions.bin` (3072 bytes), and `firmware.bin` (606624 bytes) — exactly the three files and paths this plan's merge step expects.
- The full local dry run (`pio run -d firmware` then `esptool --chip esp32 merge-bin ...` with the exact args above) produced a 672160-byte `merged-firmware.bin` with zero errors or warnings — the workflow's build+merge steps in Task 1 are a verified-working command sequence, not a guess.

---

### Task 1: GitHub Actions workflow to build and merge the firmware image

**Files:**
- Create: `.github/workflows/firmware-build.yml`

**Interfaces:**
- Produces: a workflow artifact named `merged-firmware` containing one file, `merged-firmware.bin`, flashable at offset `0x0`. Task 2's documentation refers to this artifact name and filename verbatim.

- [ ] **Step 1: Write the workflow file**

Create `.github/workflows/firmware-build.yml`:

```yaml
name: Build Firmware

on:
  push:
    branches: [main]
    paths: ["firmware/**"]
  workflow_dispatch: {}

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Cache PlatformIO
        uses: actions/cache@v4
        with:
          path: ~/.platformio
          key: platformio-${{ hashFiles('firmware/platformio.ini') }}

      - name: Install PlatformIO and esptool
        run: pip install platformio esptool

      - name: Build firmware
        run: pio run -d firmware

      - name: Merge into one flashable image
        run: |
          esptool --chip esp32 merge-bin \
            -o merged-firmware.bin \
            --flash-mode dio --flash-freq 40m --flash-size 4MB \
            0x1000  firmware/.pio/build/esp32dev/bootloader.bin \
            0x8000  firmware/.pio/build/esp32dev/partitions.bin \
            0x10000 firmware/.pio/build/esp32dev/firmware.bin

      - uses: actions/upload-artifact@v4
        with:
          name: merged-firmware
          path: merged-firmware.bin
```

- [ ] **Step 2: Validate YAML syntax**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/firmware-build.yml'))"
```

Expected: no output, exit code 0 (a syntax error would raise `yaml.scanner.ScannerError` or similar and print a traceback).

- [ ] **Step 3: Locally reproduce the workflow's build and merge steps**

This project has no `act`/GitHub-Actions-local-runner available, so reproduce the two commands that matter (`pio run` and the `esptool merge-bin` call) directly, in an isolated venv, to catch any command/path mistakes before relying on a real CI run:

```bash
python3 -m venv /tmp/pio-verify
source /tmp/pio-verify/bin/activate
pip install -q platformio esptool
pio run -d firmware
esptool --chip esp32 merge-bin \
  -o /tmp/merged-firmware.bin \
  --flash-mode dio --flash-freq 40m --flash-size 4MB \
  0x1000  firmware/.pio/build/esp32dev/bootloader.bin \
  0x8000  firmware/.pio/build/esp32dev/partitions.bin \
  0x10000 firmware/.pio/build/esp32dev/firmware.bin
ls -la /tmp/merged-firmware.bin
deactivate
```

Expected: `pio run` ends with `[SUCCESS]`; the `esptool merge-bin` command prints `Wrote 0x... bytes to file '/tmp/merged-firmware.bin', ready to flash to offset 0x0.` with no `Deprecated` warnings; `ls -la` shows a file a few hundred KB in size (the verified run in this plan's Global Constraints produced 672160 bytes).

Clean up afterward so the repo stays clean:
```bash
rm -rf /tmp/pio-verify /tmp/merged-firmware.bin firmware/.pio
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/firmware-build.yml
git commit -m "ci: add GitHub Actions workflow to build and merge firmware image"
```

---

### Task 2: Firmware build-and-flash documentation

**Files:**
- Create: `firmware/README.md`

**Interfaces:**
- Consumes: the `merged-firmware` artifact name and `merged-firmware.bin` filename produced by Task 1's workflow — must be referenced verbatim.

- [ ] **Step 1: Write the README**

Create `firmware/README.md`:

```markdown
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
```

- [ ] **Step 2: Cross-check against Task 1's workflow**

Confirm the artifact name (`merged-firmware`), the workflow filename (`.github/workflows/firmware-build.yml`, referenced in the Actions-tab link), and the merged output filename (`merged-firmware.bin`) in the README exactly match what Task 1's workflow actually produces. Re-read both files side by side; fix any mismatch before committing.

- [ ] **Step 3: Commit**

```bash
git add firmware/README.md
git commit -m "docs: add firmware build and flashing instructions"
```
