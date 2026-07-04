import type { Transport } from './transport'

// BroadcastChannel has no message history — a joiner that just creates its
// channel cannot see announcements posted before it existed. So joining is a
// query/response handshake: ask "who's here", wait a short window for
// existing members to (re-)announce themselves, then pick an id that avoids
// every id observed during that window.
const DISCOVERY_WINDOW_MS = 50

type ControlMessage =
  | { kind: 'query' }
  | { kind: 'announce'; instanceId: string; shortId: number }
  | { kind: 'left'; shortId: number }
  | { kind: 'data'; bytes: number[] }

export class MockHubTransport implements Transport {
  private channel: BroadcastChannel | null = null
  private instanceId = crypto.randomUUID()
  private knownShortIds = new Set<number>()
  private knownPeerInstanceIds = new Set<string>()
  private _myShortId: number | null = null

  private frameCbs: Array<(bytes: Uint8Array) => void> = []
  private joinedCbs: Array<(shortId: number) => void> = []
  private leftCbs: Array<(shortId: number) => void> = []
  private listCbs: Array<(shortIds: number[]) => void> = []

  constructor(private roomName: string) {}

  get myShortId(): number | null {
    return this._myShortId
  }

  async connect(): Promise<void> {
    this.channel = new BroadcastChannel(this.roomName)
    this.channel.addEventListener('message', this.handleMessage)

    this.broadcast({ kind: 'query' })
    await new Promise((resolve) => setTimeout(resolve, DISCOVERY_WINDOW_MS))

    const candidate = this.pickNextShortId()
    this._myShortId = candidate
    this.knownShortIds.add(candidate)
    this.listCbs.forEach((cb) => cb([...this.knownShortIds]))
    this.broadcast({ kind: 'announce', instanceId: this.instanceId, shortId: candidate })
  }

  async disconnect(): Promise<void> {
    if (this._myShortId !== null) {
      this.broadcast({ kind: 'left', shortId: this._myShortId })
    }
    this.channel?.removeEventListener('message', this.handleMessage)
    this.channel?.close()
    this.channel = null
  }

  async send(bytes: Uint8Array): Promise<void> {
    this.broadcast({ kind: 'data', bytes: [...bytes] })
  }

  onFrame(cb: (bytes: Uint8Array) => void): void {
    this.frameCbs.push(cb)
  }

  onMemberJoined(cb: (shortId: number) => void): void {
    this.joinedCbs.push(cb)
  }

  onMemberLeft(cb: (shortId: number) => void): void {
    this.leftCbs.push(cb)
  }

  onMemberList(cb: (shortIds: number[]) => void): void {
    this.listCbs.push(cb)
  }

  private pickNextShortId(): number {
    let candidate = 1
    while (this.knownShortIds.has(candidate)) candidate++
    return candidate
  }

  private broadcast(message: ControlMessage): void {
    this.channel?.postMessage(message)
  }

  private handleMessage = (event: MessageEvent<ControlMessage>): void => {
    const message = event.data
    if (message.kind === 'query') {
      if (this._myShortId !== null) {
        this.broadcast({ kind: 'announce', instanceId: this.instanceId, shortId: this._myShortId })
      }
      return
    }
    if (message.kind === 'announce') {
      if (message.instanceId === this.instanceId) return
      this.knownShortIds.add(message.shortId)
      const isNewPeer = !this.knownPeerInstanceIds.has(message.instanceId)
      this.knownPeerInstanceIds.add(message.instanceId)
      // Only a genuinely new peer, learned about after our own discovery
      // window closed, is a "join" — announces seen during our own
      // discovery are just populating our initial member list.
      if (isNewPeer && this._myShortId !== null) {
        this.joinedCbs.forEach((cb) => cb(message.shortId))
      }
      return
    }
    if (message.kind === 'left') {
      this.knownShortIds.delete(message.shortId)
      this.leftCbs.forEach((cb) => cb(message.shortId))
      return
    }
    if (message.kind === 'data') {
      this.frameCbs.forEach((cb) => cb(new Uint8Array(message.bytes)))
    }
  }
}
