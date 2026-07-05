# Mobile UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the client SPA (currently completely unstyled) a simple mobile-first layout, make it visibly obvious that a BLE connection attempt starts the moment Join is clicked, and show a timestamp on every chat message.

**Architecture:** One new plain CSS file (`src/ui/app.css`), linked from `index.html`, restyles the existing markup in `src/ui/app.ts` with no structural changes to that markup. Two small, independent behavior changes land directly in `src/ui/app.ts`: (1) the whole setup form disables and shows a "Connecting…" status the instant Join is clicked in Bluetooth mode, clearing on failure; (2) `appendMessage` takes a timestamp and renders a `<time>` element ahead of the message text. No protocol, transport, or `ChatController` changes.

**Tech Stack:** Plain CSS (no framework, no preprocessor), TypeScript, Vite (serves `.css` referenced from `index.html` as-is — no build config changes needed), Vitest for the existing regression suite.

## Global Constraints

- No DOM/jsdom test environment exists in this project — `vitest.config.ts` uses `environment: 'node'`. Per the spec's explicit scope decision, none of this plan's UI-behavior changes get new automated tests; verification is `npx tsc --noEmit`, the existing regression suite (`npm test`), and a concrete manual browser check written into each task.
- No new dependencies, no CSS framework, no component library, no build config changes.
- No changes to `src/chat/chat-controller.ts`, `src/room/*`, `src/transport/*`, or any wire protocol — this plan touches only `index.html`, `src/ui/app.css` (new), and `src/ui/app.ts`.
- `[hidden] { display: none !important; }` must be the first rule in the new stylesheet. `src/ui/app.ts` toggles the `hidden` attribute on `#setup` and `#chat` to switch screens; the UA stylesheet's `[hidden]` rule has lower specificity than an ID selector, so without this override, this plan's own `#chat { display: flex; ... }` rule would make the chat screen visible even while marked `hidden`, showing both screens at once on first load. This is a real regression risk introduced by this plan's own CSS, not a pre-existing bug.
- Timestamps are display-side only: captured via `Date.now()` at the moment a message is appended to the DOM, not transmitted over the wire. No `IncomingChatMessage` field changes.

---

### Task 1: Mobile-first stylesheet

**Files:**
- Create: `src/ui/app.css`
- Modify: `index.html`

**Interfaces:**
- Consumes: the existing element IDs in `src/ui/app.ts`'s template string (`#setup`, `#chat`, `#connection-status`, `#my-fingerprint`, `#roster`, `#thread-label`, `#messages`, `#send-form`, `#message-input`, `#setup-error`, `#join`, `#room-label`) — this task styles them by ID/tag selector only, no markup changes.
- Produces: nothing consumed by later tasks — Tasks 2 and 3 change behavior in `app.ts`, not styling.

- [ ] **Step 1: Create `src/ui/app.css`**

```css
[hidden] {
  display: none !important;
}

:root {
  color-scheme: light dark;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

#app {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}

button,
input,
select {
  font-size: 1rem;
  min-height: 44px;
}

/* Setup (join) screen */
#setup {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-width: 28rem;
  width: 100%;
  margin: 0 auto;
  padding: 1.5rem 1rem;
}

#setup label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

#setup-error {
  min-height: 1.25rem;
}

/* Chat screen */
#chat {
  display: flex;
  flex-direction: column;
  height: 100dvh;
}

#connection-status,
#my-fingerprint,
#thread-label {
  flex-shrink: 0;
  padding: 0.5rem 1rem;
}

#roster {
  display: flex;
  flex-wrap: wrap;
  flex-shrink: 0;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
}

#roster button {
  min-height: 36px;
  border-radius: 999px;
  padding: 0.4rem 0.9rem;
}

#messages {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem 1rem;
}

#messages > div {
  padding: 0.25rem 0;
}

#messages time {
  margin-right: 0.5rem;
  color: gray;
  font-size: 0.8rem;
}

#send-form {
  display: flex;
  flex-shrink: 0;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-top: 1px solid currentColor;
}

#message-input {
  flex: 1;
}
```

