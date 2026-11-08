// The merge-before-write rule for the two slices two portal tabs both write.
// Each case is the interleaving that used to lose data: two tabs changing
// different things, then whichever saved last reverting the other.
import { describe, expect, it } from 'vitest'
import {
  mergeLayout,
  mergeTabPayload,
  parseStoredLayout,
  parseStoredTabs,
  STORED_TABS_MAX,
  type StoredLayout,
  type StoredTab,
  type StoredTabs,
} from './clientStateMerge'

function layout(over: Partial<StoredLayout> = {}): StoredLayout {
  return {
    v: 1,
    slots: {
      left: { tabs: ['agents'], active: 'agents' },
      center: { tabs: ['chat'], active: 'chat' },
      right: { tabs: ['files'], active: 'files' },
      bottom: { tabs: [], active: null },
    },
    sizes: { leftPct: 18, rightPct: 26, bottomPct: 34 },
    lastSlot: { files: 'right' },
    hiddenSlots: {},
    ...over,
  }
}

function tab(over: Partial<StoredTab> = {}): StoredTab {
  return { agentId: 'a1', sessionId: 'web:c1:v1', chatId: 'c1', agentName: 'Agent', title: 'T', ...over }
}

function tabs(list: StoredTab[], activeIndex = 0): StoredTabs {
  return { v: 1, tabs: list, activeIndex }
}

describe('mergeLayout', () => {
  it('keeps a size change here and a plugin toggle there', () => {
    // This tab dragged the left dock; the other tab had already opened the
    // terminal in the bottom dock and stored it.
    const previous = layout()
    const next = layout({ sizes: { leftPct: 30, rightPct: 26, bottomPct: 34 } })
    const fresh = layout({ slots: { ...layout().slots, bottom: { tabs: ['terminal'], active: 'terminal' } } })
    const merged = mergeLayout(fresh, next, previous)
    expect(merged.sizes.leftPct).toBe(30)
    expect(merged.slots.bottom.tabs).toEqual(['terminal'])
  })

  it('keeps a hidden dock set here and a moved plugin there', () => {
    const previous = layout()
    const next = layout({ hiddenSlots: { right: true } })
    const fresh = layout({
      slots: { ...layout().slots, right: { tabs: [], active: null }, left: { tabs: ['agents', 'files'], active: 'files' } },
      lastSlot: { files: 'left' },
    })
    const merged = mergeLayout(fresh, next, previous)
    expect(merged.hiddenSlots.right).toBe(true)
    expect(merged.lastSlot.files).toBe('left')
    expect(merged.slots.left.active).toBe('files')
  })

  it('lets the writer win when both changed the same field', () => {
    const previous = layout()
    const next = layout({ sizes: { leftPct: 40, rightPct: 26, bottomPct: 34 } })
    const fresh = layout({ sizes: { leftPct: 12, rightPct: 26, bottomPct: 34 } })
    expect(mergeLayout(fresh, next, previous).sizes.leftPct).toBe(40)
  })

  it('writes next as-is without anything to merge with', () => {
    const next = layout({ sizes: { leftPct: 55, rightPct: 26, bottomPct: 34 } })
    expect(mergeLayout(null, next, layout()).sizes.leftPct).toBe(55)
    expect(mergeLayout(layout(), next, null).sizes.leftPct).toBe(55)
  })
})

