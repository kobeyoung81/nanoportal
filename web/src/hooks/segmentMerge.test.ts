import { describe, expect, it } from 'vitest'
import { isPendingUser, mergeSegment, nextSegmentToRead, prependSegment, reconcilePending } from './segmentMerge'
import type { AgentMessage } from './useAgent'

function user(content: string, pending = false): AgentMessage {
  return { id: `u-${content}`, role: 'user', content, streaming: false, pending }
}

function answer(content: string, streaming = false): AgentMessage {
  return { id: `a-${content}`, role: 'assistant', kind: 'content', content, streaming }
}

describe('reconcilePending', () => {
  it('clears the marker once the stored history contains the message', () => {
    const local = [user('hello', true)]
    const stored = [user('hello')]
    expect(reconcilePending(local, stored)[0]).toMatchObject({ pending: false })
  })

  it('leaves a message the server has not recorded yet marked', () => {
    const local = [user('first', true), user('second', true)]
    const stored = [user('first')]
    const out = reconcilePending(local, stored)
    expect(isPendingUser(out[0])).toBe(false)
    expect(isPendingUser(out[1])).toBe(true)
  })

  it('consumes duplicate content in order, so one stored message confirms one bubble', () => {
    const local = [user('same', true), user('same', true)]
    const stored = [user('same')]
    const out = reconcilePending(local, stored)
    expect(out.filter(isPendingUser)).toHaveLength(1)
  })

  it('does not touch entries that are not unconfirmed user messages', () => {
    const local = [answer('hi'), user('done')]
    expect(reconcilePending(local, [])).toEqual(local)
  })
})

describe('mergeSegment', () => {
  it('keeps an unconfirmed user message that the stored row does not have yet', () => {
    const current = [answer('earlier'), user('just sent', true)]
    const stored = [answer('earlier')]
    const merged = mergeSegment(current, stored, 0)
    expect(merged.map((m) => m.role === 'user' && m.content)).toEqual([false, 'just sent'])
  })

  it('prefers the stored row once it contains the message', () => {
    const current = [user('just sent', true)]
    const stored = [user('just sent'), answer('ok')]
    const merged = mergeSegment(current, stored, 0)
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ role: 'user', content: 'just sent', pending: false })
    expect(merged[1]).toMatchObject({ role: 'assistant', content: 'ok' })
  })

  it('never touches the older segments in front of the tail', () => {
    const prefix = [user('from an older segment'), answer('older answer')]
    const current = [...prefix, user('new', true)]
    const stored = [user('new')]
    const merged = mergeSegment(current, stored, prefix.length)
    expect(merged.slice(0, prefix.length)).toEqual(prefix)
  })

  it('leaves a streaming turn alone: the stored row lags the stream', () => {
    const current = [user('ask'), answer('partial', true)]
    expect(mergeSegment(current, [user('ask')], 0)).toBe(current)
  })

  it('keeps the history on the first read even when the stream got there first', () => {
    // A mount (or a reload) taken while the turn is streaming: the live block is
    // already on screen and the stored row arrives afterwards.
    const current = [answer('live tail', true)]
    const stored = [user('older question'), answer('older answer'), user('ask'), answer('partial')]
    const merged = mergeSegment(current, stored, 0, false)
    expect(merged.map((m) => (m as { content: string }).content)).toEqual([
      'older question',
      'older answer',
      'ask',
      'partial',
      'live tail',
    ])
  })

  it('does not repeat the part of the answer the stored row already had', () => {
    // The agent syncs the session while it streams, so the row can end with a
    // prefix of the live block. The live block wins (chunks keep appending to
    // it) and the overlapping row message is dropped.
    const current = [answer('the whole answer so far', true)]
    const stored = [user('ask'), answer('the whole')]
    const merged = mergeSegment(current, stored, 0, false)
    expect(merged.map((m) => (m as { content: string }).content)).toEqual(['ask', 'the whole answer so far'])
  })

  it('keeps the older segments in front of the first read too', () => {
    const prefix = [user('from an older segment'), answer('older answer')]
    const current = [...prefix, answer('live', true)]
    const merged = mergeSegment(current, [user('ask')], prefix.length, false)
    expect(merged.slice(0, prefix.length)).toEqual(prefix)
    expect(merged).toHaveLength(prefix.length + 2)
  })

  it('keeps an unsent user message after the history on the first read', () => {
    const current = [user('just typed', true), answer('live', true)]
    const stored = [user('older')]
    const merged = mergeSegment(current, stored, 0, false)
    expect(merged.map((m) => (m as { content: string }).content)).toEqual(['older', 'live', 'just typed'])
  })
})

describe('prependSegment / nextSegmentToRead (segment chain assembly)', () => {
  it('puts an older segment in front, keeping oldest first', () => {
    const current = [answer('newest')]
    const older = [user('oldest'), answer('older')]
    expect(prependSegment(current, older).map((m) => (m as { content: string }).content)).toEqual([
      'oldest',
      'older',
      'newest',
    ])
  })

  it('reads the predecessor while it is unknown', () => {
    expect(nextSegmentToRead({ prev: 'web:x:v1', hops: 0, loaded: new Set(), maxHops: 50 })).toBe('web:x:v1')
  })

  it('stops at the end of the chain', () => {
    expect(nextSegmentToRead({ prev: null, hops: 3, loaded: new Set(), maxHops: 50 })).toBeNull()
  })

  it('never re-reads a segment it already has', () => {
    expect(nextSegmentToRead({ prev: 'web:x:v1', hops: 0, loaded: new Set(['web:x:v1']), maxHops: 50 })).toBeNull()
  })

  it('terminates a cyclic handoff chain at the hop cap', () => {
    expect(nextSegmentToRead({ prev: 'web:x:v1', hops: 50, loaded: new Set(), maxHops: 50 })).toBeNull()
  })
})
