// The sidebar's bucket rules. They are pure so the ordering, the ungrouped
// fallback and the dangling-group case can be pinned without a browser.

import { describe, expect, it } from 'vitest'
import { bucketAgents, isRealGroup, UNGROUPED_ID } from './agentGrouping'
import type { Agent } from './agentApi'
import type { AgentGroup } from './agentGroups'

function agent(id: string, groupID?: string): Agent {
  return {
    id,
    user_id: 'u1',
    display_name: id,
    description: '',
    model: '',
    status: 'running',
    tools: [],
    workspaces: [],
    created_at: '',
    group_id: groupID,
  }
}

function group(id: string, name: string, position: number, agents: string[] = []): AgentGroup {
  return { id, name, position, agents }
}

describe('bucketAgents', () => {
  it('orders groups by position, not by array order', () => {
    const buckets = bucketAgents([], [group('b', 'B', 1), group('a', 'A', 0)])
    expect(buckets.map((bucket) => bucket.id)).toEqual(['a', 'b'])
  })

  it('orders agents by the saved order', () => {
    const buckets = bucketAgents(
      [agent('a1', 'g1'), agent('a2', 'g1')],
      [group('g1', 'Work', 0, ['a2', 'a1'])],
    )
    expect(buckets[0].agents.map((item) => item.id)).toEqual(['a2', 'a1'])
  })

  it('appends agents that are missing from the saved order', () => {
    const buckets = bucketAgents(
      [agent('a1', 'g1'), agent('a2', 'g1'), agent('a3', 'g1')],
      [group('g1', 'Work', 0, ['a2'])],
    )
    expect(buckets[0].agents.map((item) => item.id)).toEqual(['a2', 'a1', 'a3'])
  })

  it('ignores saved ids that no longer belong to the group', () => {
    const buckets = bucketAgents(
      [agent('a1'), agent('a2', 'g1')],
      [group('g1', 'Work', 0, ['a1', 'a2'])],
    )
    expect(buckets[0].agents.map((item) => item.id)).toEqual(['a2'])
    expect(buckets[1].agents.map((item) => item.id)).toEqual(['a1'])
  })

  it('puts ungrouped agents in a trailing bucket, in saved order', () => {
    const buckets = bucketAgents(
      [agent('u1'), agent('u2'), agent('a1', 'g1')],
      [group('g1', 'Work', 0)],
      ['u2', 'u1'],
    )
    expect(buckets.map((bucket) => bucket.id)).toEqual(['g1', UNGROUPED_ID])
    expect(buckets[1].agents.map((item) => item.id)).toEqual(['u2', 'u1'])
  })

  it('moves an agent whose group no longer exists to ungrouped', () => {
    const buckets = bucketAgents([agent('a1', 'deleted-group')], [group('g1', 'Work', 0)])
    expect(buckets).toHaveLength(2)
    expect(buckets[1].id).toBe(UNGROUPED_ID)
    expect(buckets[1].agents.map((item) => item.id)).toEqual(['a1'])
  })

  it('keeps an empty group so it can be dragged into', () => {
    const buckets = bucketAgents([], [group('g1', 'Work', 0)])
    expect(buckets).toHaveLength(1)
    expect(buckets[0].agents).toEqual([])
  })

  it('does not emit the ungrouped bucket when it would be empty', () => {
    const buckets = bucketAgents([agent('a1', 'g1')], [group('g1', 'Work', 0)])
    expect(buckets.map((bucket) => bucket.id)).toEqual(['g1'])
  })

  it('treats the ungrouped bucket as the only non-real group', () => {
    const buckets = bucketAgents([agent('a1')], [])
    expect(buckets).toHaveLength(1)
    expect(isRealGroup(buckets[0])).toBe(false)
    expect(isRealGroup({ id: 'g1', name: 'Work', agents: [] })).toBe(true)
  })
})
