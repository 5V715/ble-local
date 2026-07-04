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

    const sharedSecret = deriveSharedSecret(myIdentity.dhPrivateKey, senderDhPublicKey)
    const wrappingKey = await deriveAesKey(sharedSecret)
    const raw = await decrypt(wrappingKey, decoded.wrappedRoomKey)

    this.pendingRawKey = raw
    this.roomKey = await importRoomKey(raw)
    this.epoch = decoded.epoch
    return true
  }
}