describe('mergeTabPayload', () => {
  it('keeps a conversation opened here and one opened there', () => {
    const previous = tabs([tab()])
    const next = tabs([tab(), tab({ sessionId: 'web:c2:v1', chatId: 'c2' })], 1)
    const fresh = tabs([tab(), tab({ sessionId: 'web:c3:v1', chatId: 'c3', title: 'other' })], 1)
    const merged = mergeTabPayload(fresh, next, previous)
    expect(merged.tabs.map((t) => t.chatId)).toEqual(['c1', 'c2', 'c3'])
    expect(merged.activeIndex).toBe(1)
  })

  it('keeps a tab this tab closed closed', () => {
    const previous = tabs([tab(), tab({ sessionId: 'web:c2:v1', chatId: 'c2' })])
    const next = tabs([tab()])
    const fresh = tabs([tab(), tab({ sessionId: 'web:c2:v1', chatId: 'c2' })])
    expect(mergeTabPayload(fresh, next, previous).tabs.map((t) => t.chatId)).toEqual(['c1'])
  })

  it('does not resurrect a tab another tab closed', () => {
    // This tab wrote nothing about c2, so the stored group — where c2 is gone —
    // decides: writing this tab's stale snapshot back must not bring it back.
    const previous = tabs([tab(), tab({ sessionId: 'web:c2:v1', chatId: 'c2' })])
    const next = tabs([
      tab(),
      tab({ sessionId: 'web:c2:v1', chatId: 'c2' }),
      tab({ sessionId: 'web:c3:v1', chatId: 'c3' }),
    ])
    const fresh = tabs([tab()])
    expect(mergeTabPayload(fresh, next, previous).tabs.map((t) => t.chatId)).toEqual(['c1', 'c3'])
  })

  it('takes a fresher identity another tab learned, keeping the position', () => {
    const previous = tabs([tab(), tab({ sessionId: 'web:c2:v1', chatId: 'c2' })])
    const next = tabs([tab({ title: 'mine' }), tab({ sessionId: 'web:c2:v1', chatId: 'c2' })])
    const fresh = tabs([
      tab({ title: 'mine' }),
      tab({ sessionId: 'web:c2:v3', chatId: 'c2', title: 'renamed' }),
    ])
    const merged = mergeTabPayload(fresh, next, previous)
    expect(merged.tabs[1].sessionId).toBe('web:c2:v3')
    expect(merged.tabs[1].title).toBe('renamed')
  })

  it('caps the group and follows the active index of whoever changed it', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => tab({ sessionId: `web:c${i}:v1`, chatId: `c${i}` }))
    const previous = tabs(many(STORED_TABS_MAX - 1), 2)
    const next = tabs(many(STORED_TABS_MAX), 5)
    const fresh = tabs(many(STORED_TABS_MAX - 1), 3)
    const merged = mergeTabPayload(fresh, next, previous)
    expect(merged.tabs.length).toBe(STORED_TABS_MAX)
    expect(merged.activeIndex).toBe(5)
    // Nobody here moved the active tab, so the stored one wins.
    expect(mergeTabPayload(fresh, tabs(many(STORED_TABS_MAX - 1), 2), previous).activeIndex).toBe(3)
  })

  it('keeps a ceiling a user will not meet, and does not truncate it', () => {
    // The number is the decision: 8 was a wall users ran into. Pinning it makes
    // a future change deliberate rather than incidental.
    expect(STORED_TABS_MAX).toBeGreaterThanOrEqual(20)
    const many = Array.from({ length: 20 }, (_, i) => tab({ sessionId: `web:c${i}:v1`, chatId: `c${i}` }))
    expect(mergeTabPayload(null, tabs(many), tabs([])).tabs.length).toBe(20)
  })

  it('writes next as-is without anything to merge with', () => {
    const next = tabs([tab(), tab({ sessionId: 'web:c2:v1', chatId: 'c2' })])
    expect(mergeTabPayload(null, next, tabs([tab()])).tabs.length).toBe(2)
  })
})

describe('parse helpers', () => {
  it('rejects what an older version could have written', () => {
    expect(parseStoredLayout(null)).toBeNull()
    expect(parseStoredLayout({ v: 2, slots: {}, sizes: {} })).toBeNull()
    expect(parseStoredTabs({ v: 2, tabs: [] })).toBeNull()
  })

  it('normalizes a stored layout with a missing dock', () => {
    const parsed = parseStoredLayout({ v: 1, slots: { left: { tabs: ['agents'], active: 'agents' } }, sizes: { leftPct: 18, rightPct: 26, bottomPct: 34 } })
    expect(parsed?.slots.right).toEqual({ tabs: [], active: null })
    expect(parsed?.slots.left.tabs).toEqual(['agents'])
  })

  it('drops tab records without an agent', () => {
    const parsed = parseStoredTabs({ v: 1, tabs: [tab(), { agentId: '' }], activeIndex: 1 })
    expect(parsed?.tabs.length).toBe(1)
  })

  it('renames the panel whose plugin id changed', () => {
    // "Agent Config" is "User Config" now. A layout stored before the rename
    // holds the old id: without the mapping the dock keeps a tag no plugin
    // declares and the panel disappears from that browser.
    const parsed = parseStoredLayout({
      v: 1,
      slots: {
        left: { tabs: ['agents'], active: 'agents' },
        center: { tabs: ['chat', 'agent-config'], active: 'agent-config' },
        right: { tabs: ['files'], active: 'files' },
        bottom: { tabs: [], active: null },
      },
      sizes: { leftPct: 18, rightPct: 26, bottomPct: 34 },
      lastSlot: { 'agent-config': 'right', files: 'right' },
      hiddenSlots: {},
    })
    expect(parsed?.slots.center.tabs).toEqual(['chat', 'user-config'])
    expect(parsed?.slots.center.active).toBe('user-config')
    expect(parsed?.lastSlot['user-config']).toBe('right')
    expect(parsed?.lastSlot['agent-config']).toBeUndefined()
  })
})
