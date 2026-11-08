// The compaction divider a mid-compaction read has to restore: the row's own
// divider is written only when the summary is in, so without this a reload
// showed a transcript with no "Compacting…" line at all.
import { describe, expect, it } from 'vitest'
import { appendLiveChunk, ensureCompactionDivider, finalizeBlocks, patchCompactionSummary } from './liveMessages'
import type { AgentMessage } from './useAgent'

let counter = 0
function nextId(): string {
  counter += 1
  return `id-${counter}`
}

const user: AgentMessage = { id: 'u1', role: 'user', content: 'hi', streaming: false }
const compactionRunning: AgentMessage = {
  id: 'c1',
  role: 'assistant',
  kind: 'compaction',
  summary: 'so far',
  streaming: true,
}
const compactionDone: AgentMessage = {
  id: 'c2',
  role: 'assistant',
  kind: 'compaction',
  summary: 'all of it',
  streaming: false,
}

describe('ensureCompactionDivider', () => {
  it('adds a streaming divider while the server reports a compaction', () => {
    const out = ensureCompactionDivider([user], true, nextId)
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ role: 'assistant', kind: 'compaction', streaming: true })
  })

  it('reuses a divider that is already streaming', () => {
    const out = ensureCompactionDivider([user, compactionRunning], true, nextId)
    expect(out).toHaveLength(2)
    expect(out[1]).toBe(compactionRunning)
  })

  it('does nothing when no compaction is reported', () => {
    expect(ensureCompactionDivider([user], false, nextId)).toHaveLength(1)
  })

  it('adds a fresh divider over a finished one', () => {
    const out = ensureCompactionDivider([user, compactionDone], true, nextId)
    expect(out).toHaveLength(3)
    expect(out[2]).toMatchObject({ kind: 'compaction', streaming: true })
  })
})

// The completion is the authoritative copy of a compaction's summary: it is the
// only source that survives a stream which lost its summary chunks (a dropped
// socket, a provider that sends no deltas) or one that never sent any (a
// /compact with nothing new to summarize).
describe('patchCompactionSummary', () => {
  it('fills and stops a divider that was still streaming', () => {
    const out = patchCompactionSummary([user, compactionRunning], 'all of it', nextId)
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ id: 'c1', kind: 'compaction', summary: 'all of it', streaming: false })
  })

  it('appends a divider when the transcript has none', () => {
    const out = patchCompactionSummary([user], 'all of it', nextId)
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ role: 'assistant', kind: 'compaction', summary: 'all of it', streaming: false })
  })

  it('fills the last divider, not an older one', () => {
    const out = patchCompactionSummary([compactionDone, compactionRunning], 'newest', nextId)
    expect(out[0]).toMatchObject({ id: 'c2', summary: 'all of it' })
    expect(out[1]).toMatchObject({ id: 'c1', summary: 'newest', streaming: false })
  })

  it('leaves the transcript alone when the completion carries no summary', () => {
    const messages = [user, compactionRunning]
    expect(patchCompactionSummary(messages, '', nextId)).toBe(messages)
  })
})

// A `question` call streams like any other tool call, but its result is the
// user's answer and only arrives once they reply — often minutes later, and
// always after the tool list has moved on in the reader's mind. It therefore
// gets a record of its own, and the answer frame has to find it there instead of
// landing on whatever tool happened to be last.
describe('appendLiveChunk with a question call', () => {
  const args = JSON.stringify({ questions: [{ question: 'Which database?' }] })
  const use = {
    kind: 'tool_use',
    content: JSON.stringify({ name: 'question', arguments: args }),
    messageId: 'm1',
  }

  it('opens a question record instead of adding it to the tool group', () => {
    const out = appendLiveChunk([], use, nextId, 1)

    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ role: 'assistant', kind: 'question', args, result: '', streaming: true })
  })

  it('gives the answer to the question record, not to the tool group', () => {
    let out = appendLiveChunk([], use, nextId, 1)
    out = appendLiveChunk(out, { kind: 'tool_result', content: '["Postgres"]', messageId: 'm1' }, nextId, 2)
    out = appendLiveChunk(
      out,
      { kind: 'tool_use', content: JSON.stringify({ name: 'read', arguments: '{"path":"a"}' }), messageId: 'm2' },
      nextId,
      3,
    )
    out = appendLiveChunk(out, { kind: 'tool_result', content: 'A', messageId: 'm2' }, nextId, 4)

    expect(out[0]).toMatchObject({ kind: 'question', result: '["Postgres"]', streaming: false })
    expect(out[1]).toMatchObject({ kind: 'tool_group', tools: [{ name: 'read', result: 'A' }] })
  })

  it('keeps the record waiting through a late frame of the same iteration', () => {
    // The reasoning tail of an iteration can arrive after its tool call; it must
    // not take the answer's place.
    let out = appendLiveChunk([], use, nextId, 1)
    out = appendLiveChunk(out, { kind: 'thought', content: 'still deciding', messageId: 'm1' }, nextId, 2)
    out = appendLiveChunk(out, { kind: 'tool_result', content: '["Postgres"]', messageId: 'm1' }, nextId, 3)

    const record = out.find((m) => m.role === 'assistant' && m.kind === 'question')
    expect(record).toMatchObject({ result: '["Postgres"]', streaming: false })
    expect(out.some((m) => m.role === 'assistant' && m.kind === 'tool_group')).toBe(false)
  })

  it('leaves an ordinary tool result in the tool group', () => {
    const out = appendLiveChunk(
      [],
      { kind: 'tool_use', content: JSON.stringify({ name: 'read', arguments: '{"path":"a"}' }), messageId: 'm1' },
      nextId,
      1,
    )
    const answered = appendLiveChunk(out, { kind: 'tool_result', content: 'A', messageId: 'm1' }, nextId, 2)

    expect(answered[0]).toMatchObject({ kind: 'tool_group', tools: [{ name: 'read', result: 'A' }] })
  })

  it('keeps the record open until the answer arrives', () => {
    const out = appendLiveChunk([], use, nextId, 1)
    const next = appendLiveChunk(out, { kind: 'thought', content: 'more', messageId: 'm2' }, nextId, 2)

    expect(next[0]).toMatchObject({ kind: 'question', streaming: true })
  })

  it('closes a question record when the turn ends', () => {
    const out = finalizeBlocks(appendLiveChunk([], use, nextId, 1), 2)

    expect(out[0]).toMatchObject({ kind: 'question', streaming: false })
  })
})
