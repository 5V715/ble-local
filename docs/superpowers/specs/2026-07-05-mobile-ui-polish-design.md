# Mobile UI Polish — Design

## Summary

The client SPA (`src/ui/app.ts`) currently has no CSS at all — `index.html`
is a bare unstyled shell, and the chat screen renders with default browser
styling. Manual testing on a phone (Chrome for Android) surfaced two
concrete usability problems on top of the general lack of styling:

1. Nothing on the setup screen indicates that a BLE connection attempt only
   starts once "Join" is clicked — a user selecting "Bluetooth hub" mode saw
   no feedback and assumed something was broken, when in fact tapping Join
   was the (undiscoverable) next step.
2. Messages have no timestamp, so there's no way to tell when something was
   sent, especially once a thread has more than a few lines.

This is a small, self-contained visual/usability pass, not a redesign of the
app's data model or protocol. It is explicitly scoped to be simple and
revisable later, not a final design system.

## Scope

In scope:
- One new stylesheet (`src/ui/app.css`), linked from `index.html`, giving the
  existing markup a mobile-first responsive layout: comfortable spacing,
  larger tap targets, a chat screen where the message list scrolls and the
  send-form stays pinned to the bottom of the viewport, and the roster
  rendered as a wrapped row of pill-style buttons.
- A visible "connecting" status shown immediately when Join is clicked,
  before the BLE device picker even appears, so the delay between tapping
  Join and the OS picker showing up reads as "in progress" rather than
  "nothing happened."
- The whole setup form (not just the Join button) disabled while a
  connection attempt is in progress, re-enabled if it fails.
- A per-message timestamp, captured client-side when a message is appended
  to the DOM (for both incoming and outgoing messages), rendered as a small
  muted `HH:MM` alongside the sender/text.

Out of scope:
- No wire-protocol or `IncomingChatMessage` changes — no sender-side send
  timestamp is transmitted; the timestamp is purely "when this client
  appended it," not "when the sender sent it." (These differ if the message
  was queued or arrives out of order, but that distinction isn't visible in
  this UI today and isn't worth wire-protocol churn for a first pass.)
- No message history persistence across reloads.
- No component library, CSS framework, dark mode, or i18n.
- No changes to `ChatController`, `RosterManager`, `GroupKeyManager`, or any
  transport code.

## Design

### Stylesheet and layout

`src/ui/app.css` is added and linked via a `<link>` tag in `index.html`
(no build-time CSS pipeline needed — Vite serves plain CSS files as-is).

Layout approach:
- `#chat` becomes a flex column sized to the viewport (`height: 100dvh` —
  `dvh` rather than `vh` avoids the mobile-browser address-bar resize jump).
  `#messages` is the flexible, scrollable child (`flex: 1; overflow-y: auto`).
  `#send-form` is a non-shrinking row pinned below it.
- `#roster` becomes `display: flex; flex-wrap: wrap; gap: ...` of
  pill-shaped `<button>`s (existing markup already builds one `<button>` per
  member in `src/ui/app.ts` — this is styling only, no markup restructuring
  needed there).
- `#setup` (the join screen) is a centered, comfortably-padded single column
  — labels stacked above their inputs (better for narrow phone widths than
  the browser's default inline label+input).
- Buttons and inputs get larger min-height/padding for touch targets (~44px
  minimum, the standard mobile tap-target guideline).
- Typography: system font stack (`-apple-system, Roboto, sans-serif`, etc.),
  no web fonts.

This is markup-compatible with the existing `src/ui/app.ts` structure —
no element IDs, classes, or DOM structure need to change for the CSS to
apply, except where noted below for the timestamp.

### Connecting feedback

`src/ui/app.ts`'s Join click handler already tracks `joinInProgress` and
disables `joinButton`. This design extends that:

- Disable every input inside `#setup` (nickname, mode select, room input),
  not just the Join button, for the duration of the attempt — prevents a
  user from editing the nickname mid-connect and getting confused about
  which value actually gets used.
- Immediately after entering the Bluetooth branch (before
  `bleTransport.connect()` — i.e. before the OS picker can appear), set
  `connectionStatusEl.textContent = 'Connecting… choose the hub from the
  Bluetooth prompt.'` This reuses the existing `connectionStatusEl` element
  and the existing `onConnectionStateChange` wiring already clears/updates
  it once `'connected'` fires — no new element needed.
- On failure (the existing `catch` block around `controller.start()`),
  clear `connectionStatusEl.textContent` and re-enable all the setup inputs
  (not just the Join button) alongside the existing error-message display —
  otherwise the stale "Connecting…" text would sit right next to the error
  message.

### Timestamps

`appendMessage(text: string)` (`src/ui/app.ts:187`) changes to
`appendMessage(line: string, sentAt: number)`, called with `Date.now()` at
each of its three call sites (incoming message handler, and the two
`sendGroupMessage`/`sendDirectMessage` outgoing paths). It renders two child
nodes instead of one: a `<time>` element (small, muted, `HH:MM` via
`toLocaleTimeString` with `hour: '2-digit', minute: '2-digit'`) followed by
the existing text content — both created via `createElement`/`textContent`
as today (the file already has a comment explaining why: nicknames come
from attacker-controlled presence broadcasts and must never be parsed as
markup — the timestamp path follows the same rule since it sits in the same
function).

## Testing

This is UI/CSS work with no new business logic — the existing Vitest suite
(`src/ui` has no test file today; `app.ts` is exercised indirectly through
`chat-controller.test.ts`'s mocked transports, not through the DOM) is
unaffected and needs no new automated tests. Verification is manual:
`npm run dev`, exercise the join flow and a chat thread in a real mobile
browser viewport (or Chrome DevTools device emulation), confirm the
connecting-status text appears immediately on Join, the layout doesn't
break on a narrow viewport, and timestamps render on both sent and received
messages.
