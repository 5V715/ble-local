import { sign, verify } from '../crypto/crypto-engine'

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
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
