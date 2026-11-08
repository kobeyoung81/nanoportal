// The segment chain, and the fallback used when a stored row does not name its
// predecessor. meta.handoff_from is the source of truth; these rows are what the
// transcript falls back to, and getting the order wrong would show history out of
// order or stop it early.
import { describe, expect, it } from 'vitest'
import {
  EMPTY_ENTRY,
  invalidSessionAction,
  isResumableSession,
  mergeSessionRows,
  previousSegmentFallback,
  resolveResumeSession,
  restoredFromSnapshot,
  segmentVersionOf,
  topConversationExcluding,
  type SessionListEntry,
} from './sessionLists'
import type { SessionSummary } from '../lib/api'

function row(id: string, chatId: string, status = 'archived'): SessionSummary {
  return {
    id,
    agent_id: 'a',
    account_id: 'u',
    channel: 'web',
    chat_id: chatId,
    status,
    title: '',
    message_count: 1,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  }
}

describe('segmentVersionOf', () => {
  it('reads the version suffix, defaulting to the base segment', () => {
    expect(segmentVersionOf('web:x')).toBe(0)
    expect(segmentVersionOf('web:x:v1')).toBe(1)
    expect(segmentVersionOf('web:x:v12')).toBe(12)
  })
})

describe('previousSegmentFallback', () => {
  it('picks the next older segment of the same conversation', () => {
    const rows = [row('web:x', 'x'), row('web:x:v1', 'x'), row('web:x:v2', 'x')]
    expect(previousSegmentFallback(rows, 'web:x:v2')).toBe('web:x:v1')
    expect(previousSegmentFallback(rows, 'web:x:v1')).toBe('web:x')
  })

  it('ends the chain at the base segment', () => {
    expect(previousSegmentFallback([row('web:x', 'x')], 'web:x')).toBeNull()
  })

  it('skips a missing version and takes the closest one below', () => {
    const rows = [row('web:x', 'x'), row('web:x:v1', 'x'), row('web:x:v3', 'x')]
    expect(previousSegmentFallback(rows, 'web:x:v3')).toBe('web:x:v1')
  })

  it('counts archived rows, which is what older segments are', () => {
    const rows = [row('web:x', 'x', 'archived'), row('web:x:v1', 'x', 'active')]
    expect(previousSegmentFallback(rows, 'web:x:v1')).toBe('web:x')
  })

  it('never crosses into another conversation', () => {
    const rows = [row('web:y', 'y'), row('web:y:v1', 'y')]
    expect(previousSegmentFallback(rows, 'web:x:v2')).toBeNull()
  })

  it('returns null when the list has nothing older', () => {
    expect(previousSegmentFallback([], 'web:x:v2')).toBeNull()
  })
})

/** A well-formed bucket; `over` replaces single fields. */
function bucket(over: Partial<SessionListEntry> = {}): SessionListEntry {
  return { ...EMPTY_ENTRY, ...over }
}

describe('restoredFromSnapshot', () => {
  // A bucket exactly as an older version of the app wrote it: this is the shape
  // that predates `segments`.
  function legacyBucket(): SessionListEntry {
    return {
      rows: [row('web:x', 'x')],
      total: 1,
      fetchedAt: 1_700_000_000_000,
      rawOffset: 1,
      hasMore: false,
      loading: false,
      loadingMore: false,
      error: null,
    } as unknown as SessionListEntry
  }

  it('fills in a field the snapshot predates instead of leaving it missing', () => {
    const restored = restoredFromSnapshot({ a: legacyBucket() })
    expect(restored.a.segments).toEqual([])
    expect(restored.a.rows).toHaveLength(1)
    // The fetch that used to throw (reading `.map` of undefined) now merges.
    expect(mergeSessionRows(restored.a.segments, [row('web:y', 'y')])).toHaveLength(1)
    // A restored bucket always revalidates.
    expect(restored.a.fetchedAt).toBe(0)
  })

  it('survives a bucket that is missing everything', () => {
    const restored = restoredFromSnapshot({ a: {} as unknown as SessionListEntry })
    expect(restored.a).toMatchObject({ rows: [], segments: [], total: 0, rawOffset: 0, hasMore: false })
  })
})

describe('mergeSessionRows', () => {
  it('treats a missing side as empty instead of throwing', () => {
    const rows = [row('web:x', 'x')]
    expect(mergeSessionRows(undefined, rows)).toEqual(rows)
    expect(mergeSessionRows(rows, undefined)).toEqual(rows)
    expect(mergeSessionRows(undefined, undefined)).toEqual([])
  })

  it('overlays incoming rows by id and keeps the ones already loaded', () => {
    const merged = mergeSessionRows([row('web:x', 'x'), row('web:y', 'y')], [row('web:y', 'y', 'active')])
    expect(merged.map((item) => item.id)).toEqual(['web:x', 'web:y'])
    expect(merged[1].status).toBe('active')
  })
})

