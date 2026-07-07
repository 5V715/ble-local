import { describe, it, expect } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { loadOrCreateIdentity, fingerprint, type Identity } from './identity-manager'
import { generateSigningKeyPair, generateDhKeyPair } from '../crypto/crypto-engine'

describe('loadOrCreateIdentity', () => {
  it('creates a new identity with the given nickname', async () => {
    const db = new IDBFactory()
    const identity = await loadOrCreateIdentity(db, 'alice')
    expect(identity.nickname).toBe('alice')
    expect(identity.signPublicKey.length).toBe(32)
    expect(identity.dhPublicKey.length).toBe(32)
  })

  it('returns the same keys on a second call against the same database', async () => {
    const db = new IDBFactory()
    const first = await loadOrCreateIdentity(db, 'alice')
    const second = await loadOrCreateIdentity(db, 'alice')
    expect(second.signPublicKey).toEqual(first.signPublicKey)
    expect(second.dhPublicKey).toEqual(first.dhPublicKey)
  })

  it('adopts a newly chosen nickname on a later call while keeping the same keys', async () => {
    const db = new IDBFactory()
    const first = await loadOrCreateIdentity(db, 'alice')
    const second = await loadOrCreateIdentity(db, 'alicia')
    expect(second.nickname).toBe('alicia')
    expect(second.signPublicKey).toEqual(first.signPublicKey)
    expect(second.dhPublicKey).toEqual(first.dhPublicKey)

    const third = await loadOrCreateIdentity(db, 'alicia')
    expect(third.nickname).toBe('alicia')
  })
})

describe('fingerprint', () => {
  it('is deterministic for the same keys', async () => {
    const db = new IDBFactory()
    const identity = await loadOrCreateIdentity(db, 'alice')
    expect(fingerprint(identity)).toBe(fingerprint(identity))
  })

  it('differs for different keys', async () => {
    const dbA = new IDBFactory()
    const dbB = new IDBFactory()
    const a = await loadOrCreateIdentity(dbA, 'alice')
    const b = await loadOrCreateIdentity(dbB, 'bob')
    expect(fingerprint(a)).not.toBe(fingerprint(b))
  })

  it('differs when only dhPublicKey differs (regression: both keys must be included)', () => {
    // Create two identities with the same signing key but different DH keys.
    // This is a regression test for the bug where fingerprint() only included
    // the signing key and ignored the DH key.
    const signing = generateSigningKeyPair()
    const dh1 = generateDhKeyPair()
    const dh2 = generateDhKeyPair()

    const identity1: Pick<Identity, 'signPublicKey' | 'dhPublicKey'> = {
      signPublicKey: signing.publicKey,
      dhPublicKey: dh1.publicKey
    }

    const identity2: Pick<Identity, 'signPublicKey' | 'dhPublicKey'> = {
      signPublicKey: signing.publicKey,
      dhPublicKey: dh2.publicKey
    }

    expect(fingerprint(identity1)).not.toBe(fingerprint(identity2))
  })
})
