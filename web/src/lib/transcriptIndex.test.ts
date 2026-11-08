import { describe, expect, it } from 'vitest'
import {
  BASE_FIRST_ITEM_INDEX,
  countPrepended,
  indexOfKey,
  keyAtIndex,
  nextFirstItemIndex,
  sameKeys,
} from './transcriptIndex'

describe('countPrepended', () => {
  it('counts the leading keys the previous list did not have', () => {
    expect(countPrepended(['b', 'c'], ['a1', 'a2', 'b', 'c'])).toBe(2)
  })

  it('is zero when the list only grew at the end', () => {
    expect(countPrepended(['b', 'c'], ['b', 'c', 'd'])).toBe(0)
  })

  it('treats a first list as a baseline, not a prepend of everything', () => {
    expect(countPrepended([], ['b', 'c'])).toBe(0)
  })

  it('is zero when the streaming tail replaced its last row', () => {
    expect(countPrepended(['a', 'b'], ['a', 'b2'])).toBe(0)
  })
})

describe('nextFirstItemIndex', () => {
  it('moves the first index down by the number of prepended rows', () => {
    expect(nextFirstItemIndex(BASE_FIRST_ITEM_INDEX, ['b', 'c'], ['a1', 'a2', 'a3', 'b', 'c'])).toBe(
      BASE_FIRST_ITEM_INDEX - 3,
    )
  })

  it('leaves the index alone for an append', () => {
    expect(nextFirstItemIndex(50, ['b'], ['b', 'c', 'd'])).toBe(50)
  })
})

describe('indexOfKey / keyAtIndex', () => {
  const keys = ['b', 'c', 'd']

  it('round-trips a key through its index', () => {
    const index = indexOfKey(100, keys, 'c')
    expect(index).toBe(101)
    expect(keyAtIndex(100, keys, index as number)).toBe('c')
  })

  it('reports a row that is gone rather than guessing an index', () => {
    expect(indexOfKey(100, keys, 'zz')).toBeNull()
  })

  it('reports an index outside the list', () => {
    expect(keyAtIndex(100, keys, 99)).toBeNull()
    expect(keyAtIndex(100, keys, 103)).toBeNull()
  })
})

describe('sameKeys', () => {
  it('compares content, not identity', () => {
    expect(sameKeys(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameKeys(['a', 'b'], ['a', 'b', 'c'])).toBe(false)
    expect(sameKeys(['a', 'b'], ['b', 'a'])).toBe(false)
  })
})
