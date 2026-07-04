import { describe, it, expect } from 'vitest'
import { generateSigningKeyPair, generateDhKeyPair } from '../crypto/crypto-engine'
import {
  encodePresence,
  decodePresence,
  encodeKeyPackage,
  decodeKeyPackage,
  encodeChatPayload,
  decodeChatPayload
} from './messages'

describe('presence messages', () => {
  it('round-trips and verifies', () => {
    const signing = generateSigningKeyPair()
    const dh = generateDhKeyPair()
    const bytes = encodePresence({
      nickname: 'alice',
      signPublicKey: signing.publicKey,
      dhPublicKey: dh.publicKey,
      signPrivateKey: signing.privateKey
    })
    const decoded = decodePresence(bytes)
    expect(decoded.valid).toBe(true)
    expect(decoded.nickname).toBe('alice')
    expect(decoded.signPublicKey).toEqual(signing.publicKey)
    expect(decoded.dhPublicKey).toEqual(dh.publicKey)
  })

  it('flags a tampered presence message as invalid', () => {
    const signing = generateSigningKeyPair()
    const dh = generateDhKeyPair()
    const bytes = encodePresence({
      nickname: 'alice',
      signPublicKey: signing.publicKey,
      dhPublicKey: dh.publicKey,
      signPrivateKey: signing.privateKey
    })
    const text = new TextDecoder().decode(bytes)
    const tampered = new TextEncoder().encode(text.replace('alice', 'mallory'))
    expect(decodePresence(tampered).valid).toBe(false)
  })
})

describe('key package messages', () => {
  it('round-trips and verifies against the sender key', () => {
    const sender = generateSigningKeyPair()
    const wrappedRoomKey = crypto.getRandomValues(new Uint8Array(44))
    const bytes = encodeKeyPackage({ wrappedRoomKey, epoch: 123, signPrivateKey: sender.privateKey })
    const decoded = decodeKeyPackage(bytes, sender.publicKey)
    expect(decoded.valid).toBe(true)
    expect(decoded.epoch).toBe(123)
    expect(decoded.wrappedRoomKey).toEqual(wrappedRoomKey)
  })

  it('is invalid when verified against the wrong public key', () => {
    const sender = generateSigningKeyPair()
    const impostor = generateSigningKeyPair()
    const bytes = encodeKeyPackage({
      wrappedRoomKey: new Uint8Array([1, 2, 3]),
      epoch: 1,
      signPrivateKey: sender.privateKey
    })
    expect(decodeKeyPackage(bytes, impostor.publicKey).valid).toBe(false)
  })
})

describe('chat payload messages', () => {
  it('round-trips and verifies', () => {
    const sender = generateSigningKeyPair()
    const ciphertext = crypto.getRandomValues(new Uint8Array(60))
    const bytes = encodeChatPayload({ ciphertext, signPrivateKey: sender.privateKey })
    const decoded = decodeChatPayload(bytes, sender.publicKey)
    expect(decoded.valid).toBe(true)
    expect(decoded.ciphertext).toEqual(ciphertext)
  })
})