- [ ] **Step 2: Link the stylesheet from `index.html`**

Current `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>BLE Local Chat</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Replace with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>BLE Local Chat</title>
    <link rel="stylesheet" href="/src/ui/app.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 3: Type-check and regression-test**

```bash
npx tsc --noEmit
npm test
```

Expected: `tsc` prints no output; `npm test` reports all existing tests still passing (no test touches `index.html` or CSS, so this is a pure regression check).

- [ ] **Step 4: Manual verification**

```bash
npm run dev
```

Open the printed local URL in a desktop browser, then open Chrome DevTools device toolbar (or resize the window to ~375px wide, an iPhone SE-ish width). Confirm:
- The join screen is a single centered column, not the browser's default left-aligned stacked labels.
- Nickname/mode/room inputs and the Join button are comfortably tall (not the tiny default browser controls).
- After entering a nickname and clicking Join in "Mock room" mode, the chat screen shows the message input pinned to the bottom of the viewport and the (empty) message area filling the space above it — resize the window shorter/taller to confirm the input bar stays pinned rather than scrolling off.

- [ ] **Step 5: Commit**

```bash
git add index.html src/ui/app.css
git commit -m "feat: add mobile-first stylesheet for the chat UI"
```

---

### Task 2: Connecting-status feedback and setup-form disabling

**Files:**
- Modify: `src/ui/app.ts`

**Interfaces:**
- Consumes: existing `nicknameInput`, `modeSelect`, `roomInput`, `joinButton`, `connectionStatusEl`, `setupError` element references (all already declared in `mountApp`); existing `joinInProgress` flag and the Join click handler's existing early-return points.
- Produces: a `setSetupDisabled(disabled: boolean)` helper — not consumed by Task 3, which touches a different part of the same function, but keep it in scope for anyone extending the setup form later.

- [ ] **Step 1: Add the `setupInputs` list and `setSetupDisabled` helper**

In `src/ui/app.ts`, immediately after the existing block of `const ... = root.querySelector...` element lookups (right after the `messageInput` declaration, before the `let activeThreadShortId` line), insert:

```ts
  const setupInputs: Array<HTMLInputElement | HTMLSelectElement | HTMLButtonElement> = [
    nicknameInput,
    modeSelect,
    roomInput,
    joinButton
  ]

  function setSetupDisabled(disabled: boolean) {
    for (const input of setupInputs) input.disabled = disabled
  }
```

- [ ] **Step 2: Replace every `joinButton.disabled = ...` with `setSetupDisabled(...)`**

There are four occurrences inside the `joinButton.addEventListener('click', async () => { ... })` handler. Replace each:

1. Right after `joinInProgress = true`:

```ts
    if (joinInProgress) return
    joinInProgress = true
    setSetupDisabled(true)
```

2. Inside the empty-nickname early return:

```ts
    const nickname = nicknameInput.value.trim()
    if (!nickname) {
      joinInProgress = false
      setSetupDisabled(false)
      return
    }
```

3. Inside the unsupported-browser early return:

```ts
      if (!isWebBluetoothSupported()) {
        setupError.textContent = 'This browser does not support Web Bluetooth. Use Chrome or a Chromium-based browser.'
        joinInProgress = false
        setSetupDisabled(false)
        return
      }
```

4. Inside the empty-room early return:

```ts
      const room = roomInput.value.trim()
      if (!room) {
        joinInProgress = false
        setSetupDisabled(false)
        return
      }
```

- [ ] **Step 3: Show the connecting status immediately on entering Bluetooth mode**

Immediately after the unsupported-browser check (from Step 2.3) and before `const bleTransport = new WebBluetoothTransport()`, add one line:

```ts
      connectionStatusEl.textContent = 'Connecting… choose the hub from the Bluetooth prompt.'
      const bleTransport = new WebBluetoothTransport()
```

- [ ] **Step 4: Clear the connecting status and re-enable the form on connect failure**

Find the existing catch block:

```ts
    try {
      await controller.start()
    } catch (error) {
      setupError.textContent = error instanceof Error ? error.message : 'Failed to connect.'
      joinInProgress = false
      joinButton.disabled = false
      return
    }
