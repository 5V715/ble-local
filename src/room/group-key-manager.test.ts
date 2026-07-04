import { describe, it, expect, vi } from 'vitest'
import { GroupKeyManager } from './group-key-manager'
import { generateSigningKeyPair, generateDhKeyPair, encrypt, decrypt } from '../crypto/crypto-engine'
import * as cryptoEngine from '../crypto/crypto-engine'
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

  it('rejects a key package with mismatched DH key (decrypt failure returns false, not throw)', async () => {
    const alice = makeIdentity('alice')
    const bob = makeIdentity('bob')
    const carol = makeIdentity('carol')

    const aliceKeys = new GroupKeyManager()
    await aliceKeys.mintNewRoomKey()

    // Alice builds a key package for Bob
    const keyPackageBytes = await aliceKeys.buildKeyPackageFor(alice, bob.dhPublicKey)

    // Bob tries to accept it, but passes Carol's DH public key instead of Alice's
    // The signature will verify (Alice signed it), but decrypt will fail
    const bobKeys = new GroupKeyManager()
    const accepted = await bobKeys.acceptKeyPackage(
      keyPackageBytes,
      alice.signPublicKey,
      bob,
      carol.dhPublicKey // Wrong sender DH key!
    )

    expect(accepted).toBe(false)
    expect(bobKeys.hasRoomKey()).toBe(false)
  })

  it('rejects a key package with stale epoch after accepting newer one', async () => {
    const alice = makeIdentity('alice')
    const bob = makeIdentity('bob')
    const carol = makeIdentity('carol')

    // Alice mints and sends to Bob
    const aliceKeys = new GroupKeyManager()
    await aliceKeys.mintNewRoomKey()
    const alicePackage = await aliceKeys.buildKeyPackageFor(alice, bob.dhPublicKey)

    const bobKeys = new GroupKeyManager()
    const accepted1 = await bobKeys.acceptKeyPackage(alicePackage, alice.signPublicKey, bob, alice.dhPublicKey)
    expect(accepted1).toBe(true)
    expect(bobKeys.hasRoomKey()).toBe(true)

    // Carol mints and sends to Bob (will have a later epoch due to time passing)
    const carolKeys = new GroupKeyManager()
    await carolKeys.mintNewRoomKey()
    const carolPackage = await carolKeys.buildKeyPackageFor(carol, bob.dhPublicKey)

    const accepted2 = await bobKeys.acceptKeyPackage(carolPackage, carol.signPublicKey, bob, carol.dhPublicKey)
    expect(accepted2).toBe(true)

    // Capture Carol's room key before attempting stale acceptance
    const carolRoomKey = bobKeys.getRoomKey()

    // Now try to send Alice's original (stale-epoch) package to Bob again
    // The signature is valid, but the epoch is now stale
    const accepted3 = await bobKeys.acceptKeyPackage(alicePackage, alice.signPublicKey, bob, alice.dhPublicKey)
    expect(accepted3).toBe(false)
    // Room key should remain unchanged (Carol's key)
    expect(bobKeys.getRoomKey()).toBe(carolRoomKey)
    expect(bobKeys.hasRoomKey()).toBe(true)
  })

  it('does not mutate state partially if importRoomKey throws after successful decrypt', async () => {
    const alice = makeIdentity('alice')
    const bob = makeIdentity('bob')

    // Alice mints and sends to Bob
    const aliceKeys = new GroupKeyManager()
    await aliceKeys.mintNewRoomKey()
    const alicePackage = await aliceKeys.buildKeyPackageFor(alice, bob.dhPublicKey)

    // Spy on importRoomKey and make it throw after a successful decrypt
    const importRoomKeySpy = vi.spyOn(cryptoEngine, 'importRoomKey').mockRejectedValue(new Error('importRoomKey failed'))

    const bobKeys = new GroupKeyManager()
    const accepted = await bobKeys.acceptKeyPackage(alicePackage, alice.signPublicKey, bob, alice.dhPublicKey)

    expect(accepted).toBe(false)
    // Verify no partial mutation: roomKey should still be null
    expect(bobKeys.hasRoomKey()).toBe(false)
    expect(bobKeys.getRoomKey()).toBeNull()

    // Verify pendingRawKey was not set (indirectly by checking buildKeyPackageFor throws)
    await expect(bobKeys.buildKeyPackageFor(bob, alice.dhPublicKey)).rejects.toThrow('no room key material')

    // Clean up the spy
    importRoomKeySpy.mockRestore()
  })
})
