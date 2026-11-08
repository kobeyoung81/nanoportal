// Tab matching rules. These are the behaviour behind "one conversation, one
// tab": a tab that is open on a conversation must be reused when the sidebar
// row (or another entry point) asks for the same conversation, whatever segment
// it is parked on, and a fresh conversation must not be folded into a tab that
// is already running something.
//
// The last block covers two portal tabs in one browser: they share one stored
// group, so a write merges instead of replacing (see lib/clientStateMerge).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  conversationKeyOf,
  createConversationsStore,
  EMPTY_SUMMARY,
  MAX_TABS,
  unusedFreshTabId,
  type ConversationsStore,
} from './store'
import { setCurrentUser, writeState } from '../lib/clientState'

let store: ConversationsStore

beforeEach(() => {
  // persist: false keeps the store off localStorage, which the tests do not have.
  store = createConversationsStore({ persist: false })
})

function tabIdsFor(content: string) {
  return store.getState().tabs.filter((tab) => tab.sessionId === content).map((tab) => tab.id)
}

describe('conversationKeyOf', () => {
  it('strips the web prefix and the segment version', () => {
    expect(conversationKeyOf('web:abc')).toBe('abc')
    expect(conversationKeyOf('web:abc:v12')).toBe('abc')
    expect(conversationKeyOf(null)).toBeNull()
  })
})

describe('open', () => {
  it('reuses a tab whose conversation moved to a newer segment', () => {
    const first = store.open({ agentId: 'a', sessionId: 'web:x', agentName: 'A' })
    const second = store.open({ agentId: 'a', sessionId: 'web:x:v2', agentName: 'A' })
    expect(first.ok && second.ok).toBe(true)
    expect(second).toMatchObject({ reused: true })
    if (!first.ok || !second.ok) return
    expect(second.id).toBe(first.id)
    expect(store.getState().tabs).toHaveLength(1)
    expect(store.getState().tabs[0].sessionId).toBe('web:x:v2')
  })

  it('reuses the tab for a fresh conversation once it learned its conversation', () => {
    const fresh = store.open({ agentId: 'a', sessionId: null, agentName: 'A' })
    if (!fresh.ok) throw new Error('open failed')
    // The socket resolved the conversation before any stored row existed: the tab
    // records the key, not the session id.
    store.setChatId(fresh.id, 'x')
    const fromSidebar = store.open({ agentId: 'a', sessionId: 'web:x', agentName: 'A' })
    expect(fromSidebar).toMatchObject({ ok: true, reused: true, id: fresh.id })
    expect(store.getState().tabs).toHaveLength(1)
  })

  it('does not fold a new conversation into a tab that already has one', () => {
    const first = store.open({ agentId: 'a', sessionId: null, agentName: 'A' })
    if (!first.ok) throw new Error('open failed')
    store.setChatId(first.id, 'x')
    const second = store.open({ agentId: 'a', sessionId: null, agentName: 'A' })
    expect(second).toMatchObject({ ok: true, reused: false })
    expect(store.getState().tabs).toHaveLength(2)
  })

  it('collapses duplicates of one conversation, keeping the tab that is working', () => {
    const busy = store.open({ agentId: 'a', sessionId: 'web:x', agentName: 'A' })
    const idle = store.open({ agentId: 'a', sessionId: null, agentName: 'A' })
    if (!busy.ok || !idle.ok) throw new Error('open failed')
    store.publishSummary(busy.id, { ...EMPTY_SUMMARY, busy: true })
    // Same conversation reached through a second entry point (e.g. a duplicated
    // tab created before the fix).
    store.setChatId(idle.id, 'x')
    const again = store.open({ agentId: 'a', sessionId: 'web:x:v3', agentName: 'A' })
    expect(again).toMatchObject({ ok: true, reused: true, id: busy.id })
    expect(store.getState().tabs).toHaveLength(1)
    expect(store.getState().summaries[idle.id]).toBeUndefined()
  })

  it('does not rebind a tab that is mid-turn', () => {
    const fresh = store.open({ agentId: 'a', sessionId: null, agentName: 'A' })
    if (!fresh.ok) throw new Error('open failed')
    store.setChatId(fresh.id, 'x')
    store.publishSummary(fresh.id, { ...EMPTY_SUMMARY, busy: true })
    store.open({ agentId: 'a', sessionId: 'web:x', agentName: 'A' })
    // Re-pointing the session id here would tear the socket down and re-read the
    // segment underneath the running turn.
    expect(store.getState().tabs[0].sessionId).toBeNull()
  })

  it('keeps conversations of different agents apart', () => {
    const a = store.open({ agentId: 'a', sessionId: 'web:x', agentName: 'A' })
    const b = store.open({ agentId: 'b', sessionId: 'web:x', agentName: 'B' })
    expect(a.ok && b.ok).toBe(true)
    expect(store.getState().tabs).toHaveLength(2)
  })
})