```

Replace with:

```ts
    try {
      await controller.start()
    } catch (error) {
      connectionStatusEl.textContent = ''
      setupError.textContent = error instanceof Error ? error.message : 'Failed to connect.'
      joinInProgress = false
      setSetupDisabled(false)
      return
    }
```

- [ ] **Step 5: Type-check and regression-test**

```bash
npx tsc --noEmit
npm test
```

Expected: `tsc` prints no output (confirms `setupInputs`' union element type accepts all four elements and `.disabled` assignment type-checks); `npm test` reports all existing tests still passing.

- [ ] **Step 6: Manual verification**

```bash
npm run dev
```

Open the app, enter a nickname, select "Bluetooth hub" mode, and click Join:
- Confirm the status text "Connecting… choose the hub from the Bluetooth prompt." appears immediately (before or as the browser's Bluetooth device chooser opens), not after some delay.
- Confirm the nickname input, mode select, and room input are all disabled (grayed out / non-interactive) while the attempt is in progress.
- Cancel the Bluetooth device picker (or, if no BLE hardware is available, let `connect()` reject). Confirm the connecting status text clears, the error message appears in its place, and the nickname/mode/room inputs become editable again.

- [ ] **Step 7: Commit**

```bash
git add src/ui/app.ts
git commit -m "feat: show connecting status and disable setup form during Bluetooth join"
```

---

### Task 3: Message timestamps

**Files:**
- Modify: `src/ui/app.ts`

**Interfaces:**
- Consumes: the existing `appendMessage` call sites (the `controller.onMessage` callback, and the two branches of the `sendForm` submit handler).
- Produces: `appendMessage(text: string, sentAt: number): void` (signature change from `appendMessage(text: string): void`) — this is a private function local to `mountApp`, not exported, so no other file is affected.

- [ ] **Step 1: Change the three call sites to pass a timestamp**

In `controller.onMessage`'s callback:

```ts
    controller.onMessage((msg: IncomingChatMessage) => {
      const shouldShow = msg.scope === 'group' ? activeThreadShortId === null : activeThreadShortId === msg.fromShortId
      if (shouldShow) appendMessage(`${msg.nickname}: ${msg.text}`, Date.now())
    })
```

In the `sendForm` submit handler (both branches):

```ts
    sendForm.addEventListener('submit', async (event) => {
      event.preventDefault()
      const text = messageInput.value.trim()
      if (!text) return
      messageInput.value = ''
      if (activeThreadShortId === null) {
        await controller.sendGroupMessage(text)
        appendMessage(`me: ${text}`, Date.now())
      } else {
        await controller.sendDirectMessage(activeThreadShortId, text)
        appendMessage(`me: ${text}`, Date.now())
      }
    })
```

- [ ] **Step 2: Update `appendMessage` to accept and render the timestamp**

Replace:

```ts
  function appendMessage(text: string) {
    const line = document.createElement('div')
    line.textContent = text
    messagesEl.appendChild(line)
  }
```

With:

```ts
  function appendMessage(text: string, sentAt: number) {
    const line = document.createElement('div')

    const time = document.createElement('time')
    time.textContent = new Date(sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    line.appendChild(time)

    // createElement/textContent, not innerHTML — see the roster-rendering
    // comment above: message text can come from a peer's own (attacker-
    // controlled) chat payload and must never be parsed as markup.
    line.appendChild(document.createTextNode(text))

    messagesEl.appendChild(line)
  }
```

- [ ] **Step 3: Type-check and regression-test**

```bash
npx tsc --noEmit
npm test
```

Expected: `tsc` prints no output; `npm test` reports all existing tests still passing.

- [ ] **Step 4: Manual verification**

```bash
npm run dev
```

Open two browser tabs, join the same mock room from both with different nicknames, and send a message from each. Confirm every message line (both sent and received) shows a small muted time (`HH:MM`) before the message text, and that the time reflects roughly the current time on your machine.

- [ ] **Step 5: Commit**

```bash
git add src/ui/app.ts
git commit -m "feat: show a timestamp on each chat message"
```
