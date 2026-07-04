import { describe, it, expect, afterEach } from 'vitest'
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
