export enum MessageType {
  PRESENCE = 0,
  KEY_PACKAGE = 1,
  GROUP_MESSAGE = 2,
  DIRECT_MESSAGE = 3
}

export const BROADCAST_RECIPIENT = 0xff

export interface FrameHeader {
  msgType: MessageType
  senderShortId: number
  recipientShortId: number
  seq: number
  chunkIndex: number
  chunkCount: number
}

export interface DecodedChunk extends FrameHeader {
  payload: Uint8Array
}

const HEADER_LENGTH = 11 // msgType(1) + senderShortId(1) + recipientShortId(1) + seq(4) + chunkIndex(1) + chunkCount(1) + payloadLength(2)

export function encodeChunk(header: FrameHeader, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(HEADER_LENGTH + payload.length)
  const view = new DataView(bytes.buffer)
  bytes[0] = header.msgType
  bytes[1] = header.senderShortId
  bytes[2] = header.recipientShortId
  view.setUint32(3, header.seq, false)
  bytes[7] = header.chunkIndex
  bytes[8] = header.chunkCount
  view.setUint16(9, payload.length, false)
  bytes.set(payload, HEADER_LENGTH)
  return bytes
}

export function decodeChunk(bytes: Uint8Array): DecodedChunk {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const payloadLength = view.getUint16(9, false)
  return {
    msgType: bytes[0] as MessageType,
    senderShortId: bytes[1],
    recipientShortId: bytes[2],
    seq: view.getUint32(3, false),
    chunkIndex: bytes[7],
    chunkCount: bytes[8],
    payload: bytes.slice(HEADER_LENGTH, HEADER_LENGTH + payloadLength)
  }
}

export function buildChunks(
  header: Omit<FrameHeader, 'chunkIndex' | 'chunkCount'>,
  fullPayload: Uint8Array,
  maxChunkPayloadSize: number
): Uint8Array[] {
  const chunkCount = Math.max(1, Math.ceil(fullPayload.length / maxChunkPayloadSize))
  const chunks: Uint8Array[] = []
  for (let i = 0; i < chunkCount; i++) {
    const slice = fullPayload.slice(i * maxChunkPayloadSize, (i + 1) * maxChunkPayloadSize)
    chunks.push(encodeChunk({ ...header, chunkIndex: i, chunkCount }, slice))
  }
  return chunks
}

interface PendingMessage {
  msgType: MessageType
  senderShortId: number
  recipientShortId: number
  seq: number
  chunkCount: number
  chunks: Map<number, Uint8Array>
  firstSeenAtMs: number
}

export class FrameReassembler {
  private pending = new Map<string, PendingMessage>()
  private completed = new Set<string>()

  addChunk(chunk: DecodedChunk, nowMs = 0): { msgType: MessageType; senderShortId: number; recipientShortId: number; seq: number; payload: Uint8Array } | null {
    const key = `${chunk.senderShortId}:${chunk.seq}`
    if (this.completed.has(key)) return null

    if (chunk.chunkCount === 1) {
      this.completed.add(key)
      return {
        msgType: chunk.msgType,
        senderShortId: chunk.senderShortId,
        recipientShortId: chunk.recipientShortId,
        seq: chunk.seq,
        payload: chunk.payload
      }
    }

    let pending = this.pending.get(key)
    if (!pending) {
      pending = {
        msgType: chunk.msgType,
        senderShortId: chunk.senderShortId,
        recipientShortId: chunk.recipientShortId,
        seq: chunk.seq,
        chunkCount: chunk.chunkCount,
        chunks: new Map(),
        firstSeenAtMs: nowMs
      }
      this.pending.set(key, pending)
    }
    pending.chunks.set(chunk.chunkIndex, chunk.payload)

    if (pending.chunks.size < pending.chunkCount) return null

    let totalLength = 0
    for (let i = 0; i < pending.chunkCount; i++) totalLength += pending.chunks.get(i)!.length
    const fullPayload = new Uint8Array(totalLength)
    let offset = 0
    for (let i = 0; i < pending.chunkCount; i++) {
      const part = pending.chunks.get(i)!
      fullPayload.set(part, offset)
      offset += part.length
    }

    this.pending.delete(key)
    this.completed.add(key)
    return {
      msgType: pending.msgType,
      senderShortId: pending.senderShortId,
      recipientShortId: pending.recipientShortId,
      seq: pending.seq,
      payload: fullPayload
    }
  }

  sweep(nowMs: number, maxAgeMs: number): void {
    for (const [key, pending] of this.pending) {
      if (nowMs - pending.firstSeenAtMs > maxAgeMs) {
        this.pending.delete(key)
        this.completed.add(key)
      }
    }
  }
}
