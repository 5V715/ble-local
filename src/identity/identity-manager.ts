import { generateSigningKeyPair, generateDhKeyPair } from '../crypto/crypto-engine'

export interface Identity {
  signPublicKey: Uint8Array
  signPrivateKey: Uint8Array
  dhPublicKey: Uint8Array
  dhPrivateKey: Uint8Array
  nickname: string
}

const DB_NAME = 'ble-local-chat'
const STORE_NAME = 'identity'
const RECORD_KEY = 'self'

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function getRecord(db: IDBDatabase): Promise<Identity | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(RECORD_KEY)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function putRecord(db: IDBDatabase, identity: Identity): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(identity, RECORD_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadOrCreateIdentity(factory: IDBFactory, nickname: string): Promise<Identity> {
  const db = await openDb(factory)
  const existing = await getRecord(db)
  if (existing) {
    // Keys are stable across sessions (that's what makes the safety-number
    // fingerprint meaningful), but the nickname is chosen fresh on every
    // join via the setup form — persist it if it changed, rather than
    // silently keeping whatever name was picked the first time this
    // browser ever joined.
    if (existing.nickname === nickname) return existing
    const updated: Identity = { ...existing, nickname }
    await putRecord(db, updated)
    return updated
  }

  const signing = generateSigningKeyPair()
  const dh = generateDhKeyPair()
  const identity: Identity = {
    signPublicKey: signing.publicKey,
    signPrivateKey: signing.privateKey,
    dhPublicKey: dh.publicKey,
    dhPrivateKey: dh.privateKey,
    nickname
  }
  await putRecord(db, identity)
  return identity
}

export function fingerprint(identity: Pick<Identity, 'signPublicKey' | 'dhPublicKey'>): string {
  const toHexBlocks = (bytes: Uint8Array, blockCount: number): string[] => {
    let hex = ''
    for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
    return (hex.match(/.{1,4}/g) ?? []).slice(0, blockCount)
  }
  const signBlocks = toHexBlocks(identity.signPublicKey, 6)
  const dhBlocks = toHexBlocks(identity.dhPublicKey, 6)
  return [...signBlocks, ...dhBlocks].join(' ')
}