describe('tab ceiling', () => {
  it('is high enough that a user does not meet it', () => {
    // The number is the decision: 8 was a wall users ran into. Pinning it here
    // (where the ceiling is enforced) makes a future change deliberate.
    expect(MAX_TABS).toBeGreaterThanOrEqual(20)
  })

  /** Opens `count` conversations on one agent and returns their tab ids. */
  function openMany(count: number): string[] {
    const ids: string[] = []
    for (let i = 0; i < count; i++) {
      const result = store.open({ agentId: 'a', sessionId: `web:c${i}`, agentName: 'A' })
      if (!result.ok) throw new Error(`open ${i} failed: ${result.reason}`)
      ids.push(result.id)
    }
    return ids
  }

  it('opens the whole ceiling without dropping a tab', () => {
    const ids = openMany(MAX_TABS)
    expect(store.getState().tabs.map((tab) => tab.id)).toEqual(ids)
  })

  it('evicts the least recently activated idle tab past the ceiling', () => {
    const ids = openMany(MAX_TABS)
    // The active tab is never the victim, so the oldest activation goes.
    const newest = ids[ids.length - 1]
    const result = store.open({ agentId: 'a', sessionId: 'web:extra', agentName: 'A' })
    expect(result.ok).toBe(true)
    const remaining = store.getState().tabs.map((tab) => tab.id)
    expect(remaining).toHaveLength(MAX_TABS)
    expect(remaining).not.toContain(ids[0])
    expect(remaining).toContain(newest)
  })

  it('refuses to open rather than evict a tab that is working', () => {
    const ids = openMany(MAX_TABS)
    for (const id of ids) {
      store.publishSummary(id, { ...EMPTY_SUMMARY, busy: true })
    }
    const result = store.open({ agentId: 'a', sessionId: 'web:extra', agentName: 'A' })
    expect(result).toMatchObject({ ok: false, reason: 'at-capacity' })
    expect(store.getState().tabs).toHaveLength(MAX_TABS)
  })
})

describe('close / lookup helpers', () => {
  it('finds every tab of a conversation, whatever segment it is parked on', () => {
    const one = store.open({ agentId: 'a', sessionId: 'web:x', agentName: 'A' })
    const two = store.open({ agentId: 'a', sessionId: 'web:y:v4', agentName: 'A' })
    if (!one.ok || !two.ok) throw new Error('open failed')
    expect(store.idsForConversation('a', 'x')).toEqual([one.id])
    expect(store.idsForConversation('a', 'y')).toEqual([two.id])
    expect(tabIdsFor('web:y:v4')).toEqual([two.id])
    store.close(two.id)
    expect(store.getState().tabs).toHaveLength(1)
    expect(store.getState().activeId).toBe(one.id)
  })
})

