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
