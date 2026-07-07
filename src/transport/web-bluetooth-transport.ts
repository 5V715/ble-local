import type { Transport } from './transport'
import {
  HUB_SERVICE_UUID,
  INBOX_CHARACTERISTIC_UUID,
  OUTBOX_CHARACTERISTIC_UUID,
  SYSTEM_FRAME_MEMBER_LIST,
  SYSTEM_FRAME_MEMBER_JOINED,
  SYSTEM_FRAME_MEMBER_LEFT,
  SYSTEM_FRAME_YOUR_ID
} from './ble-protocol'

export { HUB_SERVICE_UUID, INBOX_CHARACTERISTIC_UUID, OUTBOX_CHARACTERISTIC_UUID }

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator
}

const ONBOARDING_TIMEOUT_MS = 10_000

export class WebBluetoothTransport implements Transport {
  private device: any = null
  private inboxChar: any = null
  private outboxChar: any = null
  private _myShortId: number | null = null
  private onboardingResolvers: { yourId: () => void; memberList: () => void } | null = null

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

    // The hub sends its onboarding frames (your-id, then member-list) as
    // notifications right after the CCCD subscribe write completes, but
    // those are separate async BLE packets — they are not guaranteed to
    // have arrived by the time startNotifications() resolves. Callers
    // (ChatController) decide whether to mint a fresh room key based on
    // roster state and read myShortId immediately after connect() —
    // both need onboarding to have actually landed first, so connect()
    // must not resolve until it has. The listener is attached before
    // subscribing (not after) so a notification that arrives the instant
    // the subscribe write completes can never be dropped for lack of a
    // listener.
    this.outboxChar.addEventListener('characteristicvaluechanged', this.handleNotification)
    const onboarded = this.waitForOnboarding()
    await this.outboxChar.startNotifications()
    await onboarded
  }

  private waitForOnboarding(): Promise<void> {
    let resolveYourId!: () => void
    let resolveMemberList!: () => void
    const yourId = new Promise<void>((resolve) => (resolveYourId = resolve))
    const memberList = new Promise<void>((resolve) => (resolveMemberList = resolve))
    this.onboardingResolvers = { yourId: resolveYourId, memberList: resolveMemberList }

    const onboarded = Promise.all([yourId, memberList]).then(() => undefined)
    const timeout = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('WebBluetoothTransport: timed out waiting for hub onboarding frames')), ONBOARDING_TIMEOUT_MS)
    })
    return Promise.race([onboarded, timeout])
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

    if (firstByte === SYSTEM_FRAME_YOUR_ID) {
      this._myShortId = bytes[1]
      this.onboardingResolvers?.yourId()
      return
    }
    if (firstByte === SYSTEM_FRAME_MEMBER_LIST) {
      const count = bytes[1]
      const ids = [...bytes.slice(2, 2 + count)]
      this.listCbs.forEach((cb) => cb(ids))
      this.onboardingResolvers?.memberList()
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
