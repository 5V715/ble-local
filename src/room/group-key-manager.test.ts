import { describe, it, expect } from 'vitest'
import { GroupKeyManager } from './group-key-manager'
import { generateSigningKeyPair, generateDhKeyPair, encrypt, decrypt } from '../crypto/crypto-engine'
import type { Identity } from '../identity/identity-manager'

function makeIdentity(nickname: string): Identity {
  const signing = generateSigningKeyPair()
  const dh = generateDhKeyPair()
  return { nickname, signPublicKey: signing.publicKey, signPrivateKey: signing.privateKey, dhPublicKey: dh.publicKey, dhPrivateKey: dh.privateKey }
}

describe('GroupKeyManager', () => {
  it('has no room key until minted', () => {
    const manager = new GroupKeyManager()
    expect(manager.hasRoomKey()).toBe(false)
    expect(manager.getRoomKey()).toBeNull()
  })

  it('has a room key after minting', async () => {
    const manager = new GroupKeyManager()
    await manager.mintNewRoomKey()
    expect(manager.hasRoomKey()).toBe(true)
    expect(manager.getRoomKey()).not.toBeNull()
  })

  it('delivers the room key to a new joiner who can then use it', async () => {
    const alice = makeIdentity('alice')
    const bob = makeIdentity('bob')

    const aliceKeys = new GroupKeyManager()
    await aliceKeys.mintNewRoomKey()

    const keyPackageBytes = await aliceKeys.buildKeyPackageFor(alice, bob.dhPublicKey)

    const bobKeys = new GroupKeyManager()
    const accepted = await bobKeys.acceptKeyPackage(keyPackageBytes, alice.signPublicKey, bob, alice.dhPublicKey)

    expect(accepted).toBe(true)
    expect(bobKeys.hasRoomKey()).toBe(true)

    const plaintext = new TextEncoder().encode('shared room secret')
    const ciphertext = await encrypt(aliceKeys.getRoomKey()!, plaintext)
    const decrypted = await decrypt(bobKeys.getRoomKey()!, ciphertext)
    expect(new TextDecoder().decode(decrypted)).toBe('shared room secret')
  })

  it('rejects a key package signed by an unexpected key', async () => {
    const alice = makeIdentity('alice')
    const impostor = makeIdentity('impostor')
    const bob = makeIdentity('bob')

    const aliceKeys = new GroupKeyManager()
    await aliceKeys.mintNewRoomKey()
    const keyPackageBytes = await aliceKeys.buildKeyPackageFor(alice, bob.dhPublicKey)

    const bobKeys = new GroupKeyManager()
    const accepted = await bobKeys.acceptKeyPackage(keyPackageBytes, impostor.signPublicKey, bob, alice.dhPublicKey)

    expect(accepted).toBe(false)
    expect(bobKeys.hasRoomKey()).toBe(false)
  })
})
