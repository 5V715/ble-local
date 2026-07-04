import type { Transport } from '../transport/transport'
import type { Identity } from '../identity/identity-manager'
import { RosterManager } from '../room/roster-manager'
import { GroupKeyManager } from '../room/group-key-manager'
import { MessageType, BROADCAST_RECIPIENT, buildChunks, decodeChunk, FrameReassembler } from '../protocol/framing'
import { encodePresence, decodePresence, encodeChatPayload, decodeChatPayload } from '../protocol/messages'
import { encrypt, decrypt, deriveSharedSecret, deriveAesKey } from '../crypto/crypto-engine'

const MAX_CHUNK_PAYLOAD_SIZE = 180
const REASSEMBLY_TIMEOUT_MS = 15_000
const REASSEMBLY_SWEEP_INTERVAL_MS = 5_000

export interface IncomingChatMessage {
  fromShortId: number
  nickname: string
  text: string
  scope: 'group' | 'direct'
}

export class ChatController {
  private reassembler = new FrameReassembler()
  private seenSeqBySender = new Map<number, number>()
  private nextSeq = 1
  private messageCbs: Array<(msg: IncomingChatMessage) => void> = []
  private directKeyCache = new Map<number, CryptoKey>()

  constructor(
    private transport: Transport,
    private identity: Identity,
    private roster: RosterManager,
    private groupKey: GroupKeyManager
  ) {}

  async start(): Promise<void> {
    this.transport.onMemberList((ids) => this.roster.onMemberList(ids))
    // Re-announce our own presence whenever a new peer joins. MockHubTransport's
    // BroadcastChannel has no message history, so a peer that joins after we
    // already broadcast our presence would otherwise never learn our identity
    // (nickname/signing key/DH key) — and without that, it can't verify a
    // KEY_PACKAGE or DIRECT_MESSAGE we later sign and send to it.
    this.transport.onMemberJoined((id) => {
      this.roster.onMemberJoined(id)
      void this.broadcastPresence()
    })
    this.transport.onMemberLeft((id) => this.roster.onMemberLeft(id))
    this.transport.onFrame((bytes) => this.handleIncomingBytes(bytes))

    await this.transport.connect()
    if (this.roster.isEmpty()) {
      await this.groupKey.mintNewRoomKey()
    }
    await this.broadcastPresence()

    setInterval(() => this.reassembler.sweep(Date.now(), REASSEMBLY_TIMEOUT_MS), REASSEMBLY_SWEEP_INTERVAL_MS)
  }

  onMessage(cb: (msg: IncomingChatMessage) => void): void {
    this.messageCbs.push(cb)
  }

  async sendGroupMessage(text: string): Promise<void> {
    if (!this.groupKey.hasRoomKey()) {
      throw new Error('ChatController: no room key established yet')
    }
    const ciphertext = await encrypt(this.groupKey.getRoomKey()!, new TextEncoder().encode(text))
    const payload = encodeChatPayload({ ciphertext, signPrivateKey: this.identity.signPrivateKey })
    await this.sendFramed(MessageType.GROUP_MESSAGE, BROADCAST_RECIPIENT, payload)
  }

  async sendDirectMessage(recipientShortId: number, text: string): Promise<void> {
    const member = this.roster.getMember(recipientShortId)
    if (!member) {
      throw new Error(`ChatController: unknown recipient ${recipientShortId}`)
    }
    const key = await this.getOrCreateDirectKey(recipientShortId, member.dhPublicKey)
    const ciphertext = await encrypt(key, new TextEncoder().encode(text))
    const payload = encodeChatPayload({ ciphertext, signPrivateKey: this.identity.signPrivateKey })
    await this.sendFramed(MessageType.DIRECT_MESSAGE, recipientShortId, payload)
  }

  private async getOrCreateDirectKey(peerShortId: number, peerDhPublicKey: Uint8Array): Promise<CryptoKey> {
    const cached = this.directKeyCache.get(peerShortId)
    if (cached) return cached
    const sharedSecret = deriveSharedSecret(this.identity.dhPrivateKey, peerDhPublicKey)
    const key = await deriveAesKey(sharedSecret)
    this.directKeyCache.set(peerShortId, key)
    return key
  }

