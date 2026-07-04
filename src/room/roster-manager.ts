export interface Member {
  shortId: number
  nickname: string
  signPublicKey: Uint8Array
  dhPublicKey: Uint8Array
  verified: boolean
}

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

  markVerified(shortId: number): void {
    const member = this.members.get(shortId)
    if (member) member.verified = true
  }

  isEmpty(): boolean {
    return this.connectedIds.size === 0
  }
}
