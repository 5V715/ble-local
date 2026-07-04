import { ChatController, type IncomingChatMessage } from '../chat/chat-controller'
import { MockHubTransport } from '../transport/mock-hub-transport'
import { RosterManager } from '../room/roster-manager'
import { GroupKeyManager } from '../room/group-key-manager'
import { loadOrCreateIdentity, fingerprint } from '../identity/identity-manager'

export async function mountApp(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div id="setup">
      <label>Nickname <input id="nickname" placeholder="alice" /></label>
      <label>Room name <input id="room" placeholder="living-room" /></label>
      <button id="join">Join</button>
    </div>
    <div id="chat" hidden>
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
  const nicknameInput = root.querySelector<HTMLInputElement>('#nickname')!
  const roomInput = root.querySelector<HTMLInputElement>('#room')!
  const joinButton = root.querySelector<HTMLButtonElement>('#join')!
  const sendForm = root.querySelector<HTMLFormElement>('#send-form')!
  const messageInput = root.querySelector<HTMLInputElement>('#message-input')!

  let activeThreadShortId: number | null = null // null = group room

  joinButton.addEventListener('click', async () => {
    const nickname = nicknameInput.value.trim()
    const room = roomInput.value.trim()
    if (!nickname || !room) return

    const identity = await loadOrCreateIdentity(indexedDB, nickname)
    const transport = new MockHubTransport(room)
    const roster = new RosterManager()
    const groupKey = new GroupKeyManager()
    const controller = new ChatController(transport, identity, roster, groupKey)

    controller.onMessage((msg: IncomingChatMessage) => {
      const shouldShow = msg.scope === 'group' ? activeThreadShortId === null : activeThreadShortId === msg.fromShortId
      if (shouldShow) appendMessage(`${msg.nickname}: ${msg.text}`)
    })

    await controller.start()
    if (roster.isEmpty()) {
      await groupKey.mintNewRoomKey()
    }

    setupEl.hidden = true
    chatEl.hidden = false
    renderThreadLabel()

    setInterval(() => {
      rosterEl.innerHTML = roster
        .getAllMembers()
        .map(
          (m) =>
            `<span>
               <button data-short-id="${m.shortId}">${m.nickname} (${fingerprint(m).slice(0, 9)}${m.verified ? ' ✓' : ''})</button>
               ${m.verified ? '' : `<button data-verify-id="${m.shortId}">Verify</button>`}
             </span>`
        )
        .join(' ') + ` <button data-short-id="group">Group room</button>`
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
