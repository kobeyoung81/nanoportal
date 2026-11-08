// The sidebar's list snapshot. Its schema number is the only thing that stands
// between a snapshot written by an older app version and a bucket that is missing
// whatever field that version predates — reading a missing array is not an empty
// list but a permanent error, so the rejection path is pinned here.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  LISTS_CACHE_SCHEMA,
  mayUseSnapshot,
  purgeListCache,
  readListCache,
  writeListCache,
} from './listCache'
import { setCurrentUser } from './clientState'
import { EMPTY_ENTRY } from '../conversations/sessionLists'

const KEY = 'nanosec.portal.u.u1.agent.lists.v1'
const NOW = 1_700_000_000_000

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  clear(): void {
    this.store.clear()
  }
}

let storage: MemoryStorage

beforeEach(() => {
  storage = new MemoryStorage()
  ;(globalThis as { localStorage?: unknown }).localStorage = storage
  // The snapshot key is namespaced by the signed-in account.
  setCurrentUser('u1')
})

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
  setCurrentUser(null)
})

function snapshot(schema: number, over: Record<string, unknown> = {}) {
  return { schema, userId: 'u1', savedAt: NOW, agents: [], groups: [], ungrouped: [], lists: { a: EMPTY_ENTRY }, ...over }
}

describe('mayUseSnapshot', () => {
  it('accepts a snapshot of the current schema for the same user', () => {
    expect(mayUseSnapshot(snapshot(LISTS_CACHE_SCHEMA), { userId: 'u1', now: NOW })).not.toBeNull()
  })

  it('rejects a snapshot without the groups field', () => {
    // Schema 3 added the groups slice; a snapshot from schema 2 has none, and
    // defaulting would paint every agent as ungrouped before moving them.
    const raw: Record<string, unknown> = snapshot(LISTS_CACHE_SCHEMA)
    delete raw.groups
    expect(mayUseSnapshot(raw, { userId: 'u1', now: NOW })).toBeNull()
    const withoutUngrouped: Record<string, unknown> = snapshot(LISTS_CACHE_SCHEMA)
    delete withoutUngrouped.ungrouped
    expect(mayUseSnapshot(withoutUngrouped, { userId: 'u1', now: NOW })).toBeNull()
  })

  it('rejects a snapshot written before the current bucket shape', () => {
    // The bug this guards: schema 1 buckets have no `segments`, and a missing
    // field made the session list fail permanently instead of refetching.
    expect(mayUseSnapshot(snapshot(1), { userId: 'u1', now: NOW })).toBeNull()
  })

  it('rejects another user, an expired snapshot and a malformed one', () => {
    expect(mayUseSnapshot(snapshot(LISTS_CACHE_SCHEMA), { userId: 'u2', now: NOW })).toBeNull()
    const day = 24 * 60 * 60 * 1000
    expect(mayUseSnapshot(snapshot(LISTS_CACHE_SCHEMA), { userId: 'u1', now: NOW + day + 1 })).toBeNull()
    expect(mayUseSnapshot(snapshot(LISTS_CACHE_SCHEMA, { lists: null }), { userId: 'u1', now: NOW })).toBeNull()
    expect(mayUseSnapshot(null, { userId: 'u1', now: NOW })).toBeNull()
  })
})

describe('read/write plumbing', () => {
  it('round-trips the bucket group', () => {
    writeListCache('u1', [], [], [], { a: EMPTY_ENTRY }, NOW)
    const restored = readListCache('u1', NOW)
    expect(restored?.agents).toEqual([])
    expect(Object.keys(restored?.lists ?? {})).toEqual(['a'])
  })

  it('ignores a stored snapshot of an older schema', () => {
    storage.setItem(KEY, JSON.stringify(snapshot(1)))
    expect(readListCache('u1', NOW)).toBeNull()
  })

  it('purges the snapshot', () => {
    writeListCache('u1', [], [], [], { a: EMPTY_ENTRY }, NOW)
    purgeListCache()
    expect(readListCache('u1', NOW)).toBeNull()
  })
})
