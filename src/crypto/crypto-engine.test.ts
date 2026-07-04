import { describe, it, expect } from 'vitest'
import {
  generateSigningKeyPair,
  sign,
  verify,
  generateDhKeyPair,
  deriveSharedSecret,
  deriveAesKey,
  generateRoomKeyMaterial,
  importRoomKey,
  encrypt,
  decrypt
} from './crypto-engine'

describe('signing', () => {
  it('signs and verifies a message', () => {
    const { publicKey, privateKey } = generateSigningKeyPair()
    const message = new TextEncoder().encode('hello')
    const signature = sign(privateKey, message)
    expect(verify(publicKey, message, signature)).toBe(true)
  })

  it('rejects a tampered message', () => {
    const { publicKey, privateKey } = generateSigningKeyPair()
    const signature = sign(privateKey, new TextEncoder().encode('hello'))
    expect(verify(publicKey, new TextEncoder().encode('world'), signature)).toBe(false)
  })
})

describe('ECDH', () => {
  it('two parties derive the same shared secret', () => {
    const alice = generateDhKeyPair()
    const bob = generateDhKeyPair()
    const aliceSecret = deriveSharedSecret(alice.privateKey, bob.publicKey)
    const bobSecret = deriveSharedSecret(bob.privateKey, alice.publicKey)
    expect(aliceSecret).toEqual(bobSecret)
  })
})

describe('AES-GCM round trip', () => {
  it('encrypts and decrypts via a shared-secret-derived key', async () => {
    const alice = generateDhKeyPair()
    const bob = generateDhKeyPair()
    const sharedSecret = deriveSharedSecret(alice.privateKey, bob.publicKey)
    const key = await deriveAesKey(sharedSecret)
    const plaintext = new TextEncoder().encode('secret message')
    const ciphertext = await encrypt(key, plaintext)
    const decrypted = await decrypt(key, ciphertext)
    expect(new TextDecoder().decode(decrypted)).toBe('secret message')
  })

  it('encrypts and decrypts via a room key', async () => {
    const raw = generateRoomKeyMaterial()
    const key = await importRoomKey(raw)
    const plaintext = new TextEncoder().encode('group message')
    const ciphertext = await encrypt(key, plaintext)
    const decrypted = await decrypt(key, ciphertext)
    expect(new TextDecoder().decode(decrypted)).toBe('group message')
  })

  it('fails to decrypt with the wrong key', async () => {
    const keyA = await importRoomKey(generateRoomKeyMaterial())
    const keyB = await importRoomKey(generateRoomKeyMaterial())
    const ciphertext = await encrypt(keyA, new TextEncoder().encode('x'))
    await expect(decrypt(keyB, ciphertext)).rejects.toThrow()
  })
})
