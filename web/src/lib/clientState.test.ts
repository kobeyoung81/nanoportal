// The per-user namespace and the adoption of pre-namespace keys. The bug this
// guards is the reason the namespace exists: user state used to sit under global
// keys, so two accounts on one browser saw each other's tabs and layout.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  adoptLegacyState,
  clearState,
  clearUserState,
  currentUser,
  readRawState,
  readState,
  setCurrentUser,
  stateKey,
  userStateKeys,
  writeRawState,
  writeState,
  writeStateMerged,
} from './clientState'

class MemoryStorage {
  private store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null
  }

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
  setCurrentUser(null)
})

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
  setCurrentUser(null)
})

const parseJson = (raw: unknown) => (raw && typeof raw === 'object' ? (raw as { v: number }) : null)

describe('key building', () => {
  it('namespaces every slice by the signed-in account', () => {
    setCurrentUser('u1')
    expect(stateKey('layout')).toBe('nanosec.portal.u.u1.agent.layout.v1')
    expect(stateKey('layout', 'leftVert')).toBe('nanosec.portal.u.u1.agent.leftVert')
    expect(stateKey('session', 'a1')).toBe('nanosec.portal.u.u1.agent.session.a1')
    expect(stateKey('gitBrowser', 'tab')).toBe('nanosec.portal.u.u1.gitBrowser.tab')
    expect(stateKey('mobile', 'tabs')).toBe('nanosec.portal.u.u1.mobile.tabs')
    expect(stateKey('voiceShortcut')).toBe('nanosec.portal.u.u1.agent.voiceShortcut')
  })

  it('has no key, and reads nothing, while nobody is signed in', () => {
    expect(stateKey('layout')).toBeNull()
    expect(currentUser()).toBeNull()
    writeRawState('session', 'a1', 'x')
    writeState('tabs', undefined, { v: 1 })
    expect(storage.length).toBe(0)
    expect(readRawState('session', 'a1')).toBeNull()
    expect(readState('tabs', undefined, parseJson, { v: 0 })).toEqual({ v: 0 })
  })
})

describe('read/write plumbing', () => {
  it('round-trips a raw slice and a JSON slice', () => {
    setCurrentUser('u1')
    writeRawState('fileBrowser', 'tab', 'files')
    writeState('tabs', undefined, { v: 1 })
    expect(readRawState('fileBrowser', 'tab')).toBe('files')
    expect(readState('tabs', undefined, parseJson, { v: 0 })).toEqual({ v: 1 })
  })

  it('falls back on malformed JSON instead of throwing', () => {
    setCurrentUser('u1')
    storage.setItem('nanosec.portal.u.u1.agent.tabs.v1', '{not json')
    expect(readState('tabs', undefined, parseJson, { v: 0 })).toEqual({ v: 0 })
  })

  it('survives a storage that refuses writes', () => {
    setCurrentUser('u1')
    storage.setItem = () => {
      throw new Error('quota')
    }
    expect(() => writeState('tabs', undefined, { v: 1 })).not.toThrow()
    expect(() => writeRawState('session', 'a1', 's1')).not.toThrow()
  })

  it('merges on write and returns what was stored', () => {
    setCurrentUser('u1')
    writeState('tabs', undefined, { v: 1 })
    const stored = writeStateMerged(
      'tabs',
      undefined,
      { v: 2 },
      { v: 1 },
      (fresh, next) => ({ v: (fresh?.v ?? 0) + next.v }),
      parseJson,
    )
    expect(stored).toEqual({ v: 3 })
    expect(readState('tabs', undefined, parseJson, { v: 0 })).toEqual({ v: 3 })
  })

  it('clears one slice, or one whole account', () => {
    setCurrentUser('u1')
    writeRawState('session', 'a1', 's1')
    writeRawState('fileBrowser', 'tab', 'files')
    clearState('session', 'a1')
    expect(readRawState('session', 'a1')).toBeNull()
    expect(readRawState('fileBrowser', 'tab')).toBe('files')

    setCurrentUser('u2')
    writeRawState('fileBrowser', 'tab', 'chat')
    clearUserState('u1')
    expect(userStateKeys('u1')).toEqual([])
    expect(userStateKeys('u2')).toEqual(['nanosec.portal.u.u2.fileBrowser.tab'])
  })
})

describe('adoptLegacyState', () => {
  function seedLegacy(): void {
    storage.setItem('nanosec.portal.agent.layout.v1', JSON.stringify({ v: 1 }))
    storage.setItem('nanosec.portal.agent.leftVert', '[[30,70]]')
    storage.setItem('nanosec.portal.agent.conversations.v1', JSON.stringify({ v: 1, tabs: [] }))
    storage.setItem('nanosec.portal.agent.lists.v1', JSON.stringify({ schema: 2 }))
    storage.setItem('nanosec.portal.agent.session.a1', 'web:c1:v2')
    storage.setItem('nanosec.portal.contextUsage.a1', JSON.stringify({ used: 1 }))
    storage.setItem('nanosec.portal.gitBrowser.tab', 'git')
    storage.setItem('nanosec.portal.agent.filesVisible', 'true')
  }

  it('moves the pre-namespace keys into the account and removes them', () => {
    seedLegacy()
    const moved = adoptLegacyState('u9')
    // Seven keys carry state (the right-dock seed is only deleted: the layout
    // carries it now). The per-agent build/plan pick used to be one of them; it
    // lives in the conversation's own session now, so there is nothing to adopt.
    // The composer's old account-level thinking mirror is gone with it.
    expect(moved.length).toBe(7)
    expect(storage.getItem('nanosec.portal.agent.layout.v1')).toBeNull()
    expect(storage.getItem('nanosec.portal.agent.filesVisible')).toBeNull()
    expect(storage.getItem('nanosec.portal.u.u9.agent.layout.v1')).toBe(JSON.stringify({ v: 1 }))
    expect(storage.getItem('nanosec.portal.u.u9.agent.leftVert')).toBe('[[30,70]]')
    expect(storage.getItem('nanosec.portal.u.u9.agent.session.a1')).toBe('web:c1:v2')
    expect(storage.getItem('nanosec.portal.u.u9.gitBrowser.tab')).toBe('git')
  })

  it('is idempotent and never overwrites state the account already has', () => {
    seedLegacy()
    storage.setItem('nanosec.portal.u.u9.agent.lists.v1', JSON.stringify({ schema: 3 }))
    adoptLegacyState('u9')
    expect(storage.getItem('nanosec.portal.u.u9.agent.lists.v1')).toBe(JSON.stringify({ schema: 3 }))
    // A second account finds nothing left to adopt.
    expect(adoptLegacyState('u2')).toEqual([])
    expect(userStateKeys('u2')).toEqual([])
  })

  it('leaves namespaced keys of other accounts alone', () => {
    storage.setItem('nanosec.portal.u.u1.agent.layout.v1', JSON.stringify({ v: 1 }))
    adoptLegacyState('u9')
    expect(storage.getItem('nanosec.portal.u.u1.agent.layout.v1')).not.toBeNull()
  })
})
