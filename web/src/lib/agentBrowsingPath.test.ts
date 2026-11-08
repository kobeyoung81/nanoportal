// Browsing paths are remembered per agent so switching agents never carries one
// agent's directory into a container that may not have it. The two browsers
// keep separate maps (the file panel's paths are relative to the agent home,
// the git browser's to the data root), and the shared fallback rule decides
// which path survives when a remembered directory cannot be read.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setCurrentUser } from './clientState'
import { fallbackTarget, readAgentPath, setAgentPath, writeAgentPath } from './agentBrowsingPath'

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
  setCurrentUser('u1')
})

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
  setCurrentUser(null)
})

describe('setAgentPath', () => {
  it('adds one agent without touching the others, and copies', () => {
    const before = { a1: 'work' }
    const after = setAgentPath(before, 'a2', 'sharedspace/proj')
    expect(after).toEqual({ a1: 'work', a2: 'sharedspace/proj' })
    expect(before).toEqual({ a1: 'work' })
  })

  it('stores the empty path as a real entry', () => {
    // "" means the data root in the git browser, so it is worth remembering:
    // forgetting it would send a user who chose the data root back to the
    // default root on the next switch.
    expect(setAgentPath({ a1: 'work' }, 'a1', '')).toEqual({ a1: '' })
  })
})

describe('readAgentPath / writeAgentPath', () => {
  it('round-trips a path per agent and per area', () => {
    writeAgentPath('gitBrowser', 'a1', 'agents/Alice')
    writeAgentPath('fileBrowser', 'a1', 'agent/memory')
    expect(readAgentPath('gitBrowser', 'a1')).toBe('agents/Alice')
    expect(readAgentPath('fileBrowser', 'a1')).toBe('agent/memory')
    // The two areas are separate keys, not one shared map.
    expect(storage.getItem('nanosec.portal.u.u1.gitBrowser.pathByAgent')).toBe(
      JSON.stringify({ a1: 'agents/Alice' }),
    )
    expect(storage.getItem('nanosec.portal.u.u1.fileBrowser.pathByAgent')).toBe(
      JSON.stringify({ a1: 'agent/memory' }),
    )
  })

  it('tells "nothing remembered" apart from "remembered the root"', () => {
    expect(readAgentPath('gitBrowser', 'a1')).toBeNull()
    writeAgentPath('gitBrowser', 'a1', '')
    expect(readAgentPath('gitBrowser', 'a1')).toBe('')
  })

  it('answers null for an unknown agent, no agent, or nobody signed in', () => {
    expect(readAgentPath('fileBrowser', 'nope')).toBeNull()
    expect(readAgentPath('fileBrowser', null)).toBeNull()
    setCurrentUser(null)
    writeAgentPath('fileBrowser', 'a1', 'agent')
    expect(readAgentPath('fileBrowser', 'a1')).toBeNull()
    expect(storage.length).toBe(0)
  })

  it('ignores a malformed stored map', () => {
    storage.setItem('nanosec.portal.u.u1.fileBrowser.pathByAgent', '{not json')
    expect(readAgentPath('fileBrowser', 'a1')).toBeNull()
    writeAgentPath('fileBrowser', 'a1', 'agent')
    expect(readAgentPath('fileBrowser', 'a1')).toBe('agent')
  })
})

describe('fallbackTarget', () => {
  it('uses the default root when nothing is remembered', () => {
    expect(fallbackTarget(null, true)).toBe('default')
    expect(fallbackTarget(null, false)).toBe('default')
  })

  it('falls back once the default root answers', () => {
    expect(fallbackTarget('work/old', true)).toBe('default')
  })

  it('keeps the remembered path while the default root cannot be read', () => {
    // A restarting container or a failing tunnel must not move the user.
    expect(fallbackTarget('work/old', false)).toBe('remembered')
  })

  it('keeps an explicitly remembered root when nothing answers', () => {
    expect(fallbackTarget('', false)).toBe('remembered')
    expect(fallbackTarget('', true)).toBe('default')
  })
})
