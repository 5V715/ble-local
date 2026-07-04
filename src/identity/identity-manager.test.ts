import { describe, it, expect } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { loadOrCreateIdentity, fingerprint } from './identity-manager'

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
})