describe('closing a tab on the user’s behalf', () => {
  it('hands the panel to the same agent, skipping a neighbour from another one', () => {
    const first = store.open({ agentId: 'a', sessionId: 'web:one', agentName: 'A' })
    const other = store.open({ agentId: 'b', sessionId: 'web:two', agentName: 'B' })
    const last = store.open({ agentId: 'a', sessionId: 'web:three', agentName: 'A' })
    if (!first.ok || !other.ok || !last.ok) throw new Error('open failed')
    expect(store.getState().activeId).toBe(last.id)

    store.close(last.id, { activateAgent: 'a' })

    // The left neighbour is agent b's tab; closing for a delete must not follow it.
    expect(store.getState().activeId).toBe(first.id)
  })

  it('leaves no conversation active when that agent has no tab left', () => {
    const only = store.open({ agentId: 'a', sessionId: 'web:one', agentName: 'A' })
    const other = store.open({ agentId: 'b', sessionId: 'web:two', agentName: 'B' })
    if (!only.ok || !other.ok) throw new Error('open failed')
    store.activate(only.id)

    store.close(only.id, { activateAgent: 'a' })

    expect(store.getState().tabs.map((tab) => tab.agentId)).toEqual(['b'])
    expect(store.getState().activeId).toBeNull()
  })

  it('keeps the cross-agent neighbour rule when the caller did not name an agent', () => {
    const first = store.open({ agentId: 'a', sessionId: 'web:one', agentName: 'A' })
    const other = store.open({ agentId: 'b', sessionId: 'web:two', agentName: 'B' })
    const last = store.open({ agentId: 'a', sessionId: 'web:three', agentName: 'A' })
    if (!first.ok || !other.ok || !last.ok) throw new Error('open failed')

    // A hand-made close (the tab strip's ×) keeps today's behaviour.
    store.close(last.id)

    expect(store.getState().activeId).toBe(other.id)
  })
})

describe('adopting an unused new-conversation tab', () => {
  /** The tab the caller would offer: the untouched one in front of the user. */
  function offer(agentId: string): string | null {
    const state = store.getState()
    return unusedFreshTabId(state.tabs, state.summaries, state.activeId, agentId)
  }

  it('restores the conversation in the tab in front of the user', () => {
    const fresh = store.open({ agentId: 'a', sessionId: null, agentName: 'A' })
    if (!fresh.ok) throw new Error('open failed')

    const opened = store.open({ agentId: 'a', sessionId: 'web:x', agentName: 'A', adoptTabId: offer('a') })

    expect(opened).toMatchObject({ ok: true, reused: true, id: fresh.id })
    expect(store.getState().tabs).toHaveLength(1)
    expect(store.getState().tabs[0]).toMatchObject({ sessionId: 'web:x', chatId: 'x' })
    expect(store.getState().activeId).toBe(fresh.id)
  })

  it('leaves a tab that already has content alone', () => {
    const fresh = store.open({ agentId: 'a', sessionId: null, agentName: 'A' })
    if (!fresh.ok) throw new Error('open failed')
    store.publishSummary(fresh.id, { ...EMPTY_SUMMARY, started: true })

    expect(offer('a')).toBeNull()
    const opened = store.open({ agentId: 'a', sessionId: 'web:x', agentName: 'A', adoptTabId: offer('a') })
    expect(opened).toMatchObject({ reused: false })
    expect(store.getState().tabs).toHaveLength(2)
  })

  it('refuses a tab that started working, even when the caller insists', () => {
    const fresh = store.open({ agentId: 'a', sessionId: null, agentName: 'A' })
    if (!fresh.ok) throw new Error('open failed')
    store.publishSummary(fresh.id, { ...EMPTY_SUMMARY, busy: true })

    const opened = store.open({ agentId: 'a', sessionId: 'web:x', agentName: 'A', adoptTabId: fresh.id })
    expect(opened).toMatchObject({ reused: false })
    expect(store.getState().tabs).toHaveLength(2)
  })

  it('reuses an untouched new-conversation tab for another new conversation', () => {
    const fresh = store.open({ agentId: 'a', sessionId: null, agentName: 'A' })
    if (!fresh.ok) throw new Error('open failed')
    // The socket named the chat, so the tab carries a conversation key — it is
    // still untouched, and asking for a new conversation must not leave two.
    store.setChatId(fresh.id, 'ghost')

    const again = store.open({ agentId: 'a', sessionId: null, agentName: 'A', adoptTabId: offer('a') })
    expect(again).toMatchObject({ ok: true, reused: true, id: fresh.id })
    expect(store.getState().tabs).toHaveLength(1)
  })

  it('never offers a tab that is bound to a stored conversation', () => {
    const bound = store.open({ agentId: 'a', sessionId: 'web:x', agentName: 'A' })
    if (!bound.ok) throw new Error('open failed')
    expect(offer('a')).toBeNull()
  })

  it('never offers a tab of another agent', () => {
    const fresh = store.open({ agentId: 'a', sessionId: null, agentName: 'A' })
    if (!fresh.ok) throw new Error('open failed')
    expect(offer('b')).toBeNull()
  })
})

