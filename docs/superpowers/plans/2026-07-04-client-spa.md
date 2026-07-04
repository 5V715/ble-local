# BLE Local Chat — Client SPA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the browser SPA client for the BLE local encrypted chat app — identity, crypto, framing/chunking, group-key management, roster tracking, chat logic, and UI — developed and tested entirely against a `BroadcastChannel`-based mock hub, then deployed to GitHub Pages. The real Web Bluetooth transport is built and unit-tested (with a mocked `navigator.bluetooth`) but end-to-end validation against real ESP32 hub firmware happens in a separate plan.

**Architecture:** A `Transport` interface abstracts "talk to the hub"; two implementations exist (`MockHubTransport` over `BroadcastChannel`, `WebBluetoothTransport` over Web Bluetooth) and are interchangeable from the app's perspective. All identity, cryptography, room/roster bookkeeping, and chat logic live in framework-agnostic TypeScript modules that only depend on the `Transport` interface, not on which implementation is wired in. A thin vanilla-DOM UI layer sits on top.

**Tech Stack:** TypeScript, Vite (build/dev server), Vitest (tests), `@noble/curves` (Ed25519 signing + X25519 ECDH — used instead of relying on browser/Node `SubtleCrypto` support for these curves, which is inconsistent across environments), WebCrypto `SubtleCrypto` for AES-GCM + HKDF only (universally supported), no UI framework (vanilla DOM), GitHub Actions for GitHub Pages deployment.

## Global Constraints

- Node >= 20 (needed for stable global `crypto.subtle` in Vitest's Node environment).
- TypeScript strict mode (`"strict": true` in tsconfig). Verify with `npx tsc --noEmit` after implementing each task — neither `npm test` (Vitest) nor `npm run build` (Vite) type-checks, so both can pass while strict-mode errors remain (e.g. `Uint8Array<ArrayBufferLike>` vs. `BufferSource` when passing `Uint8Array` values to `SubtleCrypto` methods — fixed with `as BufferSource` casts where this comes up).
- Chrome/Chromium only — the app must feature-detect `navigator.bluetooth` and show a clear unsupported-browser message rather than failing silently (spec: Error handling).
- No backend/server component of any kind — GitHub Pages static hosting only.
- Text-only messages, no attachments (spec: Scope).
- Ed25519 (signing) and X25519 (ECDH) via `@noble/curves/ed25519`; AES-GCM + HKDF via WebCrypto `SubtleCrypto`.
- Every application-level message is signed by the sender's Ed25519 identity key (spec: Crypto Engine).
- Group key lifecycle: minted fresh only when the first member joins an otherwise-empty room; not rotated on individual member departure (spec: Key lifecycle).
- Repo already exists at `/home/me/ble-local`, one commit so far (the design spec) on a `master` branch — Task 1 renames it to `main` for GitHub Actions convention before adding more history.

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `src/sanity.test.ts`
- Create: `.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces: a working Vite + TypeScript + Vitest project skeleton that later tasks add files to. `npm run dev`, `npm run build`, `npm test` all exist as scripts.

- [ ] **Step 1: Rename the default branch to `main`**

```bash
git branch -m master main
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules
dist
.claude
```

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "ble-local-chat",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@noble/curves": "^1"
  },
  "devDependencies": {
    "typescript": "^5",
    "vite": "^5",
    "vitest": "^2"
  }
}
```

- [ ] **Step 4: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 5: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src"]
}
```

- [ ] **Step 6: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: './',
  test: {
    environment: 'node'
  }
})
```

- [ ] **Step 7: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>BLE Local Chat</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 8: Create `src/main.ts`**

```ts
console.log('BLE local chat starting…')
```

- [ ] **Step 9: Create `src/sanity.test.ts`**

```ts
import { describe, it, expect } from 'vitest'

describe('project scaffolding', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 10: Run the test suite**

```bash
npm test
```

Expected: PASS, 1 test passed.

- [ ] **Step 11: Run the build**

```bash
npm run build
```

Expected: succeeds, `dist/` created with `index.html` and bundled JS.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite/TypeScript/Vitest project"
```

---

### Task 2: Crypto Engine

**Files:**
- Create: `src/crypto/crypto-engine.ts`
- Test: `src/crypto/crypto-engine.test.ts`

**Interfaces:**
- Consumes: `@noble/curves/ed25519` (`ed25519`, `x25519`), global `crypto.subtle`
- Produces:
  - `generateSigningKeyPair(): { publicKey: Uint8Array; privateKey: Uint8Array }`
  - `sign(privateKey: Uint8Array, message: Uint8Array): Uint8Array`
  - `verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean`
  - `generateDhKeyPair(): { publicKey: Uint8Array; privateKey: Uint8Array }`
  - `deriveSharedSecret(privateKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array`
  - `deriveAesKey(sharedSecret: Uint8Array): Promise<CryptoKey>`
  - `generateRoomKeyMaterial(): Uint8Array` (32 random bytes)
  - `importRoomKey(raw: Uint8Array): Promise<CryptoKey>`
  - `encrypt(key: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array>` (returns `iv(12) || ciphertext+tag`)
  - `decrypt(key: CryptoKey, data: Uint8Array): Promise<Uint8Array>`

- [ ] **Step 1: Write failing tests**

```ts
// src/crypto/crypto-engine.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/crypto/crypto-engine.test.ts
```

Expected: FAIL — `crypto-engine.ts` does not exist yet.

- [ ] **Step 3: Implement `src/crypto/crypto-engine.ts`**

```ts
import { ed25519, x25519 } from '@noble/curves/ed25519'

export function generateSigningKeyPair() {
  const privateKey = ed25519.utils.randomPrivateKey()
  const publicKey = ed25519.getPublicKey(privateKey)
  return { publicKey, privateKey }
}

export function sign(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, privateKey)
}

export function verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  return ed25519.verify(signature, message, publicKey)
}

export function generateDhKeyPair() {
  const privateKey = x25519.utils.randomPrivateKey()
  const publicKey = x25519.getPublicKey(privateKey)
  return { publicKey, privateKey }
}

export function deriveSharedSecret(privateKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(privateKey, peerPublicKey)
}

const HKDF_INFO = new TextEncoder().encode('ble-local-chat')

export async function deriveAesKey(sharedSecret: Uint8Array): Promise<CryptoKey> {
  // `as BufferSource` casts below work around a strict-mode-only TS/DOM-lib
  // mismatch: this TS version's `Uint8Array` is generic over `ArrayBufferLike`
  // (includes `SharedArrayBuffer`), while `SubtleCrypto` methods want the
  // narrower `BufferSource`. The values here are always real ArrayBuffer-backed
  // Uint8Arrays, so the cast doesn't hide an actual type mismatch.
  const keyMaterial = await crypto.subtle.importKey('raw', sharedSecret as BufferSource, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0) as BufferSource, info: HKDF_INFO as BufferSource },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export function generateRoomKeyMaterial(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

export function importRoomKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

const IV_LENGTH = 12

export async function encrypt(key: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plaintext as BufferSource))
  const out = new Uint8Array(IV_LENGTH + ciphertext.length)
  out.set(iv, 0)
  out.set(ciphertext, IV_LENGTH)
  return out
}

export async function decrypt(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = data.slice(0, IV_LENGTH)
  const ciphertext = data.slice(IV_LENGTH)
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ciphertext as BufferSource))
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/crypto/crypto-engine.test.ts
```

Expected: PASS, 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/crypto
git commit -m "feat: add crypto engine (Ed25519 signing, X25519 ECDH, AES-GCM)"
```

---

### Task 3: Identity Manager

**Files:**
- Create: `src/identity/identity-manager.ts`
- Test: `src/identity/identity-manager.test.ts`

**Interfaces:**
- Consumes: `generateSigningKeyPair`, `generateDhKeyPair` from `../crypto/crypto-engine`
- Produces:
  - `interface Identity { signPublicKey: Uint8Array; signPrivateKey: Uint8Array; dhPublicKey: Uint8Array; dhPrivateKey: Uint8Array; nickname: string }`
  - `loadOrCreateIdentity(db: IDBFactory, nickname: string): Promise<Identity>`
  - `fingerprint(identity: Pick<Identity, 'signPublicKey' | 'dhPublicKey'>): string`

- [ ] **Step 1: Write failing tests**

```ts
// src/identity/identity-manager.test.ts
import { describe, it, expect } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { loadOrCreateIdentity, fingerprint } from './identity-manager'
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

  it('differs when only dhPublicKey differs', () => {
    const signing = generateSigningKeyPair()
    const a = { signPublicKey: signing.publicKey, dhPublicKey: generateDhKeyPair().publicKey }
    const b = { signPublicKey: signing.publicKey, dhPublicKey: generateDhKeyPair().publicKey }
    expect(fingerprint(a)).not.toBe(fingerprint(b))
  })
})
```

- [ ] **Step 2: Install the IndexedDB test double**

```bash
npm install -D fake-indexeddb
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run src/identity/identity-manager.test.ts
```

Expected: FAIL — `identity-manager.ts` does not exist yet.

- [ ] **Step 4: Implement `src/identity/identity-manager.ts`**

```ts
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
  // Blocks are taken from each key separately (not from a single truncated
  // concatenation) so the fingerprint is genuinely sensitive to both keys —
  // a naive "concatenate then truncate" approach never reaches the second
  // key's bytes once truncated to a short block count.
  const toHexBlocks = (bytes: Uint8Array, blockCount: number): string[] => {
    let hex = ''
    for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
    return (hex.match(/.{1,4}/g) ?? []).slice(0, blockCount)
  }
  const signBlocks = toHexBlocks(identity.signPublicKey, 6)
  const dhBlocks = toHexBlocks(identity.dhPublicKey, 6)
  return [...signBlocks, ...dhBlocks].join(' ')
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/identity/identity-manager.test.ts
```

Expected: PASS, 5 tests passed.

- [ ] **Step 6: Commit**

```bash
git add src/identity package.json package-lock.json
git commit -m "feat: add identity manager with IndexedDB-persisted keypairs"
```

---

### Task 4: Protocol framing (envelope + chunking)

**Files:**
- Create: `src/protocol/framing.ts`
- Test: `src/protocol/framing.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions over `Uint8Array`)
- Produces:
  - `enum MessageType { PRESENCE = 0, KEY_PACKAGE = 1, GROUP_MESSAGE = 2, DIRECT_MESSAGE = 3 }`
  - `const BROADCAST_RECIPIENT = 0xff`
  - `interface FrameHeader { msgType: MessageType; senderShortId: number; recipientShortId: number; seq: number; chunkIndex: number; chunkCount: number }`
  - `interface DecodedChunk extends FrameHeader { payload: Uint8Array }`
  - `encodeChunk(header: FrameHeader, payload: Uint8Array): Uint8Array`
  - `decodeChunk(bytes: Uint8Array): DecodedChunk`
  - `buildChunks(header: Omit<FrameHeader, 'chunkIndex' | 'chunkCount'>, fullPayload: Uint8Array, maxChunkPayloadSize: number): Uint8Array[]`
  - `class FrameReassembler { addChunk(chunk: DecodedChunk, nowMs?: number): { msgType: MessageType; senderShortId: number; recipientShortId: number; seq: number; payload: Uint8Array } | null; sweep(nowMs: number, maxAgeMs: number): void }` — `nowMs` defaults to `0`; a caller that uses `sweep()` with real wall-clock time MUST also pass a real `nowMs` (e.g. `Date.now()`) to every `addChunk` call, or every pending reassembly will appear infinitely old on the next sweep. Task 9's `ChatController` does this correctly (`addChunk(chunk, Date.now())` and `sweep(Date.now(), ...)`) — any other future caller must do the same.

