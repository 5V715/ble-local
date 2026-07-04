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
  if (existing) return existing

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
  const combined = new Uint8Array(identity.signPublicKey.length + identity.dhPublicKey.length)
  combined.set(identity.signPublicKey, 0)
  combined.set(identity.dhPublicKey, identity.signPublicKey.length)
  let hex = ''
  for (const byte of combined) hex += byte.toString(16).padStart(2, '0')
  // Group into 4-character blocks for a Signal-style "safety number" look.
  return (hex.match(/.{1,4}/g) ?? []).slice(0, 12).join(' ')
}
