import { describe, it, expect } from 'vitest'
import {
  MessageType,
  BROADCAST_RECIPIENT,
  encodeChunk,
  decodeChunk,
  buildChunks,
  FrameReassembler
} from './framing'

describe('encodeChunk / decodeChunk', () => {
  it('round-trips a single chunk', () => {
    const payload = new TextEncoder().encode('hello')
    const bytes = encodeChunk(
      { msgType: MessageType.GROUP_MESSAGE, senderShortId: 3, recipientShortId: BROADCAST_RECIPIENT, seq: 42, chunkIndex: 0, chunkCount: 1 },
      payload
    )
    const decoded = decodeChunk(bytes)
    expect(decoded.msgType).toBe(MessageType.GROUP_MESSAGE)
    expect(decoded.senderShortId).toBe(3)
    expect(decoded.recipientShortId).toBe(BROADCAST_RECIPIENT)
    expect(decoded.seq).toBe(42)
    expect(decoded.chunkIndex).toBe(0)
    expect(decoded.chunkCount).toBe(1)
    expect(new TextDecoder().decode(decoded.payload)).toBe('hello')
  })
})

describe('buildChunks', () => {
  it('produces a single chunk when the payload fits', () => {
    const payload = new Uint8Array(10)
    const chunks = buildChunks(
      { msgType: MessageType.DIRECT_MESSAGE, senderShortId: 1, recipientShortId: 2, seq: 1 },
      payload,
      100
    )
    expect(chunks.length).toBe(1)
    expect(decodeChunk(chunks[0]).chunkCount).toBe(1)
  })

  it('splits a large payload into multiple chunks that reassemble in order', () => {
    const payload = crypto.getRandomValues(new Uint8Array(250))
    const chunks = buildChunks(
      { msgType: MessageType.GROUP_MESSAGE, senderShortId: 5, recipientShortId: BROADCAST_RECIPIENT, seq: 7 },
      payload,
      100
    )
    expect(chunks.length).toBe(3)
    const reassembler = new FrameReassembler()
    let result = null
    for (const chunk of chunks) {
      result = reassembler.addChunk(decodeChunk(chunk))
    }
    expect(result).not.toBeNull()
    expect(result!.payload).toEqual(payload)
  })
})

describe('FrameReassembler', () => {
  it('reassembles out-of-order chunks', () => {
    const payload = crypto.getRandomValues(new Uint8Array(250))
    const chunks = buildChunks(
      { msgType: MessageType.GROUP_MESSAGE, senderShortId: 5, recipientShortId: BROADCAST_RECIPIENT, seq: 8 },
      payload,
      100
    ).map(decodeChunk)
    const reassembler = new FrameReassembler()
    const reordered = [chunks[2], chunks[0], chunks[1]]
    let result = null
    for (const chunk of reordered) {
      result = reassembler.addChunk(chunk)
    }
    expect(result!.payload).toEqual(payload)
  })

  it('ignores a duplicate chunk', () => {
    const payload = new TextEncoder().encode('hi')
    const chunk = decodeChunk(
      buildChunks(
        { msgType: MessageType.PRESENCE, senderShortId: 1, recipientShortId: BROADCAST_RECIPIENT, seq: 1 },
        payload,
        100
      )[0]
    )
    const reassembler = new FrameReassembler()
    const first = reassembler.addChunk(chunk)
    const second = reassembler.addChunk(chunk)
    expect(first).not.toBeNull()
    expect(second).toBeNull()
  })

  it('drops partial messages older than maxAgeMs on sweep', () => {
    const payload = crypto.getRandomValues(new Uint8Array(250))
    const chunks = buildChunks(
      { msgType: MessageType.GROUP_MESSAGE, senderShortId: 5, recipientShortId: BROADCAST_RECIPIENT, seq: 9 },
      payload,
      100
    ).map(decodeChunk)
    const reassembler = new FrameReassembler()
    reassembler.addChunk(chunks[0])
    reassembler.sweep(1_000_000, 1000)
    const result = reassembler.addChunk(chunks[1])
    expect(result).toBeNull()
    const finalResult = reassembler.addChunk(chunks[2])
    expect(finalResult).toBeNull()
  })
})
