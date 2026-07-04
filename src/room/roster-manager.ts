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
