# Join Button Gating and Default Connection Mode — Design

## Summary

Two small usability fixes to the setup screen in `src/ui/app.ts`:

1. The Join button is currently always clickable, even with an empty
   nickname (clicking it just silently no-ops via an early return). It
   should be visibly disabled until a nickname is entered, so the
   affordance matches the actual requirement.
2. The "Connection" mode `<select>` currently lists "Mock room" first,
   making it the default. Bluetooth should be the default instead, since
   it's the primary real-world use case.

## Scope

In scope:
- `joinButton.disabled` reflects whether `nicknameInput` has a non-empty
  (trimmed) value, updated live as the user types and correct on initial
  page load.
- Reorder the two `<option>` elements in `#mode` so `bluetooth` is first.
- Fix a bug this reorder would otherwise introduce: `roomLabel.hidden` is
  currently only set inside the `mode` select's `change` listener, never
  synced to the actual initial value on page load. Today this is masked
  because "Mock room" (which needs the room field visible) happens to be
  the default. Once Bluetooth becomes the default, the room-name field
  would incorrectly stay visible on load. Fix: extract the sync logic into
  a small function, call it once at mount in addition to on `change`.

Out of scope:
- No equivalent gating on the room-name field for mock mode (not
  requested — nickname-only, per the ask).
- No changes to `setSetupDisabled`, the connecting-status text, or any
  other behavior from the prior mobile-UI-polish work.
- No wire-protocol, transport, or `ChatController` changes.

## Design

### Join button gating

Add:

```ts
function updateJoinAvailability() {
  joinButton.disabled = nicknameInput.value.trim().length === 0
}
```

Call it once right after it's defined (so the button starts correctly
disabled, since the nickname input starts empty), and wire it to the
nickname input's `input` event:

```ts
nicknameInput.addEventListener('input', updateJoinAvailability)
updateJoinAvailability()
```

The existing early return in the click handler
(`const nickname = nicknameInput.value.trim(); if (!nickname) { ... return }`)
stays as-is — it becomes unreachable through normal UI interaction once the
button is properly disabled, but remains a harmless defense-in-depth guard
(e.g., against a disabled button somehow still receiving a click, or future
code reusing this handler). No change needed there.

This interacts safely with the existing `setSetupDisabled` helper: during a
connection attempt, `setSetupDisabled(true)` disables (and later
`setSetupDisabled(false)` re-enables) all four setup inputs together,
including `joinButton`. Since the nickname input itself is disabled for the
whole duration of an attempt, it cannot be edited to become empty mid-attempt,
so there's no race between the two disable mechanisms — whichever last set
`joinButton.disabled` reflects the correct state, because both agree
whenever they'd both apply (an attempt can only start with a non-empty
nickname, so `setSetupDisabled(false)` on failure always re-enables a button
that a fresh `updateJoinAvailability()` call would also enable).

### Default connection mode + room-label sync fix

Swap the two `<option>` elements in the template so `bluetooth` is listed
first:

```html
<select id="mode">
  <option value="bluetooth">Bluetooth hub</option>
  <option value="mock">Mock room (same-browser testing)</option>
</select>
```

Extract the existing inline arrow function from the `change` listener into
a named function, and call it once at mount:

```ts
function updateRoomLabelVisibility() {
  roomLabel.hidden = modeSelect.value === 'bluetooth'
}

modeSelect.addEventListener('change', updateRoomLabelVisibility)
updateRoomLabelVisibility()
```

## Testing

Same as the prior mobile-UI-polish work: no DOM/jsdom test environment
exists in this project, so this is verified via `npx tsc --noEmit`, the
existing Vitest regression suite (unaffected — this touches only
`src/ui/app.ts`), and a manual/live browser check confirming: (a) Join
starts disabled on page load, enables as soon as a nickname is typed and
re-disables if cleared; (b) the mode select shows "Bluetooth hub" selected
by default and the room-name field is hidden by default; (c) selecting
"Mock room" reveals the room-name field, matching prior behavior.
