import { describe, it, expect, afterEach } from 'vitest'
import { MockHubTransport } from './mock-hub-transport'

describe('MockHubTransport', () => {
  const created: MockHubTransport[] = []

  afterEach(async () => {
    for (const t of created) await t.disconnect()
    created.length = 0
  })

  function make(room: string) {
    const t = new MockHubTransport(room)
    created.push(t)
    return t
  }

  it('assigns a short id on connect', async () => {
    const room = crypto.randomUUID()
    const a = make(room)
    await a.connect()
    expect(a.myShortId).not.toBeNull()
  })

  it('assigns different short ids to two connected transports in the same room', async () => {
    const room = crypto.randomUUID()
    const a = make(room)
    const b = make(room)
    await a.connect()
    await b.connect()
    expect(a.myShortId).not.toBe(b.myShortId)
  })

  it('notifies an already-connected transport when another one joins', async () => {
    const room = crypto.randomUUID()
    const a = make(room)
    const b = make(room)
    await a.connect()

    const joined: number[] = []
    a.onMemberJoined((id) => joined.push(id))

    await b.connect()
    await new Promise((r) => setTimeout(r, 50))

    expect(joined).toContain(b.myShortId)
  })

  it('relays a broadcast frame sent by one transport to another', async () => {
    const room = crypto.randomUUID()
    const a = make(room)
    const b = make(room)
    await a.connect()
    await b.connect()

    const received: Uint8Array[] = []
    b.onFrame((bytes) => received.push(bytes))

    const payload = new TextEncoder().encode('hello')
    await a.send(payload)
    await new Promise((r) => setTimeout(r, 50))

    expect(received.length).toBe(1)
    expect(received[0]).toEqual(payload)
  })

  it('notifies remaining transports when one disconnects', async () => {
    const room = crypto.randomUUID()
    const a = make(room)
    const b = make(room)
    await a.connect()
    await b.connect()

    const left: number[] = []
    a.onMemberLeft((id) => left.push(id))

    const bId = b.myShortId
    await b.disconnect()
    await new Promise((r) => setTimeout(r, 50))

    expect(left).toContain(bId)
  })

  it('resets myShortId to null after disconnect', async () => {
    const room = crypto.randomUUID()
    const a = make(room)
    await a.connect()
    expect(a.myShortId).not.toBeNull()
    await a.disconnect()
    expect(a.myShortId).toBeNull()
  })

  it('treats reconnecting the same instance as a new peer join', async () => {
    const room = crypto.randomUUID()
    const a = make(room)
    const b = make(room)
    await a.connect()
    await b.connect()
    await new Promise((r) => setTimeout(r, 50))

    const joined: number[] = []
    a.onMemberJoined((id) => joined.push(id))

    // Disconnect and reconnect b
    await b.disconnect()
    await new Promise((r) => setTimeout(r, 50))

    await b.connect()
    await new Promise((r) => setTimeout(r, 50))

    // b's new shortId should fire onMemberJoined on a, even though it's the same instance
    expect(joined).toContain(b.myShortId)
  })
})
