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
