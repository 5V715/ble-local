import { ChatController, type IncomingChatMessage } from '../chat/chat-controller'
import type { Transport } from '../transport/transport'
import { MockHubTransport } from '../transport/mock-hub-transport'
import { WebBluetoothTransport, isWebBluetoothSupported } from '../transport/web-bluetooth-transport'
import { RosterManager } from '../room/roster-manager'
import { GroupKeyManager } from '../room/group-key-manager'
import { loadOrCreateIdentity, fingerprint } from '../identity/identity-manager'

export async function mountApp(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div id="setup">
      <label>Nickname <input id="nickname" placeholder="alice" /></label>
      <label>
        Connection
        <select id="mode">
          <option value="mock">Mock room (same-browser testing)</option>
          <option value="bluetooth">Bluetooth hub</option>
        </select>
      </label>
      <label id="room-label">Room name <input id="room" placeholder="living-room" /></label>
      <div id="setup-error" style="color: red"></div>
      <button id="join">Join</button>
    </div>
    <div id="chat" hidden>
      <div id="connection-status"></div>
      <div id="roster"></div>
      <div id="thread-label"></div>
      <div id="messages"></div>
      <form id="send-form">
        <input id="message-input" placeholder="Type a message…" autocomplete="off" />
        <button type="submit">Send</button>
      </form>
    </div>
  `

  const setupEl = root.querySelector<HTMLDivElement>('#setup')!
  const chatEl = root.querySelector<HTMLDivElement>('#chat')!
  const rosterEl = root.querySelector<HTMLDivElement>('#roster')!
  const threadLabelEl = root.querySelector<HTMLDivElement>('#thread-label')!
  const messagesEl = root.querySelector<HTMLDivElement>('#messages')!
  const connectionStatusEl = root.querySelector<HTMLDivElement>('#connection-status')!
  const nicknameInput = root.querySelector<HTMLInputElement>('#nickname')!
  const modeSelect = root.querySelector<HTMLSelectElement>('#mode')!
  const roomLabel = root.querySelector<HTMLLabelElement>('#room-label')!
  const roomInput = root.querySelector<HTMLInputElement>('#room')!
  const setupError = root.querySelector<HTMLDivElement>('#setup-error')!
  const joinButton = root.querySelector<HTMLButtonElement>('#join')!
  const sendForm = root.querySelector<HTMLFormElement>('#send-form')!
  const messageInput = root.querySelector<HTMLInputElement>('#message-input')!

  let activeThreadShortId: number | null = null // null = group room
  let joinInProgress = false

  modeSelect.addEventListener('change', () => {
    roomLabel.hidden = modeSelect.value === 'bluetooth'
  })

  joinButton.addEventListener('click', async () => {
    // Guard against a second click starting a second controller/transport
    // before the first join's awaits resolve.
    if (joinInProgress) return
    joinInProgress = true
    joinButton.disabled = true

    const nickname = nicknameInput.value.trim()
    if (!nickname) {
      joinInProgress = false
      joinButton.disabled = false
      return
    }
    setupError.textContent = ''

    let transport: Transport
    if (modeSelect.value === 'bluetooth') {
      if (!isWebBluetoothSupported()) {
        setupError.textContent = 'This browser does not support Web Bluetooth. Use Chrome or a Chromium-based browser.'
        joinInProgress = false
        joinButton.disabled = false
        return
      }
      const bleTransport = new WebBluetoothTransport()
      bleTransport.onConnectionStateChange((state) => {
        connectionStatusEl.textContent = state === 'connected' ? '' : `Bluetooth: ${state}…`
      })
      transport = bleTransport
    } else {
      const room = roomInput.value.trim()
      if (!room) {
        joinInProgress = false
        joinButton.disabled = false
        return
      }
      transport = new MockHubTransport(room)
    }

    const identity = await loadOrCreateIdentity(indexedDB, nickname)
    const roster = new RosterManager()
    const groupKey = new GroupKeyManager()
    const controller = new ChatController(transport, identity, roster, groupKey)

    controller.onMessage((msg: IncomingChatMessage) => {
      const shouldShow = msg.scope === 'group' ? activeThreadShortId === null : activeThreadShortId === msg.fromShortId
      if (shouldShow) appendMessage(`${msg.nickname}: ${msg.text}`)
    })

    try {
      await controller.start()
    } catch (error) {
      setupError.textContent = error instanceof Error ? error.message : 'Failed to connect.'
      joinInProgress = false
      joinButton.disabled = false
      return
    }

    setupEl.hidden = true
    chatEl.hidden = false
    renderThreadLabel()

    setInterval(() => {
      // Built with createElement/textContent, not innerHTML — nickname comes
      // from a peer's own PRESENCE broadcast (attacker-controlled) and must
      // never be parsed as markup.
      rosterEl.replaceChildren()

      for (const m of roster.getAllMembers()) {
        const span = document.createElement('span')

        const memberButton = document.createElement('button')
        memberButton.dataset.shortId = String(m.shortId)
        memberButton.textContent = `${m.nickname} (${fingerprint(m).slice(0, 9)}${m.verified ? ' ✓' : ''})`
        span.appendChild(memberButton)

        if (!m.verified) {
          span.appendChild(document.createTextNode(' '))
          const verifyButton = document.createElement('button')
          verifyButton.dataset.verifyId = String(m.shortId)
          verifyButton.textContent = 'Verify'
          span.appendChild(verifyButton)
        }

        rosterEl.appendChild(span)
        rosterEl.appendChild(document.createTextNode(' '))
      }

      const groupButton = document.createElement('button')
      groupButton.dataset.shortId = 'group'
      groupButton.textContent = 'Group room'
      rosterEl.appendChild(groupButton)
    }, 500)

    rosterEl.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const verifyId = target.dataset.verifyId
      if (verifyId) {
        roster.markVerified(Number(verifyId))
        return
      }
      const shortId = target.dataset.shortId
      if (!shortId) return
      activeThreadShortId = shortId === 'group' ? null : Number(shortId)
      renderThreadLabel()
      messagesEl.innerHTML = ''
    })

    sendForm.addEventListener('submit', async (event) => {
      event.preventDefault()
      const text = messageInput.value.trim()
      if (!text) return
      messageInput.value = ''
      if (activeThreadShortId === null) {
        await controller.sendGroupMessage(text)
        appendMessage(`me: ${text}`)
      } else {
        await controller.sendDirectMessage(activeThreadShortId, text)
        appendMessage(`me: ${text}`)
      }
    })
  })

  function renderThreadLabel() {
    threadLabelEl.textContent = activeThreadShortId === null ? 'Group room' : `Direct thread with #${activeThreadShortId}`
  }

  function appendMessage(text: string) {
    const line = document.createElement('div')
    line.textContent = text
    messagesEl.appendChild(line)
  }
}