  private async broadcastPresence(): Promise<void> {
    const payload = encodePresence({
      nickname: this.identity.nickname,
      signPublicKey: this.identity.signPublicKey,
      dhPublicKey: this.identity.dhPublicKey,
      signPrivateKey: this.identity.signPrivateKey
    })
    await this.sendFramed(MessageType.PRESENCE, BROADCAST_RECIPIENT, payload)
  }

  private async sendFramed(msgType: MessageType, recipientShortId: number, payload: Uint8Array): Promise<void> {
    const seq = this.nextSeq++
    const senderShortId = this.transport.myShortId ?? 0
    const chunks = buildChunks({ msgType, senderShortId, recipientShortId, seq }, payload, MAX_CHUNK_PAYLOAD_SIZE)
    for (const chunk of chunks) {
      await this.transport.send(chunk)
    }
  }

  private async handleIncomingBytes(bytes: Uint8Array): Promise<void> {
    const chunk = decodeChunk(bytes)
    const reassembled = this.reassembler.addChunk(chunk, Date.now())
    if (!reassembled) return

    const lastSeenSeq = this.seenSeqBySender.get(reassembled.senderShortId) ?? 0
    if (reassembled.seq <= lastSeenSeq) return
    this.seenSeqBySender.set(reassembled.senderShortId, reassembled.seq)

    if (reassembled.msgType === MessageType.PRESENCE) {
      const decoded = decodePresence(reassembled.payload)
      if (!decoded.valid) return
      this.roster.onPresence(reassembled.senderShortId, decoded.nickname, decoded.signPublicKey, decoded.dhPublicKey)
      await this.maybeSendKeyPackageTo(reassembled.senderShortId, decoded.dhPublicKey)
      return
    }

    if (reassembled.msgType === MessageType.KEY_PACKAGE) {
      if (reassembled.recipientShortId !== this.transport.myShortId) return
      const sender = this.roster.getMember(reassembled.senderShortId)
      if (!sender) return
      await this.groupKey.acceptKeyPackage(reassembled.payload, sender.signPublicKey, this.identity, sender.dhPublicKey)
      return
    }

    if (reassembled.msgType === MessageType.GROUP_MESSAGE) {
      const sender = this.roster.getMember(reassembled.senderShortId)
      if (!sender || !this.groupKey.hasRoomKey()) return
      const decoded = decodeChatPayload(reassembled.payload, sender.signPublicKey)
      if (!decoded.valid) return
      const plaintext = await decrypt(this.groupKey.getRoomKey()!, decoded.ciphertext)
      this.emit({ fromShortId: reassembled.senderShortId, nickname: sender.nickname, text: new TextDecoder().decode(plaintext), scope: 'group' })
      return
    }

    if (reassembled.msgType === MessageType.DIRECT_MESSAGE) {
      if (reassembled.recipientShortId !== this.transport.myShortId) return
      const sender = this.roster.getMember(reassembled.senderShortId)
      if (!sender) return
      const decoded = decodeChatPayload(reassembled.payload, sender.signPublicKey)
      if (!decoded.valid) return
      const key = await this.getOrCreateDirectKey(reassembled.senderShortId, sender.dhPublicKey)
      const plaintext = await decrypt(key, decoded.ciphertext)
      this.emit({ fromShortId: reassembled.senderShortId, nickname: sender.nickname, text: new TextDecoder().decode(plaintext), scope: 'direct' })
    }
  }

  private async maybeSendKeyPackageTo(joinerShortId: number, joinerDhPublicKey: Uint8Array): Promise<void> {
    if (!this.groupKey.hasRoomKey()) return
    const myShortId = this.transport.myShortId ?? 0
    const lowestOtherMember = this.roster
      .getAllMembers()
      .map((m) => m.shortId)
      .filter((id) => id !== joinerShortId)
      .concat(myShortId)
      .sort((a, b) => a - b)[0]
    if (lowestOtherMember !== myShortId) return

    const payload = await this.groupKey.buildKeyPackageFor(this.identity, joinerDhPublicKey)
    await this.sendFramed(MessageType.KEY_PACKAGE, joinerShortId, payload)
  }

  private emit(msg: IncomingChatMessage): void {
    this.messageCbs.forEach((cb) => cb(msg))
  }
}