describe('two portal tabs sharing the stored group', () => {
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

  /** A fresh store over the same storage, as another portal tab would open. */
  function secondTab(): ConversationsStore {
    return createConversationsStore()
  }

  it('keeps a conversation opened in each tab', () => {
    const a = secondTab()
    const b = secondTab()
    const first = a.open({ agentId: 'x', sessionId: 'web:one', agentName: 'X' })
    const second = b.open({ agentId: 'x', sessionId: 'web:two', agentName: 'X' })
    expect(first.ok && second.ok).toBe(true)
    expect(a.getState().tabs).toHaveLength(1)
    const reopened = secondTab()
    expect(reopened.getState().tabs.map((tab) => tab.sessionId).sort()).toEqual(['web:one', 'web:two'])
  })

  it('keeps a tab one tab closed closed while the other opens one', () => {
    const seed = secondTab()
    seed.open({ agentId: 'x', sessionId: 'web:one', agentName: 'X' })
    seed.open({ agentId: 'x', sessionId: 'web:two', agentName: 'X' })
    const a = secondTab()
    const b = secondTab()
    const twoId = a.getState().tabs.find((tab) => tab.sessionId === 'web:two')?.id
    if (!twoId) throw new Error('tab missing')
    a.close(twoId)
    b.open({ agentId: 'x', sessionId: 'web:three', agentName: 'X' })
    const reopened = secondTab()
    expect(reopened.getState().tabs.map((tab) => tab.sessionId).sort()).toEqual(['web:one', 'web:three'])
  })

  it('remembers the session a fresh conversation was named, so a reload resumes it', () => {
    const a = secondTab()
    a.open({ agentId: 'x', sessionId: null, agentName: 'X' })
    const id = a.getState().tabs[0].id
    a.setResumeSession(id, 'web:fresh')

    const reloaded = secondTab()
    expect(reloaded.getState().tabs[0].resumeSessionId).toBe('web:fresh')
    // Still a conversation with no binding of its own: the id is what the next
    // mount resumes, not what the open socket follows.
    expect(reloaded.getState().tabs[0].sessionId).toBeNull()
  })

  it('records the resume id without binding the tab to it', () => {
    const a = secondTab()
    a.open({ agentId: 'x', sessionId: 'web:one', agentName: 'X' })
    const id = a.getState().tabs[0].id
    a.setResumeSession(id, 'web:one:v2')
    expect(a.getState().tabs[0].sessionId).toBe('web:one')
    expect(a.getState().tabs[0].resumeSessionId).toBe('web:one:v2')
  })

  it('forgets the resume id when the conversation is cleared', () => {
    const a = secondTab()
    a.open({ agentId: 'x', sessionId: null, agentName: 'X' })
    const id = a.getState().tabs[0].id
    a.setResumeSession(id, 'web:gone')
    a.setSession(id, null)
    expect(a.getState().tabs[0].resumeSessionId).toBeNull()
  })

  it('reads a stored group written before the field existed', () => {
    writeState('tabs', undefined, {
      v: 1,
      tabs: [{ agentId: 'x', sessionId: 'web:one', chatId: 'one', agentName: 'X' }],
      activeIndex: 0,
    })
    const store = secondTab()
    expect(store.getState().tabs[0].sessionId).toBe('web:one')
    expect(store.getState().tabs[0].resumeSessionId).toBeNull()
  })

  it('keeps the group of the account it was signed in as', () => {
    const a = secondTab()
    a.open({ agentId: 'x', sessionId: 'web:one', agentName: 'X' })
    setCurrentUser('u2')
    const other = secondTab()
    expect(other.getState().tabs).toEqual([])
    setCurrentUser('u1')
    expect(secondTab().getState().tabs.map((tab) => tab.sessionId)).toEqual(['web:one'])
  })
})
