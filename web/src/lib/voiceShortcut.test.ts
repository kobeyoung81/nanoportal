// The tri-state of the user's dictation shortcut: nothing stored (the platform
// value applies), an explicitly empty value (no shortcut), or the user's own
// key. Collapsing the first two is what would make "turn it off" lose to the
// platform default, so both are pinned here — along with the notification the
// composer relies on, since it stays mounted while the preferences tab writes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentUser } from './clientState'
import {
  clearShortcutOverride,
  getShortcutOverride,
  parseShortcutOverride,
  subscribeShortcutOverride,
  writeShortcutOverride,
} from './voiceShortcut'

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

beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
  setCurrentUser('u1')
})

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
  setCurrentUser(null)
})

describe('parseShortcutOverride', () => {
  it('canonicalises a usable value', () => {
    expect(parseShortcutOverride(' ctrl+shift+m ')).toBe('Ctrl+Shift+M')
  })

  it('reads an explicitly empty value as "off"', () => {
    expect(parseShortcutOverride('')).toBe('')
    expect(parseShortcutOverride('   ')).toBe('')
  })

  it('reads anything else as "nothing stored"', () => {
    expect(parseShortcutOverride('garbage')).toBeNull()
    expect(parseShortcutOverride('m')).toBeNull()
    expect(parseShortcutOverride('shift+m')).toBeNull()
    expect(parseShortcutOverride(null)).toBeNull()
    expect(parseShortcutOverride(42)).toBeNull()
    expect(parseShortcutOverride({ shortcut: 'Alt+M' })).toBeNull()
  })
})

describe('the store', () => {
  it('starts unset, so the platform value applies', () => {
    expect(getShortcutOverride()).toBeNull()
  })

  it('keeps the user key, normalised', () => {
    writeShortcutOverride('alt + m')
    expect(getShortcutOverride()).toBe('Alt+M')
  })

  it('keeps an explicit turn-off distinct from "unset"', () => {
    writeShortcutOverride('')
    expect(getShortcutOverride()).toBe('')
    expect(getShortcutOverride()).not.toBeNull()
  })

  it('goes back to unset when the override is cleared', () => {
    writeShortcutOverride('Alt+M')
    clearShortcutOverride()
    expect(getShortcutOverride()).toBeNull()
  })

  it('notifies subscribers on a write and on a clear', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeShortcutOverride(listener)
    writeShortcutOverride('Ctrl+Shift+M')
    expect(listener).toHaveBeenCalledTimes(1)
    clearShortcutOverride()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    writeShortcutOverride('Alt+K')
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