describe('invalidSessionAction', () => {
  it('repoints to the segment the list shows for that conversation', () => {
    const entry = bucket({ rows: [row('web:x:v2', 'x')], fetchedAt: 1 })
    expect(invalidSessionAction(entry, 'x', 'web:x')).toEqual({ kind: 'repoint', sessionId: 'web:x:v2' })
  })

  it('closes the tab when a freshly fetched bucket knows the conversation but it is no longer active', () => {
    // Its row is still in the ungrouped rows (archived), so the conversation
    // exists and was archived: there is nothing left for the tab to show.
    const entry = bucket({
      rows: [row('web:other', 'other')],
      segments: [row('web:x', 'x'), row('web:other', 'other')],
      fetchedAt: 1,
    })
    expect(invalidSessionAction(entry, 'x', 'web:x').kind).toBe('close')
  })

  it('never closes the tab for a conversation the bucket has never seen', () => {
    // The gateway names a new conversation before anything is stored, so a tab
    // holding that id has no row to find; closing it here is what made a freshly
    // opened tab flash and disappear.
    const entry = bucket({ rows: [row('web:other', 'other')], segments: [], fetchedAt: 1 })
    expect(invalidSessionAction(entry, 'x', 'web:x').kind).toBe('clear')
  })

  it('never closes the tab on a bucket whose fetch failed', () => {
    // The online failure: the list request errored, so the rows are whatever the
    // snapshot held and cannot say that this conversation is gone.
    const entry = bucket({ rows: [row('web:other', 'other')], fetchedAt: 1, error: 'boom' })
    expect(invalidSessionAction(entry, 'x', 'web:x').kind).toBe('clear')
  })

  it('never closes the tab on a bucket that was only restored from a snapshot', () => {
    const entry = bucket({ rows: [row('web:other', 'other')], fetchedAt: 0 })
    expect(invalidSessionAction(entry, 'x', 'web:x').kind).toBe('clear')
  })

  it('never closes the tab while a fetch is still in flight', () => {
    const entry = bucket({ rows: [row('web:other', 'other')], fetchedAt: 1, loading: true })
    expect(invalidSessionAction(entry, 'x', 'web:x').kind).toBe('clear')
  })

  it('clears when the list knows nothing yet', () => {
    expect(invalidSessionAction(bucket(), 'x', 'web:x').kind).toBe('clear')
  })

  it('clears a tab that has no conversation yet', () => {
    const entry = bucket({ rows: [row('web:other', 'other')], fetchedAt: 1 })
    expect(invalidSessionAction(entry, null, null).kind).toBe('clear')
  })
})

describe('isResumableSession', () => {
  it('accepts a session the list shows as active', () => {
    expect(isResumableSession(bucket({ rows: [row('web:x:v2', 'x')] }), 'web:x:v2')).toBe(true)
  })

  it('rejects a conversation that was never stored', () => {
    // The gateway names a new chat before anything is written: remembering that
    // id is what made re-selecting the agent resume a session that cannot exist.
    expect(isResumableSession(bucket(), 'web:ghost')).toBe(false)
    expect(isResumableSession(bucket({ rows: [row('web:other', 'other')] }), 'web:ghost')).toBe(false)
  })

  it('rejects an archived segment the list folded away', () => {
    expect(isResumableSession(bucket({ rows: [row('web:x:v2', 'x')] }), 'web:x')).toBe(false)
  })
})

describe('resolveResumeSession', () => {
  it('prefers the segment the list says the conversation is on now', () => {
    const entry: SessionListEntry = { ...EMPTY_ENTRY, rows: [row('web:c:v2', 'c', 'active')] }
    expect(resolveResumeSession(entry, { chatId: 'c', resumeSessionId: 'web:c' })).toBe('web:c:v2')
  })

  it('falls back to the id the socket was last named', () => {
    expect(resolveResumeSession(EMPTY_ENTRY, { chatId: 'c', resumeSessionId: 'web:c' })).toBe('web:c')
  })

  it('resumes nothing when the list is empty and no id was recorded', () => {
    expect(resolveResumeSession(EMPTY_ENTRY, { chatId: 'c', resumeSessionId: null })).toBeNull()
  })

  it('ignores rows of another conversation', () => {
    const entry: SessionListEntry = { ...EMPTY_ENTRY, rows: [row('web:other', 'other', 'active')] }
    expect(resolveResumeSession(entry, { chatId: 'c', resumeSessionId: null })).toBeNull()
  })
})

describe('topConversationExcluding', () => {
  it('returns the first row when the removed conversation sat further down', () => {
    const rows = [row('web:newest', 'newest'), row('web:gone', 'gone'), row('web:older', 'older')]
    expect(topConversationExcluding(rows, 'gone')?.chat_id).toBe('newest')
  })

  it('skips the removed conversation when it was the top row', () => {
    const rows = [row('web:gone', 'gone'), row('web:next', 'next')]
    expect(topConversationExcluding(rows, 'gone')?.chat_id).toBe('next')
  })

  it('has nothing to fall back to when it was the only conversation', () => {
    expect(topConversationExcluding([row('web:gone', 'gone')], 'gone')).toBeNull()
    expect(topConversationExcluding([], 'gone')).toBeNull()
  })

  it('takes the first row when there is no conversation key to exclude', () => {
    const rows = [row('web:one', 'one'), row('web:two', 'two')]
    expect(topConversationExcluding(rows, null)?.chat_id).toBe('one')
  })
})
