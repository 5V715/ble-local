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

// Real firmware sends your-id then member-list as notifications right after
// the CCCD subscribe write completes (OutboxCallbacks::onSubscribe) — as
// separate, asynchronous BLE packets, never synchronously with
// startNotifications() resolving. Auto-sending them here (instead of
// leaving onboarding to be triggered manually by each test) exercises the
// same connect()-waits-for-onboarding contract WebBluetoothTransport
// actually relies on against real hardware.
class FakeOutboxCharacteristic extends FakeCharacteristic {
  autoOnboard = true
  yourId = 1
  memberIds: number[] = []

  async startNotifications() {
    if (this.autoOnboard) {
      queueMicrotask(() => {
        this.notify(new Uint8Array([0xf3, this.yourId]))
        this.notify(new Uint8Array([0xf0, this.memberIds.length, ...this.memberIds]))
      })
    }
    return this
  }
}

class FakeService {
  inbox = new FakeCharacteristic()
  outbox = new FakeOutboxCharacteristic()
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

  it('routes the member-list system frame sent during onboarding to onMemberList', async () => {
    const device = installFakeBluetooth()
    device.gatt.service.outbox.memberIds = [1, 2, 3]
    const transport = new WebBluetoothTransport()
    const lists: number[][] = []
    transport.onMemberList((ids) => lists.push(ids))

    await transport.connect()

    expect(lists).toEqual([[1, 2, 3]])
  })

  it('sets myShortId from the your-id system frame sent during onboarding', async () => {
    const device = installFakeBluetooth()
    device.gatt.service.outbox.yourId = 4
    const transport = new WebBluetoothTransport()

    await transport.connect()

    expect(transport.myShortId).toBe(4)
  })

  it('does not resolve connect() until both onboarding frames (your-id and member-list) arrive', async () => {
    const device = installFakeBluetooth()
    device.gatt.service.outbox.autoOnboard = false
    const transport = new WebBluetoothTransport()

    let resolved = false
    const connecting = transport.connect().then(() => {
      resolved = true
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(resolved).toBe(false)

    device.gatt.service.outbox.notify(new Uint8Array([0xf3, 1]))
    await new Promise((r) => setTimeout(r, 10))
    expect(resolved).toBe(false)

    device.gatt.service.outbox.notify(new Uint8Array([0xf0, 0]))
    await connecting

    expect(resolved).toBe(true)
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