- [ ] **Step 1: Write failing tests**

```ts
// src/protocol/framing.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/protocol/framing.test.ts
```

Expected: FAIL — `framing.ts` does not exist yet.

- [ ] **Step 3: Implement `src/protocol/framing.ts`**

```ts
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
```

- [ ] **Step 4: Fix the reassembly test's timing assumption**

The `addChunk` calls in the tests above don't pass `nowMs`, so they all default to `0`; the sweep test passes `1_000_000` as `nowMs` for the *sweep* call, which is what ages out the pending entry created at `firstSeenAtMs = 0`. No test changes needed — re-read the sweep test to confirm this matches the implementation before moving on.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/protocol/framing.test.ts
```

Expected: PASS, 6 tests passed.

- [ ] **Step 6: Commit**

```bash
git add src/protocol
git commit -m "feat: add protocol framing with chunking and reassembly"
```

---

### Task 5: Message types (presence, key package, chat)

**Files:**
- Create: `src/protocol/messages.ts`
- Test: `src/protocol/messages.test.ts`

**Interfaces:**
- Consumes: `sign`, `verify` from `../crypto/crypto-engine`; nothing from framing (operates on the logical payload bytes that framing carries)
- Produces:
  - `encodePresence(input: { nickname: string; signPublicKey: Uint8Array; dhPublicKey: Uint8Array; signPrivateKey: Uint8Array }): Uint8Array`
  - `interface DecodedPresence { nickname: string; signPublicKey: Uint8Array; dhPublicKey: Uint8Array; valid: boolean }`
  - `decodePresence(bytes: Uint8Array): DecodedPresence`
  - `encodeKeyPackage(input: { wrappedRoomKey: Uint8Array; epoch: number; signPrivateKey: Uint8Array }): Uint8Array`
  - `interface DecodedKeyPackage { wrappedRoomKey: Uint8Array; epoch: number; valid: boolean }`
  - `decodeKeyPackage(bytes: Uint8Array, senderSignPublicKey: Uint8Array): DecodedKeyPackage`
  - `encodeChatPayload(input: { ciphertext: Uint8Array; signPrivateKey: Uint8Array }): Uint8Array`
  - `interface DecodedChatPayload { ciphertext: Uint8Array; valid: boolean }`
  - `decodeChatPayload(bytes: Uint8Array, senderSignPublicKey: Uint8Array): DecodedChatPayload`

- [ ] **Step 1: Write failing tests**

```ts
// src/protocol/messages.test.ts
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

  it('round-trips and verifies with a large ciphertext (regression test for toBase64 stack overflow)', () => {
    const sender = generateSigningKeyPair()
    const ciphertext = crypto.getRandomValues(new Uint8Array(200_000))
    const bytes = encodeChatPayload({ ciphertext, signPrivateKey: sender.privateKey })
    const decoded = decodeChatPayload(bytes, sender.publicKey)
    expect(decoded.valid).toBe(true)
    expect(decoded.ciphertext).toEqual(ciphertext)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/protocol/messages.test.ts
```

Expected: FAIL — `messages.ts` does not exist yet.

- [ ] **Step 3: Implement `src/protocol/messages.ts`**

```ts
import { sign, verify } from '../crypto/crypto-engine'

function toBase64(bytes: Uint8Array): string {
  // Batch into fixed-size chunks rather than spreading the whole array as
  // call arguments — String.fromCharCode(...bytes) throws "Maximum call
  // stack size exceeded" once bytes is large enough (tens of thousands of
  // bytes, engine-dependent).
  const CHUNK_SIZE = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE))
  }
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(
    atob(value)
      .split('')
      .map((c) => c.charCodeAt(0))
  )
}

interface PresenceBody {
  nickname: string
  signPublicKey: string
  dhPublicKey: string
}

export interface DecodedPresence {
  nickname: string
  signPublicKey: Uint8Array
  dhPublicKey: Uint8Array
  valid: boolean
}

export function encodePresence(input: {
  nickname: string
  signPublicKey: Uint8Array
  dhPublicKey: Uint8Array
  signPrivateKey: Uint8Array
}): Uint8Array {
  const body: PresenceBody = {
    nickname: input.nickname,
    signPublicKey: toBase64(input.signPublicKey),
    dhPublicKey: toBase64(input.dhPublicKey)
  }
  const bodyBytes = new TextEncoder().encode(JSON.stringify(body))
  const signature = sign(input.signPrivateKey, bodyBytes)
  return new TextEncoder().encode(JSON.stringify({ body, signature: toBase64(signature) }))
}

export function decodePresence(bytes: Uint8Array): DecodedPresence {
  try {
    const { body, signature } = JSON.parse(new TextDecoder().decode(bytes)) as {
      body: PresenceBody
      signature: string
    }
    const signPublicKey = fromBase64(body.signPublicKey)
    const bodyBytes = new TextEncoder().encode(JSON.stringify(body))
    const valid = verify(signPublicKey, bodyBytes, fromBase64(signature))
    return { nickname: body.nickname, signPublicKey, dhPublicKey: fromBase64(body.dhPublicKey), valid }
  } catch {
    return { nickname: '', signPublicKey: new Uint8Array(), dhPublicKey: new Uint8Array(), valid: false }
  }
}

interface KeyPackageBody {
  wrappedRoomKey: string
  epoch: number
}

export interface DecodedKeyPackage {
  wrappedRoomKey: Uint8Array
  epoch: number
  valid: boolean
}

export function encodeKeyPackage(input: { wrappedRoomKey: Uint8Array; epoch: number; signPrivateKey: Uint8Array }): Uint8Array {
  const body: KeyPackageBody = { wrappedRoomKey: toBase64(input.wrappedRoomKey), epoch: input.epoch }
  const bodyBytes = new TextEncoder().encode(JSON.stringify(body))
  const signature = sign(input.signPrivateKey, bodyBytes)
  return new TextEncoder().encode(JSON.stringify({ body, signature: toBase64(signature) }))
}

export function decodeKeyPackage(bytes: Uint8Array, senderSignPublicKey: Uint8Array): DecodedKeyPackage {
  try {
    const { body, signature } = JSON.parse(new TextDecoder().decode(bytes)) as {
      body: KeyPackageBody
      signature: string
    }
    const bodyBytes = new TextEncoder().encode(JSON.stringify(body))
    const valid = verify(senderSignPublicKey, bodyBytes, fromBase64(signature))
    return { wrappedRoomKey: fromBase64(body.wrappedRoomKey), epoch: body.epoch, valid }
  } catch {
    return { wrappedRoomKey: new Uint8Array(), epoch: 0, valid: false }
  }
}

interface ChatPayloadBody {
  ciphertext: string
}

export interface DecodedChatPayload {
  ciphertext: Uint8Array
  valid: boolean
}

export function encodeChatPayload(input: { ciphertext: Uint8Array; signPrivateKey: Uint8Array }): Uint8Array {
  const body: ChatPayloadBody = { ciphertext: toBase64(input.ciphertext) }
  const bodyBytes = new TextEncoder().encode(JSON.stringify(body))
  const signature = sign(input.signPrivateKey, bodyBytes)
  return new TextEncoder().encode(JSON.stringify({ body, signature: toBase64(signature) }))
}

