# Join Button Gating and Default Connection Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disable the Join button until a nickname is entered, and make "Bluetooth hub" the default-selected connection mode instead of "Mock room."

**Architecture:** Two small, independent edits to the same `mountApp` function in `src/ui/app.ts`: a new nickname-driven enable/disable function for the Join button, and a reordered `<option>` list paired with a fix to sync the room-name field's visibility on initial load (previously only synced on the `change` event, which happened to be masked by "Mock room" being the old default).

**Tech Stack:** TypeScript, no new dependencies.

## Global Constraints

- No DOM/jsdom test environment exists in this project (`vite.config.ts`'s `test` block uses `environment: 'node'`). Verification is `npx tsc --noEmit`, the existing Vitest regression suite (`npm test`), and a concrete manual/live browser check — not new automated tests.
- This plan touches only `src/ui/app.ts` — no changes to `index.html`, `src/ui/app.css`, or any other file.
- No changes to `setSetupDisabled`, the connecting-status text, or any other behavior from the prior mobile-UI-polish work.
- No gating on the room-name field (mock mode) — nickname-only, per the spec's explicit scope.

---

### Task 1: Join button gating + default connection mode

**Files:**
- Modify: `src/ui/app.ts`

**Interfaces:**
- Consumes: existing `nicknameInput`, `joinButton`, `modeSelect`, `roomLabel` element references (all already declared in `mountApp`).
- Produces: `updateJoinAvailability(): void` and `updateRoomLabelVisibility(): void` — both local to `mountApp`, not consumed by any other file.

- [ ] **Step 1: Reorder the mode `<option>` elements**

In `src/ui/app.ts`, inside the `root.innerHTML` template string, find:

```html
        <select id="mode">
          <option value="mock">Mock room (same-browser testing)</option>
          <option value="bluetooth">Bluetooth hub</option>
        </select>
```

Replace with:

```html
        <select id="mode">
          <option value="bluetooth">Bluetooth hub</option>
          <option value="mock">Mock room (same-browser testing)</option>
        </select>
```

- [ ] **Step 2: Extract and sync the room-label visibility function**

Find:

```ts
  modeSelect.addEventListener('change', () => {
    roomLabel.hidden = modeSelect.value === 'bluetooth'
  })
```

Replace with:

```ts
  function updateRoomLabelVisibility() {
    roomLabel.hidden = modeSelect.value === 'bluetooth'
  }

  modeSelect.addEventListener('change', updateRoomLabelVisibility)
  updateRoomLabelVisibility()
```

- [ ] **Step 3: Add Join button gating on the nickname field**

Immediately after the block from Step 2 (the `modeSelect.addEventListener(...)` line and the `updateRoomLabelVisibility()` call), add:

```ts
  function updateJoinAvailability() {
    joinButton.disabled = nicknameInput.value.trim().length === 0
  }

  nicknameInput.addEventListener('input', updateJoinAvailability)
  updateJoinAvailability()
```

- [ ] **Step 4: Type-check and regression-test**

```bash
npx tsc --noEmit
npm test
```

Expected: `tsc` prints no output; `npm test` reports all existing tests still passing (no test touches `app.ts`'s DOM behavior, so this is a pure regression check).

- [ ] **Step 5: Manual verification**

```bash
npm run dev
```

Open the printed local URL. Confirm:
- On page load, the Join button is disabled (grayed out, unclickable), the "Connection" dropdown shows "Bluetooth hub" selected, and the "Room name" field is hidden.
- Typing a nickname enables the Join button; clearing the nickname field back to empty disables it again.
- Selecting "Mock room" from the dropdown reveals the "Room name" field again (existing `change`-driven behavior, now also correct on load).

- [ ] **Step 6: Commit**

```bash
git add src/ui/app.ts
git commit -m "feat: disable Join until nickname entered, default to Bluetooth mode"
```
