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

async function wait(ms = 80) {
  await new Promise((r) => setTimeout(r, ms))
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
    await alice.start()
    await aliceGroupKey.mintNewRoomKey()

    const bobIdentity = makeIdentity('bob')
    const bobTransport = new MockHubTransport(room)
    transports.push(bobTransport)
    const bobRoster = new RosterManager()
    const bobGroupKey = new GroupKeyManager()
    const bob = new ChatController(bobTransport, bobIdentity, bobRoster, bobGroupKey)

    const bobMessages: string[] = []
    bob.onMessage((m) => bobMessages.push(m.text))

    await bob.start()
    await wait() // presence exchange + key package delivery

    expect(bobGroupKey.hasRoomKey()).toBe(true)

    await alice.sendGroupMessage('hello room')
    await wait()

    expect(bobMessages).toContain('hello room')
  })

  it('delivers a direct message only to its recipient', async () => {
    const room = crypto.randomUUID()

    const aliceIdentity = makeIdentity('alice')
    const aliceTransport = new MockHubTransport(room)
    transports.push(aliceTransport)
    const alice = new ChatController(aliceTransport, aliceIdentity, new RosterManager(), new GroupKeyManager())
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

    await wait()

    const bobShortId = bobTransport.myShortId!
    await alice.sendDirectMessage(bobShortId, 'psst just you')
    await wait()

    expect(bobMessages).toContain('psst just you')
    expect(carolMessages).not.toContain('psst just you')
  })
})