export function decodeChatPayload(bytes: Uint8Array, senderSignPublicKey: Uint8Array): DecodedChatPayload {
  try {
    const { body, signature } = JSON.parse(new TextDecoder().decode(bytes)) as {
      body: ChatPayloadBody
      signature: string
    }
    const bodyBytes = new TextEncoder().encode(JSON.stringify(body))
    const valid = verify(senderSignPublicKey, bodyBytes, fromBase64(signature))
    return { ciphertext: fromBase64(body.ciphertext), valid }
  } catch {
    return { ciphertext: new Uint8Array(), valid: false }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/protocol/messages.test.ts
```

Expected: PASS, 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/protocol
git commit -m "feat: add signed message encoders for presence, key package, chat payload"
```

---

### Task 6: Transport interface + Mock Hub Transport

**Files:**
- Create: `src/transport/transport.ts`
- Create: `src/transport/mock-hub-transport.ts`
- Test: `src/transport/mock-hub-transport.test.ts`

**Interfaces:**
- Consumes: global `BroadcastChannel`, global `crypto.randomUUID`
- Produces:
  - `interface Transport { connect(): Promise<void>; disconnect(): Promise<void>; send(bytes: Uint8Array): Promise<void>; onFrame(cb: (bytes: Uint8Array) => void): void; onMemberJoined(cb: (shortId: number) => void): void; onMemberLeft(cb: (shortId: number) => void): void; onMemberList(cb: (shortIds: number[]) => void): void; readonly myShortId: number | null }`
  - `class MockHubTransport implements Transport` (constructor takes a room name string used as the `BroadcastChannel` name)

- [ ] **Step 1: Write failing tests**

```ts
// src/transport/mock-hub-transport.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { MockHubTransport } from './mock-hub-transport'

describe('MockHubTransport', () => {
  const created: MockHubTransport[] = []

  afterEach(async () => {
    for (const t of created) await t.disconnect()
    created.length = 0
  })

  function make(room: string) {
    const t = new MockHubTransport(room)
    created.push(t)
    return t
  }

  it('assigns a short id on connect', async () => {
    const room = crypto.randomUUID()
    const a = make(room)
    await a.connect()
    expect(a.myShortId).not.toBeNull()
  })

  it('assigns different short ids to two connected transports in the same room', async () => {
    const room = crypto.randomUUID()
    const a = make(room)
    const b = make(room)
    await a.connect()
    await b.connect()
    expect(a.myShortId).not.toBe(b.myShortId)
  })

  it('notifies an already-connected transport when another one joins', async () => {
    const room = crypto.randomUUID()
    const a = make(room)
    const b = make(room)
    await a.connect()

    const joined: number[] = []
    a.onMemberJoined((id) => joined.push(id))

    await b.connect()
    await new Promise((r) => setTimeout(r, 50))

    expect(joined).toContain(b.myShortId)
  })

  it('relays a broadcast frame sent by one transport to another', async () => {
    const room = crypto.randomUUID()
    const a = make(room)
    const b = make(room)
    await a.connect()
    await b.connect()

    const received: Uint8Array[] = []
    b.onFrame((bytes) => received.push(bytes))

    const payload = new TextEncoder().encode('hello')
    await a.send(payload)
    await new Promise((r) => setTimeout(r, 50))

    expect(received.length).toBe(1)
    expect(received[0]).toEqual(payload)
  })

  it('notifies remaining transports when one disconnects', async () => {
    const room = crypto.randomUUID()
    const a = make(room)
    const b = make(room)
    await a.connect()
    await b.connect()

    const left: number[] = []
    a.onMemberLeft((id) => left.push(id))

    const bId = b.myShortId
    await b.disconnect()
    await new Promise((r) => setTimeout(r, 50))

    expect(left).toContain(bId)
  })

  it('resets myShortId to null after disconnect', async () => {
    const room = crypto.randomUUID()
    const a = make(room)
    await a.connect()
    expect(a.myShortId).not.toBeNull()
    await a.disconnect()
    expect(a.myShortId).toBeNull()
  })

  it('gives a lone connecting transport an empty member list, not containing its own id', async () => {
    const room = crypto.randomUUID()
    const a = make(room)

    const lists: number[][] = []
    a.onMemberList((ids) => lists.push(ids))

    await a.connect()

    expect(lists.length).toBeGreaterThan(0)
    expect(lists[0]).toEqual([])
    expect(lists[0]).not.toContain(a.myShortId)
  })

  it('gives a second joiner a member list containing the first member but not its own id', async () => {
    const room = crypto.randomUUID()
    const a = make(room)
    const b = make(room)
    await a.connect()

    const lists: number[][] = []
    b.onMemberList((ids) => lists.push(ids))

    await b.connect()

    expect(lists.length).toBeGreaterThan(0)
    expect(lists[0]).toContain(a.myShortId)
    expect(lists[0]).not.toContain(b.myShortId)
  })

  it('treats reconnecting the same instance as a new peer join', async () => {
    const room = crypto.randomUUID()
    const a = make(room)
    const b = make(room)
    await a.connect()
    await b.connect()

    const joined: number[] = []
    a.onMemberJoined((id) => joined.push(id))

    await b.disconnect()
    await b.connect()
    await new Promise((r) => setTimeout(r, 50))

    expect(joined).toContain(b.myShortId)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/transport/mock-hub-transport.test.ts
```

Expected: FAIL — `mock-hub-transport.ts` does not exist yet.

- [ ] **Step 3: Implement `src/transport/transport.ts`**

```ts
export interface Transport {
  connect(): Promise<void>
  disconnect(): Promise<void>
  send(bytes: Uint8Array): Promise<void>
  onFrame(cb: (bytes: Uint8Array) => void): void
  onMemberJoined(cb: (shortId: number) => void): void
  onMemberLeft(cb: (shortId: number) => void): void
  onMemberList(cb: (shortIds: number[]) => void): void
  readonly myShortId: number | null
}
```

- [ ] **Step 4: Implement `src/transport/mock-hub-transport.ts`**

```ts
import type { Transport } from './transport'

// BroadcastChannel has no message history — a joiner that just creates its
// channel cannot see announcements posted before it existed. So joining is a
// query/response handshake: ask "who's here", wait a short window for
// existing members to (re-)announce themselves, then pick an id that avoids
// every id observed during that window.
const DISCOVERY_WINDOW_MS = 50

// Known limitation (accepted — this is a dev/testing-only simulator, not the
// real BLE transport): if two or more instances call connect() genuinely
// concurrently (not sequentially), they can all miss each other's queries
// during their own discovery windows and pick the same short id. The real
// hub firmware (a separate plan) assigns ids per BLE connection with no such
// race. Realistic use of this mock — a human manually opening tabs and
// clicking "join" one at a time — is inherently sequential, so this is not
// fixed with a heavier collision-retry protocol here.

type ControlMessage =
  | { kind: 'query' }
  | { kind: 'announce'; instanceId: string; shortId: number }
  | { kind: 'left'; shortId: number }
  | { kind: 'data'; bytes: number[] }

export class MockHubTransport implements Transport {
  private channel: BroadcastChannel | null = null
  private instanceId: string = ''
  private knownShortIds = new Set<number>()
  private knownPeerInstanceIds = new Set<string>()
  private _myShortId: number | null = null

  private frameCbs: Array<(bytes: Uint8Array) => void> = []
  private joinedCbs: Array<(shortId: number) => void> = []
  private leftCbs: Array<(shortId: number) => void> = []
  private listCbs: Array<(shortIds: number[]) => void> = []

  constructor(private roomName: string) {}

  get myShortId(): number | null {
    return this._myShortId
  }

  async connect(): Promise<void> {
    // Generated fresh per connect() (not once in the constructor) so that
    // disconnecting and reconnecting the same instance looks like a genuinely
    // new peer to others — which is correct: from a peer's perspective, a
    // device that left and came back IS a new join event.
    this.instanceId = crypto.randomUUID()
    this.channel = new BroadcastChannel(this.roomName)
    this.channel.addEventListener('message', this.handleMessage)

    this.broadcast({ kind: 'query' })
    await new Promise((resolve) => setTimeout(resolve, DISCOVERY_WINDOW_MS))

    const candidate = this.pickNextShortId()
    this._myShortId = candidate
    // Fire the member-list snapshot BEFORE adding our own candidate id to
    // knownShortIds — a member list represents OTHER members, not ourselves.
    // (Adding self first would make a lone joiner see itself in its own
    // member list, breaking any isEmpty()-style bootstrap check downstream.)
    this.listCbs.forEach((cb) => cb([...this.knownShortIds]))
    this.knownShortIds.add(candidate)
    this.broadcast({ kind: 'announce', instanceId: this.instanceId, shortId: candidate })
  }

  async disconnect(): Promise<void> {
    if (this._myShortId !== null) {
      this.broadcast({ kind: 'left', shortId: this._myShortId })
    }
    this._myShortId = null
    this.channel?.removeEventListener('message', this.handleMessage)
    this.channel?.close()
    this.channel = null
  }

  async send(bytes: Uint8Array): Promise<void> {
    this.broadcast({ kind: 'data', bytes: [...bytes] })
  }

  onFrame(cb: (bytes: Uint8Array) => void): void {
    this.frameCbs.push(cb)
  }

  onMemberJoined(cb: (shortId: number) => void): void {
    this.joinedCbs.push(cb)
  }

  onMemberLeft(cb: (shortId: number) => void): void {
    this.leftCbs.push(cb)
  }

  onMemberList(cb: (shortIds: number[]) => void): void {
    this.listCbs.push(cb)
  }

  private pickNextShortId(): number {
    let candidate = 1
    while (this.knownShortIds.has(candidate)) candidate++
    return candidate
  }

  private broadcast(message: ControlMessage): void {
    this.channel?.postMessage(message)
  }

  private handleMessage = (event: MessageEvent<ControlMessage>): void => {
    const message = event.data
    if (message.kind === 'query') {
      if (this._myShortId !== null) {
        this.broadcast({ kind: 'announce', instanceId: this.instanceId, shortId: this._myShortId })
      }
      return
    }
    if (message.kind === 'announce') {
      if (message.instanceId === this.instanceId) return
      this.knownShortIds.add(message.shortId)
      const isNewPeer = !this.knownPeerInstanceIds.has(message.instanceId)
      this.knownPeerInstanceIds.add(message.instanceId)
      // Only a genuinely new peer, learned about after our own discovery
      // window closed, is a "join" — announces seen during our own
      // discovery are just populating our initial member list.
      if (isNewPeer && this._myShortId !== null) {
        this.joinedCbs.forEach((cb) => cb(message.shortId))
      }
      return
    }
    if (message.kind === 'left') {
      this.knownShortIds.delete(message.shortId)
      this.leftCbs.forEach((cb) => cb(message.shortId))
      return
    }
    if (message.kind === 'data') {
      this.frameCbs.forEach((cb) => cb(new Uint8Array(message.bytes)))
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/transport/mock-hub-transport.test.ts
```

Expected: PASS, 9 tests passed.

- [ ] **Step 6: Commit**

```bash
git add src/transport
git commit -m "feat: add Transport interface and BroadcastChannel-based mock hub"
```

---

### Task 7: Group Key Manager

**Files:**
- Create: `src/room/group-key-manager.ts`
- Test: `src/room/group-key-manager.test.ts`

**Interfaces:**
- Consumes: `deriveSharedSecret`, `deriveAesKey`, `generateRoomKeyMaterial`, `importRoomKey`, `encrypt`, `decrypt` from `../crypto/crypto-engine`; `encodeKeyPackage`, `decodeKeyPackage` from `../protocol/messages`; `Identity` from `../identity/identity-manager`
- Produces:
  - `class GroupKeyManager`
    - `hasRoomKey(): boolean`
    - `mintNewRoomKey(): Promise<void>`
    - `getRoomKey(): CryptoKey | null`
    - `buildKeyPackageFor(myIdentity: Identity, peerDhPublicKey: Uint8Array): Promise<Uint8Array>` (returns encoded bytes ready to send as a `KEY_PACKAGE` payload)
    - `acceptKeyPackage(bytes: Uint8Array, senderSignPublicKey: Uint8Array, myIdentity: Identity, peerDhPublicKey: Uint8Array): Promise<boolean>`

- [ ] **Step 1: Write failing tests**

```ts
// src/room/group-key-manager.test.ts
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

    // Bob tries to accept it, but passes Carol's DH public key instead of Alice's.
    // The signature will verify (Alice signed it), but decrypt will fail.
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

    // Capture Carol's room key before attempting the stale acceptance below.
    const carolRoomKey = bobKeys.getRoomKey()

    // Now try to send Alice's original (stale-epoch) package to Bob again.
    // The signature is valid, but the epoch is now stale.
    const accepted3 = await bobKeys.acceptKeyPackage(alicePackage, alice.signPublicKey, bob, alice.dhPublicKey)
    expect(accepted3).toBe(false)
    // Room key must still be the same object as before the rejected call —
    // comparing getRoomKey() to itself would prove nothing, so compare
    // against the reference captured beforehand.
    expect(bobKeys.getRoomKey()).toBe(carolRoomKey)
    expect(bobKeys.hasRoomKey()).toBe(true)
  })

  it('does not mutate state partially if importRoomKey throws after successful decrypt', async () => {
    const alice = makeIdentity('alice')
    const bob = makeIdentity('bob')

    const aliceKeys = new GroupKeyManager()
    await aliceKeys.mintNewRoomKey()
    const alicePackage = await aliceKeys.buildKeyPackageFor(alice, bob.dhPublicKey)

    const importRoomKeySpy = vi.spyOn(cryptoEngine, 'importRoomKey').mockRejectedValue(new Error('importRoomKey failed'))

    const bobKeys = new GroupKeyManager()
    const accepted = await bobKeys.acceptKeyPackage(alicePackage, alice.signPublicKey, bob, alice.dhPublicKey)

    expect(accepted).toBe(false)
    expect(bobKeys.hasRoomKey()).toBe(false)
    expect(bobKeys.getRoomKey()).toBeNull()

    // hasRoomKey()/getRoomKey() alone wouldn't distinguish this from the
    // pre-fix ordering — in this scenario roomKey is never set either way.
    // pendingRawKey is private, so check its effect indirectly: it must
    // still be null, or buildKeyPackageFor would proceed using a leaked,
    // never-adopted key instead of throwing.
    await expect(bobKeys.buildKeyPackageFor(bob, alice.dhPublicKey)).rejects.toThrow('no room key material')

    importRoomKeySpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/room/group-key-manager.test.ts
```

Expected: FAIL — `group-key-manager.ts` does not exist yet.

- [ ] **Step 3: Implement `src/room/group-key-manager.ts`**

```ts
import {
  deriveSharedSecret,
  deriveAesKey,
  generateRoomKeyMaterial,
  importRoomKey,
  encrypt,
  decrypt
} from '../crypto/crypto-engine'
import { encodeKeyPackage, decodeKeyPackage } from '../protocol/messages'
import type { Identity } from '../identity/identity-manager'

export class GroupKeyManager {
  private roomKey: CryptoKey | null = null
  private epoch = 0

  hasRoomKey(): boolean {
    return this.roomKey !== null
  }

  getRoomKey(): CryptoKey | null {
    return this.roomKey
  }

  async mintNewRoomKey(): Promise<void> {
    const raw = generateRoomKeyMaterial()
    this.roomKey = await importRoomKey(raw)
    this.epoch = Date.now()
    this.pendingRawKey = raw
  }

  private pendingRawKey: Uint8Array | null = null

  async buildKeyPackageFor(myIdentity: Identity, peerDhPublicKey: Uint8Array): Promise<Uint8Array> {
    if (!this.pendingRawKey) {
      throw new Error('GroupKeyManager: no room key material to share (mint or accept one first)')
    }
    const sharedSecret = deriveSharedSecret(myIdentity.dhPrivateKey, peerDhPublicKey)
    const wrappingKey = await deriveAesKey(sharedSecret)
    const wrappedRoomKey = await encrypt(wrappingKey, this.pendingRawKey)
    return encodeKeyPackage({ wrappedRoomKey, epoch: this.epoch, signPrivateKey: myIdentity.signPrivateKey })
  }

  async acceptKeyPackage(
    bytes: Uint8Array,
    senderSignPublicKey: Uint8Array,
    myIdentity: Identity,
    senderDhPublicKey: Uint8Array
  ): Promise<boolean> {
    const decoded = decodeKeyPackage(bytes, senderSignPublicKey)
    if (!decoded.valid) return false
    if (this.roomKey && decoded.epoch <= this.epoch) return false

    try {
      // Every fallible step (including importRoomKey) must succeed before
      // any of pendingRawKey/roomKey/epoch is touched — otherwise a failure
      // partway through could leave these three fields in an inconsistent
      // state (e.g. pendingRawKey updated but roomKey/epoch still old).
      const sharedSecret = deriveSharedSecret(myIdentity.dhPrivateKey, senderDhPublicKey)
      const wrappingKey = await deriveAesKey(sharedSecret)
      const raw = await decrypt(wrappingKey, decoded.wrappedRoomKey)
      const imported = await importRoomKey(raw)

      this.pendingRawKey = raw
      this.roomKey = imported
      this.epoch = decoded.epoch
      return true
    } catch {
      // A validly-signed package can still fail to decrypt if it was wrapped
      // for a different recipient (e.g. a relayed/misdirected package, or a
      // caller-supplied senderDhPublicKey that doesn't match the real
      // sender). An untrusted relay hub could otherwise use this to throw an
      // unhandled rejection at any caller — resolve false instead, leaving
      // state unchanged, same as the other rejection paths above.
      return false
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/room/group-key-manager.test.ts
```

Expected: PASS, 7 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/room/group-key-manager.ts src/room/group-key-manager.test.ts
git commit -m "feat: add group key manager with mint/wrap/unwrap"
```

---

### Task 8: Roster Manager

**Files:**
- Create: `src/room/roster-manager.ts`
- Test: `src/room/roster-manager.test.ts`

**Interfaces:**
- Consumes: nothing external (pure state container)
- Produces:
  - `interface Member { shortId: number; nickname: string; signPublicKey: Uint8Array; dhPublicKey: Uint8Array; verified: boolean }`
  - `class RosterManager`
    - `onMemberList(shortIds: number[]): void`
    - `onMemberJoined(shortId: number): void`
    - `onMemberLeft(shortId: number): void`
    - `onPresence(shortId: number, nickname: string, signPublicKey: Uint8Array, dhPublicKey: Uint8Array): void`
    - `getMember(shortId: number): Member | undefined`
    - `getAllMembers(): Member[]`
    - `markVerified(shortId: number): void`
    - `isEmpty(): boolean`

- [ ] **Step 1: Write failing tests**

```ts
// src/room/roster-manager.test.ts
import { describe, it, expect } from 'vitest'
import { RosterManager } from './roster-manager'

describe('RosterManager', () => {
  it('starts empty', () => {
    const roster = new RosterManager()
    expect(roster.isEmpty()).toBe(true)
    expect(roster.getAllMembers()).toEqual([])
  })

  it('tracks a member joining then announcing presence', () => {
    const roster = new RosterManager()
    roster.onMemberJoined(4)
    expect(roster.isEmpty()).toBe(false)
    expect(roster.getMember(4)).toBeUndefined()

    const signPublicKey = new Uint8Array([1])
    const dhPublicKey = new Uint8Array([2])
    roster.onPresence(4, 'bob', signPublicKey, dhPublicKey)

    const member = roster.getMember(4)
    expect(member?.nickname).toBe('bob')
    expect(member?.signPublicKey).toEqual(signPublicKey)
    expect(member?.verified).toBe(false)
  })

  it('seeds members from a member list frame', () => {
    const roster = new RosterManager()
    roster.onMemberList([1, 2, 3])
    expect(roster.isEmpty()).toBe(false)
    expect(roster.getAllMembers().map((m) => m.shortId).sort()).toEqual([])
    // member list only reserves the ids; presence still required to populate details
  })

  it('removes a member on leave', () => {
    const roster = new RosterManager()
    roster.onMemberJoined(4)
    roster.onPresence(4, 'bob', new Uint8Array([1]), new Uint8Array([2]))
    roster.onMemberLeft(4)
    expect(roster.getMember(4)).toBeUndefined()
    expect(roster.isEmpty()).toBe(true)
  })

  it('marks a member verified', () => {
    const roster = new RosterManager()
    roster.onMemberJoined(4)
    roster.onPresence(4, 'bob', new Uint8Array([1]), new Uint8Array([2]))
    roster.markVerified(4)
    expect(roster.getMember(4)?.verified).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/room/roster-manager.test.ts
```

Expected: FAIL — `roster-manager.ts` does not exist yet.

- [ ] **Step 3: Implement `src/room/roster-manager.ts`**

```ts
export interface Member {
  shortId: number
  nickname: string
  signPublicKey: Uint8Array
  dhPublicKey: Uint8Array
  verified: boolean
}

// Assumes onMemberLeft/onPresence/onMemberJoined are all driven by the same
// transport instance's callbacks, in the order that transport delivers them
// (true for both MockHubTransport and WebBluetoothTransport — a single
// connection's frame stream is ordered). A presence frame is never expected
// to arrive after that member's own leave event under this assumption; a
// caller wiring this from a transport with reordering/retries would need to
// guard against resurrecting a departed member itself.
export class RosterManager {
  private connectedIds = new Set<number>()
  private members = new Map<number, Member>()

  onMemberList(shortIds: number[]): void {
    for (const id of shortIds) this.connectedIds.add(id)
  }

  onMemberJoined(shortId: number): void {
    this.connectedIds.add(shortId)
  }

  onMemberLeft(shortId: number): void {
    this.connectedIds.delete(shortId)
    this.members.delete(shortId)
  }

  onPresence(shortId: number, nickname: string, signPublicKey: Uint8Array, dhPublicKey: Uint8Array): void {
    this.connectedIds.add(shortId)
    const existing = this.members.get(shortId)
    this.members.set(shortId, {
      shortId,
      nickname,
      signPublicKey,
      dhPublicKey,
      verified: existing?.verified ?? false
    })
  }

  getMember(shortId: number): Member | undefined {
    return this.members.get(shortId)
  }

  getAllMembers(): Member[] {
    return [...this.members.values()]
  }

  // No-ops on an unknown shortId. Callers in this app only ever offer
  // verification for a member already returned by getAllMembers() (the UI
  // renders a "Verify" affordance per known member), so this is never
  // expected to be called before onPresence has populated that member.
  markVerified(shortId: number): void {
    const member = this.members.get(shortId)
    if (member) member.verified = true
  }

  isEmpty(): boolean {
    return this.connectedIds.size === 0
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/room/roster-manager.test.ts
```

Expected: PASS, 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/room/roster-manager.ts src/room/roster-manager.test.ts
git commit -m "feat: add roster manager"
```

---

### Task 9: Chat Controller

**Files:**
- Create: `src/chat/chat-controller.ts`
- Test: `src/chat/chat-controller.test.ts`

**Interfaces:**
- Consumes: `Transport` from `../transport/transport`; `Identity` from `../identity/identity-manager`; `RosterManager` from `../room/roster-manager`; `GroupKeyManager` from `../room/group-key-manager`; `MessageType`, `BROADCAST_RECIPIENT`, `buildChunks`, `decodeChunk`, `FrameReassembler` from `../protocol/framing`; `encodePresence`, `decodePresence`, `encodeChatPayload`, `decodeChatPayload` from `../protocol/messages`; `encrypt`, `decrypt`, `deriveSharedSecret`, `deriveAesKey` from `../crypto/crypto-engine`
- Produces:
  - `interface IncomingChatMessage { fromShortId: number; nickname: string; text: string; scope: 'group' | 'direct' }`
  - `class ChatController`
    - `constructor(transport: Transport, identity: Identity, roster: RosterManager, groupKey: GroupKeyManager)`
    - `start(): Promise<void>`
    - `sendGroupMessage(text: string): Promise<void>`
    - `sendDirectMessage(recipientShortId: number, text: string): Promise<void>`
    - `onMessage(cb: (msg: IncomingChatMessage) => void): void`

- [ ] **Step 1: Write failing tests**

```ts
// src/chat/chat-controller.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { ChatController } from './chat-controller'
import { MockHubTransport } from '../transport/mock-hub-transport'
import { RosterManager } from '../room/roster-manager'
import { GroupKeyManager } from '../room/group-key-manager'
import { generateSigningKeyPair, generateDhKeyPair } from '../crypto/crypto-engine'
import type { Identity } from '../identity/identity-manager'

function makeIdentity(nickname: string): Identity {
  const signing = generateSigningKeyPair()
  const dh = generateDhKeyPair()
  return { nickname, signPublicKey: signing.publicKey, signPrivateKey: signing.privateKey, dhPublicKey: dh.publicKey, dhPrivateKey: dh.privateKey }
}

// Polls instead of sleeping a fixed duration — under CPU contention (e.g. the
// full suite's default parallel test pool), the real WebCrypto operations
// this chain triggers (AES-GCM, ECDH, Ed25519) can take longer than any fixed
// delay would reliably cover, causing intermittent failures. Polling has no
// such ceiling.
async function waitUntil(predicate: () => boolean, timeoutMs = 3000, intervalMs = 20): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitUntil: timed out waiting for condition')
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

describe('ChatController', () => {
  const transports: MockHubTransport[] = []
  afterEach(async () => {
    for (const t of transports) await t.disconnect()
    transports.length = 0
  })

  it('delivers a group message end-to-end between two controllers, with the second joiner bootstrapped by the first', async () => {
    const room = crypto.randomUUID()

    const aliceIdentity = makeIdentity('alice')
    const aliceTransport = new MockHubTransport(room)
    transports.push(aliceTransport)
    const aliceRoster = new RosterManager()
    const aliceGroupKey = new GroupKeyManager()
    const alice = new ChatController(aliceTransport, aliceIdentity, aliceRoster, aliceGroupKey)
    await alice.start() // alice is first in the room, so start() mints the room key via the real bootstrap gate

    const bobIdentity = makeIdentity('bob')
    const bobTransport = new MockHubTransport(room)
    transports.push(bobTransport)
    const bobRoster = new RosterManager()
    const bobGroupKey = new GroupKeyManager()
    const bob = new ChatController(bobTransport, bobIdentity, bobRoster, bobGroupKey)

    const bobMessages: string[] = []
    bob.onMessage((m) => bobMessages.push(m.text))

    await bob.start()
    await waitUntil(() => bobGroupKey.hasRoomKey()) // presence exchange + key package delivery

    expect(bobGroupKey.hasRoomKey()).toBe(true)

    await alice.sendGroupMessage('hello room')
    await waitUntil(() => bobMessages.includes('hello room'))

    expect(bobMessages).toContain('hello room')
  })

  it('delivers a direct message only to its recipient', async () => {
    const room = crypto.randomUUID()

    const aliceIdentity = makeIdentity('alice')
    const aliceTransport = new MockHubTransport(room)
    transports.push(aliceTransport)
    const aliceRoster = new RosterManager()
    const alice = new ChatController(aliceTransport, aliceIdentity, aliceRoster, new GroupKeyManager())
    await alice.start()

    const bobIdentity = makeIdentity('bob')
    const bobTransport = new MockHubTransport(room)
    transports.push(bobTransport)
    const bobMessages: string[] = []
    const bob = new ChatController(bobTransport, bobIdentity, new RosterManager(), new GroupKeyManager())
    bob.onMessage((m) => bobMessages.push(m.text))
    await bob.start()

    const carolIdentity = makeIdentity('carol')
    const carolTransport = new MockHubTransport(room)
    transports.push(carolTransport)
    const carolMessages: string[] = []
    const carol = new ChatController(carolTransport, carolIdentity, new RosterManager(), new GroupKeyManager())
    carol.onMessage((m) => carolMessages.push(m.text))
    await carol.start()

    const bobShortId = bobTransport.myShortId!
    await waitUntil(() => aliceRoster.getMember(bobShortId) !== undefined)

    await alice.sendDirectMessage(bobShortId, 'psst just you')
    await waitUntil(() => bobMessages.includes('psst just you'))

    expect(bobMessages).toContain('psst just you')
    expect(carolMessages).not.toContain('psst just you')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/chat/chat-controller.test.ts
```

Expected: FAIL — `chat-controller.ts` does not exist yet.

- [ ] **Step 3: Implement `src/chat/chat-controller.ts`**

```ts
import type { Transport } from '../transport/transport'
import type { Identity } from '../identity/identity-manager'
import { RosterManager } from '../room/roster-manager'
import { GroupKeyManager } from '../room/group-key-manager'
import { MessageType, BROADCAST_RECIPIENT, buildChunks, decodeChunk, FrameReassembler } from '../protocol/framing'
import { encodePresence, decodePresence, encodeChatPayload, decodeChatPayload } from '../protocol/messages'
import { encrypt, decrypt, deriveSharedSecret, deriveAesKey } from '../crypto/crypto-engine'

const MAX_CHUNK_PAYLOAD_SIZE = 180
const REASSEMBLY_TIMEOUT_MS = 15_000
const REASSEMBLY_SWEEP_INTERVAL_MS = 5_000

export interface IncomingChatMessage {
  fromShortId: number
  nickname: string
  text: string
  scope: 'group' | 'direct'
}

export class ChatController {
  private reassembler = new FrameReassembler()
  private seenSeqBySender = new Map<number, number>()
  private nextSeq = 1
  private messageCbs: Array<(msg: IncomingChatMessage) => void> = []
  private directKeyCache = new Map<number, CryptoKey>()

  constructor(
    private transport: Transport,
    private identity: Identity,
    private roster: RosterManager,
    private groupKey: GroupKeyManager
  ) {}

  async start(): Promise<void> {
    this.transport.onMemberList((ids) => this.roster.onMemberList(ids))
    // Re-announce our own presence whenever a new peer joins. BroadcastChannel
    // (and, in general, any transport with no message replay) has no history,
    // so a peer that joins after we already broadcast our presence would
    // otherwise never learn our identity (nickname/signing key/DH key) — and
    // without that, it can't verify a KEY_PACKAGE or DIRECT_MESSAGE we later
    // sign and send to it. This was caught by Task 9's own integration test
    // failing, not by inspection of Tasks 6-8 in isolation.
    this.transport.onMemberJoined((id) => {
      this.roster.onMemberJoined(id)
      void this.broadcastPresence()
    })
    this.transport.onMemberLeft((id) => this.roster.onMemberLeft(id))
    this.transport.onFrame((bytes) => this.handleIncomingBytes(bytes))

    await this.transport.connect()
    // If nobody else is in the room yet, we're the first member: mint the
    // room key ourselves. Doing this here (not in the UI layer) means this
    // bootstrap decision is exercised by this class's own tests instead of
    // being bypassed by a caller that mints unconditionally.
    if (this.roster.isEmpty()) {
      await this.groupKey.mintNewRoomKey()
    }
    await this.broadcastPresence()

    setInterval(() => this.reassembler.sweep(Date.now(), REASSEMBLY_TIMEOUT_MS), REASSEMBLY_SWEEP_INTERVAL_MS)
  }

  onMessage(cb: (msg: IncomingChatMessage) => void): void {
    this.messageCbs.push(cb)
  }

  async sendGroupMessage(text: string): Promise<void> {
    if (!this.groupKey.hasRoomKey()) {
      throw new Error('ChatController: no room key established yet')
    }
    const ciphertext = await encrypt(this.groupKey.getRoomKey()!, new TextEncoder().encode(text))
    const payload = encodeChatPayload({ ciphertext, signPrivateKey: this.identity.signPrivateKey })
    await this.sendFramed(MessageType.GROUP_MESSAGE, BROADCAST_RECIPIENT, payload)
  }

  async sendDirectMessage(recipientShortId: number, text: string): Promise<void> {
    const member = this.roster.getMember(recipientShortId)
    if (!member) {
      throw new Error(`ChatController: unknown recipient ${recipientShortId}`)
    }
    const key = await this.getOrCreateDirectKey(recipientShortId, member.dhPublicKey)
    const ciphertext = await encrypt(key, new TextEncoder().encode(text))
    const payload = encodeChatPayload({ ciphertext, signPrivateKey: this.identity.signPrivateKey })
    await this.sendFramed(MessageType.DIRECT_MESSAGE, recipientShortId, payload)
  }

  private async getOrCreateDirectKey(peerShortId: number, peerDhPublicKey: Uint8Array): Promise<CryptoKey> {
    const cached = this.directKeyCache.get(peerShortId)
    if (cached) return cached
    const sharedSecret = deriveSharedSecret(this.identity.dhPrivateKey, peerDhPublicKey)
    const key = await deriveAesKey(sharedSecret)
    this.directKeyCache.set(peerShortId, key)
    return key
  }

  private async broadcastPresence(): Promise<void> {
    const payload = encodePresence({
      nickname: this.identity.nickname,
      signPublicKey: this.identity.signPublicKey,
      dhPublicKey: this.identity.dhPublicKey,
      signPrivateKey: this.identity.signPrivateKey
    })
    await this.sendFramed(MessageType.PRESENCE, BROADCAST_RECIPIENT, payload)
  }

  private async sendFramed(msgType: MessageType, recipientShortId: number, payload: Uint8Array): Promise<void> {
    const seq = this.nextSeq++
    const senderShortId = this.transport.myShortId ?? 0
    const chunks = buildChunks({ msgType, senderShortId, recipientShortId, seq }, payload, MAX_CHUNK_PAYLOAD_SIZE)
    for (const chunk of chunks) {
      await this.transport.send(chunk)
    }
  }

  private async handleIncomingBytes(bytes: Uint8Array): Promise<void> {
    const chunk = decodeChunk(bytes)
    const reassembled = this.reassembler.addChunk(chunk, Date.now())
    if (!reassembled) return

    const lastSeenSeq = this.seenSeqBySender.get(reassembled.senderShortId) ?? 0
    if (reassembled.seq <= lastSeenSeq) return
    this.seenSeqBySender.set(reassembled.senderShortId, reassembled.seq)

    if (reassembled.msgType === MessageType.PRESENCE) {
      const decoded = decodePresence(reassembled.payload)
      if (!decoded.valid) return
      this.roster.onPresence(reassembled.senderShortId, decoded.nickname, decoded.signPublicKey, decoded.dhPublicKey)
      await this.maybeSendKeyPackageTo(reassembled.senderShortId, decoded.dhPublicKey)
      return
    }

    if (reassembled.msgType === MessageType.KEY_PACKAGE) {
      if (reassembled.recipientShortId !== this.transport.myShortId) return
      const sender = this.roster.getMember(reassembled.senderShortId)
      if (!sender) return
      await this.groupKey.acceptKeyPackage(reassembled.payload, sender.signPublicKey, this.identity, sender.dhPublicKey)
      return
    }

    if (reassembled.msgType === MessageType.GROUP_MESSAGE) {
      const sender = this.roster.getMember(reassembled.senderShortId)
      if (!sender || !this.groupKey.hasRoomKey()) return
      const decoded = decodeChatPayload(reassembled.payload, sender.signPublicKey)
      if (!decoded.valid) return
      const plaintext = await decrypt(this.groupKey.getRoomKey()!, decoded.ciphertext)
      this.emit({ fromShortId: reassembled.senderShortId, nickname: sender.nickname, text: new TextDecoder().decode(plaintext), scope: 'group' })
      return
    }

    if (reassembled.msgType === MessageType.DIRECT_MESSAGE) {
      if (reassembled.recipientShortId !== this.transport.myShortId) return
      const sender = this.roster.getMember(reassembled.senderShortId)
      if (!sender) return
      const decoded = decodeChatPayload(reassembled.payload, sender.signPublicKey)
      if (!decoded.valid) return
      const key = await this.getOrCreateDirectKey(reassembled.senderShortId, sender.dhPublicKey)
      const plaintext = await decrypt(key, decoded.ciphertext)
      this.emit({ fromShortId: reassembled.senderShortId, nickname: sender.nickname, text: new TextDecoder().decode(plaintext), scope: 'direct' })
    }
  }

  private async maybeSendKeyPackageTo(joinerShortId: number, joinerDhPublicKey: Uint8Array): Promise<void> {
    if (!this.groupKey.hasRoomKey()) return
    const myShortId = this.transport.myShortId ?? 0
    const lowestOtherMember = this.roster
      .getAllMembers()
      .map((m) => m.shortId)
      .filter((id) => id !== joinerShortId)
      .concat(myShortId)
      .sort((a, b) => a - b)[0]
    if (lowestOtherMember !== myShortId) return

    const payload = await this.groupKey.buildKeyPackageFor(this.identity, joinerDhPublicKey)
    await this.sendFramed(MessageType.KEY_PACKAGE, joinerShortId, payload)
  }

  private emit(msg: IncomingChatMessage): void {
    this.messageCbs.forEach((cb) => cb(msg))
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/chat/chat-controller.test.ts
```

Expected: PASS, 2 tests passed.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
npm test
```

Expected: PASS, all tests across all files passed.

- [ ] **Step 6: Commit**

```bash
git add src/chat
git commit -m "feat: add chat controller wiring transport, crypto, roster, and group key manager"
```

---

### Task 10: Minimal Chat UI (wired to the mock hub)

**Files:**
- Create: `src/ui/app.ts`
- Modify: `src/main.ts`
- Modify: `index.html`

**Interfaces:**
- Consumes: `ChatController`, `IncomingChatMessage` from `../chat/chat-controller`; `MockHubTransport` from `../transport/mock-hub-transport`; `RosterManager` from `../room/roster-manager`; `GroupKeyManager` from `../room/group-key-manager`; `loadOrCreateIdentity`, `fingerprint` from `../identity/identity-manager`
- Produces: `mountApp(root: HTMLElement): Promise<void>` — renders the full chat UI (nickname prompt, room name field, member list with per-member safety-number fingerprint and a "Chat" button that opens a 1:1 thread, group room view, message input) into `root`.

This task has no automated tests — it's the manual, visually-verified integration point for everything built in Tasks 2-9. Verification is a manual multi-tab smoke test.

- [ ] **Step 1: Implement `src/ui/app.ts`**

```ts
import { ChatController, type IncomingChatMessage } from '../chat/chat-controller'
import { MockHubTransport } from '../transport/mock-hub-transport'
import { RosterManager } from '../room/roster-manager'
import { GroupKeyManager } from '../room/group-key-manager'
import { loadOrCreateIdentity, fingerprint } from '../identity/identity-manager'

export async function mountApp(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div id="setup">
      <label>Nickname <input id="nickname" placeholder="alice" /></label>
      <label>Room name <input id="room" placeholder="living-room" /></label>
      <button id="join">Join</button>
    </div>
    <div id="chat" hidden>
      <div id="my-fingerprint"></div>
      <div id="roster"></div>
      <div id="thread-label"></div>
      <div id="messages"></div>
      <form id="send-form">
        <input id="message-input" placeholder="Type a message…" autocomplete="off" />
        <button type="submit">Send</button>
      </form>
    </div>
  `

  const setupEl = root.querySelector<HTMLDivElement>('#setup')!
  const chatEl = root.querySelector<HTMLDivElement>('#chat')!
  const rosterEl = root.querySelector<HTMLDivElement>('#roster')!
  const threadLabelEl = root.querySelector<HTMLDivElement>('#thread-label')!
  const messagesEl = root.querySelector<HTMLDivElement>('#messages')!
  const myFingerprintEl = root.querySelector<HTMLDivElement>('#my-fingerprint')!
  const nicknameInput = root.querySelector<HTMLInputElement>('#nickname')!
  const roomInput = root.querySelector<HTMLInputElement>('#room')!
  const joinButton = root.querySelector<HTMLButtonElement>('#join')!
  const sendForm = root.querySelector<HTMLFormElement>('#send-form')!
  const messageInput = root.querySelector<HTMLInputElement>('#message-input')!

  let activeThreadShortId: number | null = null // null = group room
  let joinInProgress = false

  joinButton.addEventListener('click', async () => {
    // Guard against a second click starting a second controller/transport
    // before the first join's awaits resolve — without this, two independent
    // ChatController/RosterManager/setInterval sets would run concurrently.
    if (joinInProgress) return
    joinInProgress = true
    joinButton.disabled = true

    const nickname = nicknameInput.value.trim()
    const room = roomInput.value.trim()
    if (!nickname || !room) {
      joinInProgress = false
      joinButton.disabled = false
      return
    }

    const identity = await loadOrCreateIdentity(indexedDB, nickname)
    myFingerprintEl.textContent = `Your safety number: ${fingerprint(identity)}`
    const transport = new MockHubTransport(room)
    const roster = new RosterManager()
    const groupKey = new GroupKeyManager()
    const controller = new ChatController(transport, identity, roster, groupKey)

    controller.onMessage((msg: IncomingChatMessage) => {
      const shouldShow = msg.scope === 'group' ? activeThreadShortId === null : activeThreadShortId === msg.fromShortId
      if (shouldShow) appendMessage(`${msg.nickname}: ${msg.text}`)
    })

    await controller.start()

    setupEl.hidden = true
    chatEl.hidden = false
    renderThreadLabel()

    setInterval(() => {
      // Built with createElement/textContent, not innerHTML — nickname comes
      // from a peer's own PRESENCE broadcast (attacker-controlled) and must
      // never be parsed as markup.
      rosterEl.replaceChildren()

      for (const m of roster.getAllMembers()) {
        const span = document.createElement('span')

        const memberButton = document.createElement('button')
        memberButton.dataset.shortId = String(m.shortId)
        memberButton.textContent = `${m.nickname} (${fingerprint(m)}${m.verified ? ' ✓' : ''})`
        span.appendChild(memberButton)

        if (!m.verified) {
          span.appendChild(document.createTextNode(' '))
          const verifyButton = document.createElement('button')
          verifyButton.dataset.verifyId = String(m.shortId)
          verifyButton.textContent = 'Verify'
          span.appendChild(verifyButton)
        }

        rosterEl.appendChild(span)
        rosterEl.appendChild(document.createTextNode(' '))
      }

      const groupButton = document.createElement('button')
      groupButton.dataset.shortId = 'group'
      groupButton.textContent = 'Group room'
      rosterEl.appendChild(groupButton)
    }, 500)

    rosterEl.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const verifyId = target.dataset.verifyId
      if (verifyId) {
        roster.markVerified(Number(verifyId))
        return
      }
      const shortId = target.dataset.shortId
      if (!shortId) return
      activeThreadShortId = shortId === 'group' ? null : Number(shortId)
      renderThreadLabel()
      messagesEl.innerHTML = ''
    })

    sendForm.addEventListener('submit', async (event) => {
      event.preventDefault()
      const text = messageInput.value.trim()
      if (!text) return
      messageInput.value = ''
      if (activeThreadShortId === null) {
        await controller.sendGroupMessage(text)
        appendMessage(`me: ${text}`)
      } else {
        await controller.sendDirectMessage(activeThreadShortId, text)
        appendMessage(`me: ${text}`)
      }
    })
  })

  function renderThreadLabel() {
    threadLabelEl.textContent = activeThreadShortId === null ? 'Group room' : `Direct thread with #${activeThreadShortId}`
  }

  function appendMessage(text: string) {
    const line = document.createElement('div')
    line.textContent = text
    messagesEl.appendChild(line)
  }
}
```

- [ ] **Step 2: Wire it up in `src/main.ts`**

```ts
import { mountApp } from './ui/app'

const root = document.querySelector<HTMLDivElement>('#app')!
mountApp(root)
```

- [ ] **Step 3: Manual smoke test**

```bash
npm run dev
```

Open the printed local URL in two separate Chrome tabs. In both: enter the *same* room name and a *different* nickname each, click Join. Expected:
- Each tab's roster shows the other person within ~1 second.
- Typing in the group room in tab A shows up in tab B's message list and vice versa.
- Clicking the other person's name switches to a 1:1 thread; messages sent there do not appear in the group room view.
- Closing tab B removes them from tab A's roster shortly after.

- [ ] **Step 4: Commit**

```bash
git add src/ui src/main.ts
git commit -m "feat: add minimal chat UI wired to the mock hub transport"
```

---

### Task 11: Web Bluetooth Transport

**Files:**
- Create: `src/transport/ble-protocol.ts`
- Create: `src/transport/web-bluetooth-transport.ts`
- Test: `src/transport/web-bluetooth-transport.test.ts`

**Interfaces:**
- Consumes: `Transport` from `./transport`; global `navigator.bluetooth` (real in production, faked in tests)
- Produces:
  - `const HUB_SERVICE_UUID: string`, `const INBOX_CHARACTERISTIC_UUID: string`, `const OUTBOX_CHARACTERISTIC_UUID: string`, `const SYSTEM_FRAME_MEMBER_LIST = 0xf0`, `const SYSTEM_FRAME_MEMBER_JOINED = 0xf1`, `const SYSTEM_FRAME_MEMBER_LEFT = 0xf2` (these three sentinel byte values are a contract with the hub firmware plan — the hub must emit them as the first byte of any `outbox` notification that is a system frame, not an application frame)
  - `class WebBluetoothTransport implements Transport` — also exposes `onConnectionStateChange(cb: (state: 'connected' | 'reconnecting' | 'disconnected') => void): void`, used by the UI to show a "reconnecting…" indicator per the spec's error-handling section
  - `function isWebBluetoothSupported(): boolean`

- [ ] **Step 1: Write failing tests**

```ts
// src/transport/web-bluetooth-transport.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { WebBluetoothTransport, isWebBluetoothSupported, HUB_SERVICE_UUID, INBOX_CHARACTERISTIC_UUID, OUTBOX_CHARACTERISTIC_UUID } from './web-bluetooth-transport'

class FakeCharacteristic extends EventTarget {
  value: DataView | undefined
  writes: Uint8Array[] = []
  async writeValueWithoutResponse(data: Uint8Array) {
    this.writes.push(data)
  }
  async startNotifications() {
    return this
  }
  notify(bytes: Uint8Array) {
    this.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.dispatchEvent(new Event('characteristicvaluechanged'))
  }
}

class FakeService {
  inbox = new FakeCharacteristic()
  outbox = new FakeCharacteristic()
  async getCharacteristic(uuid: string) {
    if (uuid === INBOX_CHARACTERISTIC_UUID) return this.inbox
    if (uuid === OUTBOX_CHARACTERISTIC_UUID) return this.outbox
    throw new Error(`unexpected characteristic uuid ${uuid}`)
  }
}

class FakeServer {
  service = new FakeService()
  connected = false
  async connect() {
    this.connected = true
    return this
  }
  async getPrimaryService(uuid: string) {
    expect(uuid).toBe(HUB_SERVICE_UUID)
    return this.service
  }
  disconnect() {
    this.connected = false
  }
}

class FakeDevice extends EventTarget {
  gatt = new FakeServer()
  simulateUnexpectedDisconnect() {
    this.gatt.connected = false
    this.dispatchEvent(new Event('gattserverdisconnected'))
  }
}

function installFakeBluetooth() {
  const device = new FakeDevice()
  const fakeBluetooth = {
    requestDevice: async () => device
  }
  ;(globalThis as any).navigator = { bluetooth: fakeBluetooth }
  return device
}

beforeEach(() => {
  delete (globalThis as any).navigator
})

describe('isWebBluetoothSupported', () => {
  it('is false when navigator.bluetooth is absent', () => {
    expect(isWebBluetoothSupported()).toBe(false)
  })

  it('is true when navigator.bluetooth is present', () => {
    installFakeBluetooth()
    expect(isWebBluetoothSupported()).toBe(true)
  })
})

describe('WebBluetoothTransport', () => {
  it('connects, discovers the service, and subscribes to notifications', async () => {
    const device = installFakeBluetooth()
    const transport = new WebBluetoothTransport()
    await transport.connect()
    expect(device.gatt.service.outbox).toBeDefined()
  })

  it('writes sent bytes to the inbox characteristic', async () => {
    const device = installFakeBluetooth()
    const transport = new WebBluetoothTransport()
    await transport.connect()
    const bytes = new Uint8Array([1, 2, 3])
    await transport.send(bytes)
    expect(device.gatt.service.inbox.writes).toEqual([bytes])
  })

  it('routes an application frame notification to onFrame', async () => {
    const device = installFakeBluetooth()
    const transport = new WebBluetoothTransport()
    const received: Uint8Array[] = []
    transport.onFrame((bytes) => received.push(bytes))
    await transport.connect()

    const applicationFrame = new Uint8Array([2, 9, 255, 0, 0, 0, 1, 0, 1, 0, 5, 104, 101, 108, 108, 111])
    device.gatt.service.outbox.notify(applicationFrame)

    expect(received.length).toBe(1)
    expect(received[0]).toEqual(applicationFrame)
  })

  it('routes a member-joined system frame to onMemberJoined', async () => {
    const device = installFakeBluetooth()
    const transport = new WebBluetoothTransport()
    const joined: number[] = []
    transport.onMemberJoined((id) => joined.push(id))
    await transport.connect()

    device.gatt.service.outbox.notify(new Uint8Array([0xf1, 7]))

    expect(joined).toEqual([7])
  })

  it('routes a member-list system frame to onMemberList', async () => {
    const device = installFakeBluetooth()
    const transport = new WebBluetoothTransport()
    const lists: number[][] = []
    transport.onMemberList((ids) => lists.push(ids))
    await transport.connect()

    device.gatt.service.outbox.notify(new Uint8Array([0xf0, 3, 1, 2, 3]))

    expect(lists).toEqual([[1, 2, 3]])
  })

  it('reports connected, then reconnecting, then connected again after an unexpected disconnect', async () => {
    const device = installFakeBluetooth()
    const transport = new WebBluetoothTransport()
    const states: string[] = []
    transport.onConnectionStateChange((state) => states.push(state))
    await transport.connect()

    device.simulateUnexpectedDisconnect()
    await new Promise((r) => setTimeout(r, 20))

    expect(states).toEqual(['connected', 'reconnecting', 'connected'])
  })

  it('re-subscribes to notifications after reconnecting', async () => {
    const device = installFakeBluetooth()
    const transport = new WebBluetoothTransport()
    const received: Uint8Array[] = []
    transport.onFrame((bytes) => received.push(bytes))
    await transport.connect()

    device.simulateUnexpectedDisconnect()
    await new Promise((r) => setTimeout(r, 20))

    const frame = new Uint8Array([2, 9, 255, 0, 0, 0, 1, 0, 1, 0, 1, 42])
    device.gatt.service.outbox.notify(frame)

    expect(received).toEqual([frame])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/transport/web-bluetooth-transport.test.ts
```

Expected: FAIL — `web-bluetooth-transport.ts` does not exist yet.

- [ ] **Step 3: Implement `src/transport/ble-protocol.ts`**

```ts
export const HUB_SERVICE_UUID = '7b4a1000-8a2b-4c3d-9e8f-1123456789ab'
export const INBOX_CHARACTERISTIC_UUID = '7b4a1001-8a2b-4c3d-9e8f-1123456789ab'
export const OUTBOX_CHARACTERISTIC_UUID = '7b4a1002-8a2b-4c3d-9e8f-1123456789ab'

export const SYSTEM_FRAME_MEMBER_LIST = 0xf0
export const SYSTEM_FRAME_MEMBER_JOINED = 0xf1
export const SYSTEM_FRAME_MEMBER_LEFT = 0xf2
```

- [ ] **Step 4: Implement `src/transport/web-bluetooth-transport.ts`**

```ts
import type { Transport } from './transport'
import {
  HUB_SERVICE_UUID,
  INBOX_CHARACTERISTIC_UUID,
  OUTBOX_CHARACTERISTIC_UUID,
  SYSTEM_FRAME_MEMBER_LIST,
  SYSTEM_FRAME_MEMBER_JOINED,
  SYSTEM_FRAME_MEMBER_LEFT
} from './ble-protocol'

export { HUB_SERVICE_UUID, INBOX_CHARACTERISTIC_UUID, OUTBOX_CHARACTERISTIC_UUID }

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator
}

export class WebBluetoothTransport implements Transport {
  private device: any = null
  private inboxChar: any = null
  private outboxChar: any = null
  private _myShortId: number | null = null

  private frameCbs: Array<(bytes: Uint8Array) => void> = []
  private joinedCbs: Array<(shortId: number) => void> = []
  private leftCbs: Array<(shortId: number) => void> = []
  private listCbs: Array<(shortIds: number[]) => void> = []
  private connectionStateCbs: Array<(state: 'connected' | 'reconnecting' | 'disconnected') => void> = []

  get myShortId(): number | null {
    return this._myShortId
  }

  async connect(): Promise<void> {
    if (!isWebBluetoothSupported()) {
      throw new Error('Web Bluetooth is not supported in this browser')
    }
    this.device = await (navigator as any).bluetooth.requestDevice({
      filters: [{ services: [HUB_SERVICE_UUID] }]
    })
    this.device.addEventListener('gattserverdisconnected', this.handleUnexpectedDisconnect)
    await this.establishGattConnection()
    this.emitConnectionState('connected')
  }

  async disconnect(): Promise<void> {
    this.device?.removeEventListener('gattserverdisconnected', this.handleUnexpectedDisconnect)
    this.device?.gatt?.disconnect()
    this.device = null
    this.inboxChar = null
    this.outboxChar = null
  }

  async send(bytes: Uint8Array): Promise<void> {
    await this.inboxChar.writeValueWithoutResponse(bytes)
  }

  onFrame(cb: (bytes: Uint8Array) => void): void {
    this.frameCbs.push(cb)
  }

  onMemberJoined(cb: (shortId: number) => void): void {
    this.joinedCbs.push(cb)
  }

  onMemberLeft(cb: (shortId: number) => void): void {
    this.leftCbs.push(cb)
  }

  onMemberList(cb: (shortIds: number[]) => void): void {
    this.listCbs.push(cb)
  }

  onConnectionStateChange(cb: (state: 'connected' | 'reconnecting' | 'disconnected') => void): void {
    this.connectionStateCbs.push(cb)
  }

  private async establishGattConnection(): Promise<void> {
    const server = await this.device.gatt.connect()
    const service = await server.getPrimaryService(HUB_SERVICE_UUID)
    this.inboxChar = await service.getCharacteristic(INBOX_CHARACTERISTIC_UUID)
    this.outboxChar = await service.getCharacteristic(OUTBOX_CHARACTERISTIC_UUID)
    await this.outboxChar.startNotifications()
    this.outboxChar.addEventListener('characteristicvaluechanged', this.handleNotification)
  }

  private handleUnexpectedDisconnect = async (): Promise<void> => {
    this.emitConnectionState('reconnecting')
    const maxAttempts = 5
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.establishGattConnection()
        this.emitConnectionState('connected')
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
      }
    }
    this.emitConnectionState('disconnected')
  }

  private emitConnectionState(state: 'connected' | 'reconnecting' | 'disconnected'): void {
    this.connectionStateCbs.forEach((cb) => cb(state))
  }

  private handleNotification = (event: Event): void => {
    const characteristic = event.target as unknown as { value: DataView }
    const view = characteristic.value
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    const firstByte = bytes[0]

    if (firstByte === SYSTEM_FRAME_MEMBER_LIST) {
      const count = bytes[1]
      const ids = [...bytes.slice(2, 2 + count)]
      this.listCbs.forEach((cb) => cb(ids))
      return
    }
    if (firstByte === SYSTEM_FRAME_MEMBER_JOINED) {
      this.joinedCbs.forEach((cb) => cb(bytes[1]))
      return
    }
    if (firstByte === SYSTEM_FRAME_MEMBER_LEFT) {
      this.leftCbs.forEach((cb) => cb(bytes[1]))
      return
    }

    this.frameCbs.forEach((cb) => cb(bytes))
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/transport/web-bluetooth-transport.test.ts
```

Expected: PASS, 9 tests passed.

- [ ] **Step 6: Run the full test suite to confirm no regressions**

```bash
npm test
```

Expected: PASS, all tests across all files passed.

- [ ] **Step 7: Wire the real transport into the UI, with a mode switch and connection-state indicator**

Replace the full contents of `src/ui/app.ts` with:

```ts
import { ChatController, type IncomingChatMessage } from '../chat/chat-controller'
import type { Transport } from '../transport/transport'
import { MockHubTransport } from '../transport/mock-hub-transport'
import { WebBluetoothTransport, isWebBluetoothSupported } from '../transport/web-bluetooth-transport'
import { RosterManager } from '../room/roster-manager'
import { GroupKeyManager } from '../room/group-key-manager'
import { loadOrCreateIdentity, fingerprint } from '../identity/identity-manager'

export async function mountApp(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div id="setup">
      <label>Nickname <input id="nickname" placeholder="alice" /></label>
      <label>
        Connection
        <select id="mode">
          <option value="mock">Mock room (same-browser testing)</option>
          <option value="bluetooth">Bluetooth hub</option>
        </select>
      </label>
      <label id="room-label">Room name <input id="room" placeholder="living-room" /></label>
      <div id="setup-error" style="color: red"></div>
      <button id="join">Join</button>
    </div>
    <div id="chat" hidden>
      <div id="connection-status"></div>
      <div id="my-fingerprint"></div>
      <div id="roster"></div>
      <div id="thread-label"></div>
      <div id="messages"></div>
      <form id="send-form">
        <input id="message-input" placeholder="Type a message…" autocomplete="off" />
        <button type="submit">Send</button>
      </form>
    </div>
  `

  const setupEl = root.querySelector<HTMLDivElement>('#setup')!
  const chatEl = root.querySelector<HTMLDivElement>('#chat')!
  const rosterEl = root.querySelector<HTMLDivElement>('#roster')!
  const threadLabelEl = root.querySelector<HTMLDivElement>('#thread-label')!
  const messagesEl = root.querySelector<HTMLDivElement>('#messages')!
  const connectionStatusEl = root.querySelector<HTMLDivElement>('#connection-status')!
  const myFingerprintEl = root.querySelector<HTMLDivElement>('#my-fingerprint')!
  const nicknameInput = root.querySelector<HTMLInputElement>('#nickname')!
  const modeSelect = root.querySelector<HTMLSelectElement>('#mode')!
  const roomLabel = root.querySelector<HTMLLabelElement>('#room-label')!
  const roomInput = root.querySelector<HTMLInputElement>('#room')!
  const setupError = root.querySelector<HTMLDivElement>('#setup-error')!
  const joinButton = root.querySelector<HTMLButtonElement>('#join')!
  const sendForm = root.querySelector<HTMLFormElement>('#send-form')!
  const messageInput = root.querySelector<HTMLInputElement>('#message-input')!

  let activeThreadShortId: number | null = null // null = group room
  let joinInProgress = false

  modeSelect.addEventListener('change', () => {
    roomLabel.hidden = modeSelect.value === 'bluetooth'
  })

  joinButton.addEventListener('click', async () => {
    // Guard against a second click starting a second controller/transport
    // before the first join's awaits resolve.
    if (joinInProgress) return
    joinInProgress = true
    joinButton.disabled = true

    const nickname = nicknameInput.value.trim()
    if (!nickname) {
      joinInProgress = false
      joinButton.disabled = false
      return
    }
    setupError.textContent = ''

    let transport: Transport
    if (modeSelect.value === 'bluetooth') {
      if (!isWebBluetoothSupported()) {
        setupError.textContent = 'This browser does not support Web Bluetooth. Use Chrome or a Chromium-based browser.'
        joinInProgress = false
        joinButton.disabled = false
        return
      }
      const bleTransport = new WebBluetoothTransport()
      bleTransport.onConnectionStateChange((state) => {
        connectionStatusEl.textContent = state === 'connected' ? '' : `Bluetooth: ${state}…`
      })
      transport = bleTransport
    } else {
      const room = roomInput.value.trim()
      if (!room) {
        joinInProgress = false
        joinButton.disabled = false
        return
      }
      transport = new MockHubTransport(room)
    }

    const identity = await loadOrCreateIdentity(indexedDB, nickname)
    myFingerprintEl.textContent = `Your safety number: ${fingerprint(identity)}`
    const roster = new RosterManager()
    const groupKey = new GroupKeyManager()
    const controller = new ChatController(transport, identity, roster, groupKey)

    controller.onMessage((msg: IncomingChatMessage) => {
      const shouldShow = msg.scope === 'group' ? activeThreadShortId === null : activeThreadShortId === msg.fromShortId
      if (shouldShow) appendMessage(`${msg.nickname}: ${msg.text}`)
    })

    try {
      await controller.start()
    } catch (error) {
      setupError.textContent = error instanceof Error ? error.message : 'Failed to connect.'
      joinInProgress = false
      joinButton.disabled = false
      return
    }

    setupEl.hidden = true
    chatEl.hidden = false
    renderThreadLabel()

    setInterval(() => {
      // Built with createElement/textContent, not innerHTML — nickname comes
      // from a peer's own PRESENCE broadcast (attacker-controlled) and must
      // never be parsed as markup.
      rosterEl.replaceChildren()

      for (const m of roster.getAllMembers()) {
        const span = document.createElement('span')

        const memberButton = document.createElement('button')
        memberButton.dataset.shortId = String(m.shortId)
        memberButton.textContent = `${m.nickname} (${fingerprint(m)}${m.verified ? ' ✓' : ''})`
        span.appendChild(memberButton)

        if (!m.verified) {
          span.appendChild(document.createTextNode(' '))
          const verifyButton = document.createElement('button')
          verifyButton.dataset.verifyId = String(m.shortId)
          verifyButton.textContent = 'Verify'
          span.appendChild(verifyButton)
        }

        rosterEl.appendChild(span)
        rosterEl.appendChild(document.createTextNode(' '))
      }

      const groupButton = document.createElement('button')
      groupButton.dataset.shortId = 'group'
      groupButton.textContent = 'Group room'
      rosterEl.appendChild(groupButton)
    }, 500)

    rosterEl.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const verifyId = target.dataset.verifyId
      if (verifyId) {
        roster.markVerified(Number(verifyId))
        return
      }
      const shortId = target.dataset.shortId
      if (!shortId) return
      activeThreadShortId = shortId === 'group' ? null : Number(shortId)
      renderThreadLabel()
      messagesEl.innerHTML = ''
    })

    sendForm.addEventListener('submit', async (event) => {
      event.preventDefault()
      const text = messageInput.value.trim()
      if (!text) return
      messageInput.value = ''
      if (activeThreadShortId === null) {
        await controller.sendGroupMessage(text)
        appendMessage(`me: ${text}`)
      } else {
        await controller.sendDirectMessage(activeThreadShortId, text)
        appendMessage(`me: ${text}`)
      }
    })
  })

  function renderThreadLabel() {
    threadLabelEl.textContent = activeThreadShortId === null ? 'Group room' : `Direct thread with #${activeThreadShortId}`
  }

  function appendMessage(text: string) {
    const line = document.createElement('div')
    line.textContent = text
    messagesEl.appendChild(line)
  }
}
```

This supersedes the version written in Task 10 — same mock-room behavior when "Mock room" is selected (the default), plus a "Bluetooth hub" option that will work once hub firmware (the next plan) exists. Manually re-run the Task 10 smoke test to confirm the mock mode still behaves identically, then confirm the "Bluetooth hub" option shows the unsupported-browser message correctly if tested in a non-Chrome browser, or triggers `navigator.bluetooth.requestDevice()`'s device picker in Chrome (picking will not find a hub yet — that's expected until the firmware plan is done).

- [ ] **Step 8: Commit**

```bash
git add src/transport src/ui/app.ts
git commit -m "feat: add Web Bluetooth transport and wire a connection-mode switch into the UI"
```

**Note for the hub firmware plan:** `myShortId` assignment confirmation over real BLE is left as an open item above — the mock transport learns its own id locally, but a real hub must tell a newly-connected client what id it was assigned (e.g. a dedicated first system frame sent only to that new connection). Resolve this as part of the firmware plan's protocol definition, and update `web-bluetooth-transport.ts` to consume it then.

---

### Task 12: GitHub Pages deployment

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `npm run build` from Task 1 (produces `dist/`)
- Produces: a live GitHub Pages site on every push to `main`

- [ ] **Step 1: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: deploy the SPA to GitHub Pages on push to main"
```

- [ ] **Step 3: Push and enable Pages (manual, one-time)**

This step requires the user's own GitHub account/repo — it is not something to automate without confirmation:
1. Create a GitHub repo and add it as `origin`.
2. Push `main`.
3. In the repo's Settings → Pages, set Source to "GitHub Actions".
4. Confirm the workflow run succeeds and the site loads at the printed Pages URL.

---

## Handoff to the hub firmware plan

This plan produces a fully working (simulated) chat client. The next plan covers ESP32 hub firmware implementing:
- The same `HUB_SERVICE_UUID` / `INBOX_CHARACTERISTIC_UUID` / `OUTBOX_CHARACTERISTIC_UUID` GATT layout defined in `src/transport/ble-protocol.ts`.
- Relay behavior matching `MockHubTransport`'s semantics: assign a short id per connection, relay opaque `inbox` writes to the matching `outbox`(es) based on the recipient byte, and emit `member_list` / `member_joined` / `member_left` system frames using the sentinel byte values `0xf0`/`0xf1`/`0xf2` also defined in `ble-protocol.ts`.
- **Blocking, not optional:** resolving how a newly-connected client learns its own assigned short id over real BLE. `WebBluetoothTransport.myShortId` is currently always `null` — nothing in Task 11 sets it, by design, since only the hub can know it. Until this is resolved, `ChatController`'s `KEY_PACKAGE`/`DIRECT_MESSAGE` recipient-scoping checks (which compare a frame's `recipientShortId` against `transport.myShortId`) can never match on a real BLE connection, so **a real device can never receive its room key or any direct message** — the entire encrypted-chat feature is inert over real Bluetooth until this is fixed. This is not a minor follow-up; it is a hard prerequisite for the firmware plan's "done" criteria. A likely fix shape: the hub sends a dedicated system frame to a newly-connected client (only to that connection, not broadcast) confirming its assigned short id, and `WebBluetoothTransport` sets `_myShortId` upon receiving it.
- Defining what a client observes when the hub is already at its connection limit (spec's "room full" error case) — likely a `navigator.bluetooth.requestDevice()`/`gatt.connect()` rejection, but the exact error shape depends on how the firmware plan chooses to reject the (n+1)th BLE connection. `WebBluetoothTransport.connect()` already propagates any such rejection as a thrown error; the firmware plan should confirm the UI's generic error display is sufficient or specify a more precise "room full" message.
