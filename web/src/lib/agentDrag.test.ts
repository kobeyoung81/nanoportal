import { describe, expect, it } from 'vitest'
import { groupPlacement, moveGroupOrder } from './agentDrag'
import type { AgentGroup } from './agentGroups'

function group(id: string, position: number): AgentGroup {
  return { id, name: id.toUpperCase(), position, agents: [] }
}

const groups = [group('a', 0), group('b', 1), group('c', 2)]

describe('groupPlacement', () => {
  it('splits a header at its midpoint', () => {
    expect(groupPlacement(9, 0, 20)).toBe('before')
    expect(groupPlacement(11, 0, 20)).toBe('after')
  })
})

describe('moveGroupOrder', () => {
  it('moves a group before another', () => {
    expect(moveGroupOrder(groups, 'c', 'a', 'before')?.map((item) => item.id)).toEqual(['c', 'a', 'b'])
  })

  it('moves a group after another', () => {
    expect(moveGroupOrder(groups, 'a', 'c', 'after')?.map((item) => item.id)).toEqual(['b', 'c', 'a'])
  })

  it('renumbers positions after the move', () => {
    expect(moveGroupOrder(groups, 'c', 'a', 'before')?.map((item) => item.position)).toEqual([0, 1, 2])
  })

  it('returns null for a no-op move', () => {
    expect(moveGroupOrder(groups, 'a', 'a', 'before')).toBeNull()
    // Dropping b right before c leaves the order as it was.
    expect(moveGroupOrder(groups, 'b', 'c', 'before')).toBeNull()
    // Dropping b right after a also leaves it as it was.
    expect(moveGroupOrder(groups, 'b', 'a', 'after')).toBeNull()
  })

  it('returns null for unknown ids', () => {
    expect(moveGroupOrder(groups, 'nope', 'a', 'before')).toBeNull()
    expect(moveGroupOrder(groups, 'a', 'nope', 'before')).toBeNull()
  })

  it('does not mutate the input', () => {
    const before = groups.map((item) => item.id)
    moveGroupOrder(groups, 'c', 'a', 'before')
    expect(groups.map((item) => item.id)).toEqual(before)
  })
})
