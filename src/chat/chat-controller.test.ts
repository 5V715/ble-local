import { describe, it, expect, afterEach, vi } from 'vitest'
import { ChatController } from './chat-controller'
import { MockHubTransport } from '../transport/mock-hub-transport'
import { RosterManager } from '../room/roster-manager'
import { GroupKeyManager } from '../room/group-key-manager'
import { generateSigningKeyPair, generateDhKeyPair } from '../crypto/crypto-engine'
import type { Identity } from '../identity/identity-manager'

function makeIdentity(nickname: string): Identity {
  const signing = generateSigningKeyPair()
  const dh = generateDhKeyPair()
  return { nickname, signPublicKey: signing.publicKey, signPrivateKey: signing.privateKey, dhPublicKey: dh.publicKey, dhPrivateKey: dh.privateKey }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000, intervalMs = 20): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitUntil: timed out waiting for condition')
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

describe('ChatController', () => {
  const transports: MockHubTransport[] = []
  afterEach(async () => {
    for (const t of transports) await t.disconnect()
    transports.length = 0
  })

  it('delivers a group message end-to-end between two controllers, with the second joiner bootstrapped by the first', async () => {
    const room = crypto.randomUUID()

    const aliceIdentity = makeIdentity('alice')
    const aliceTransport = new MockHubTransport(room)
    transports.push(aliceTransport)
    const aliceRoster = new RosterManager()
    const aliceGroupKey = new GroupKeyManager()
    const alice = new ChatController(aliceTransport, aliceIdentity, aliceRoster, aliceGroupKey)
    await alice.start() // alice is first in the room, so start() mints the room key via the real bootstrap gate

    const bobIdentity = makeIdentity('bob')
    const bobTransport = new MockHubTransport(room)
    transports.push(bobTransport)
    const bobRoster = new RosterManager()
    const bobGroupKey = new GroupKeyManager()
    const bob = new ChatController(bobTransport, bobIdentity, bobRoster, bobGroupKey)

    const bobMessages: string[] = []
    bob.onMessage((m) => bobMessages.push(m.text))

    await bob.start()
    await waitUntil(() => bobGroupKey.hasRoomKey()) // presence exchange + key package delivery

    expect(bobGroupKey.hasRoomKey()).toBe(true)

    await alice.sendGroupMessage('hello room')
    await waitUntil(() => bobMessages.includes('hello room'))

    expect(bobMessages).toContain('hello room')
  })

  it('recovers a peer whose initial presence announcement was lost, via the periodic heartbeat', async () => {
    // A presence frame is ~250+ bytes — always at least 2 BLE chunks, sent
    // as unacknowledged notifications with no retry. Losing one is a real
    // failure mode (more likely under a burst of simultaneous joins), and
    // without a heartbeat it's permanent: the peer never learns that
    // member's identity for the rest of the session, so its messages are
    // silently dropped and it's absent from the roster despite being
    // shown as a connected member.
    const PRESENCE_HEARTBEAT_INTERVAL_MS = 20_000
    vi.useFakeTimers()
    try {
      const room = crypto.randomUUID()

      const aliceIdentity = makeIdentity('alice')
      const aliceTransport = new MockHubTransport(room)
      transports.push(aliceTransport)
      const aliceStart = new ChatController(aliceTransport, aliceIdentity, new RosterManager(), new GroupKeyManager()).start()
      await vi.advanceTimersByTimeAsync(100)
      await aliceStart
      const aliceShortId = aliceTransport.myShortId!

      const bobIdentity = makeIdentity('bob')
      const bobTransport = new MockHubTransport(room)
      transports.push(bobTransport)
      // Simulate every one of alice's presence frames being lost in transit
      // until we flip this back off, below.
      let dropFrames = true
      const originalOnFrame = bobTransport.onFrame.bind(bobTransport)
      bobTransport.onFrame = (cb: (bytes: Uint8Array) => void) => originalOnFrame((bytes) => { if (!dropFrames) cb(bytes) })

      const bobRoster = new RosterManager()
      const bobStart = new ChatController(bobTransport, bobIdentity, bobRoster, new GroupKeyManager()).start()
      await vi.advanceTimersByTimeAsync(100)
      await bobStart

      // Bob is connected (roster knows alice's short id from the member
      // list) but never received a presence frame from her, so he doesn't
      // know her nickname/keys yet — exactly the reported "shown as present
      // but can't see their messages" state.
      expect(bobRoster.getMember(aliceShortId)).toBeUndefined()

      dropFrames = false
      await vi.advanceTimersByTimeAsync(PRESENCE_HEARTBEAT_INTERVAL_MS + 1000)

      expect(bobRoster.getMember(aliceShortId)?.nickname).toBe('alice')
    } finally {
      vi.useRealTimers()
    }
  })

  it('delivers a direct message only to its recipient', async () => {
    const room = crypto.randomUUID()

    const aliceIdentity = makeIdentity('alice')
    const aliceTransport = new MockHubTransport(room)
    transports.push(aliceTransport)
    const aliceRoster = new RosterManager()
    const alice = new ChatController(aliceTransport, aliceIdentity, aliceRoster, new GroupKeyManager())
    await alice.start()

    const bobIdentity = makeIdentity('bob')
    const bobTransport = new MockHubTransport(room)
    transports.push(bobTransport)
    const bobMessages: string[] = []
    const bob = new ChatController(bobTransport, bobIdentity, new RosterManager(), new GroupKeyManager())
    bob.onMessage((m) => bobMessages.push(m.text))
    await bob.start()

    const carolIdentity = makeIdentity('carol')
    const carolTransport = new MockHubTransport(room)
    transports.push(carolTransport)
    const carolMessages: string[] = []
    const carol = new ChatController(carolTransport, carolIdentity, new RosterManager(), new GroupKeyManager())
    carol.onMessage((m) => carolMessages.push(m.text))
    await carol.start()

    const bobShortId = bobTransport.myShortId!
    await waitUntil(() => aliceRoster.getMember(bobShortId) !== undefined)

    await alice.sendDirectMessage(bobShortId, 'psst just you')
    await waitUntil(() => bobMessages.includes('psst just you'))

    expect(bobMessages).toContain('psst just you')
    expect(carolMessages).not.toContain('psst just you')
  })
})
