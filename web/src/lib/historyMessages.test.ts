// Restoring a transcript from the stored provider messages. The new contract
// here is that a `question` call is not a step of the tool chain: it becomes a
// record of its own, between the runs that surround it, because the answer it
// carries is the only copy of what the user decided.
import { describe, expect, it } from 'vitest'
import type { AgentMessage } from '../hooks/useAgent'
import { messagesFromProvider, parseProviderMessages } from './historyMessages'

const questionArgs = JSON.stringify({ questions: [{ question: 'Which database?', header: 'Storage' }] })

function kinds(messages: AgentMessage[]): string[] {
  return messages.map((m) => (m.role === 'assistant' ? m.kind : m.role))
}

function question(messages: AgentMessage[]): Extract<AgentMessage, { kind: 'question' }> | undefined {
  return messages.find(
    (m): m is Extract<AgentMessage, { kind: 'question' }> => m.role === 'assistant' && m.kind === 'question',
  )
}

describe('parseProviderMessages', () => {
  it('is empty for malformed or absent rows', () => {
    expect(parseProviderMessages('not json')).toEqual([])
    expect(parseProviderMessages('{"role":"user"}')).toEqual([])
  })
})

describe('messagesFromProvider', () => {
  it('pulls a question out of the tool group and carries its answer', () => {
    const out = messagesFromProvider(
      [
        { role: 'user', content: 'set it up' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'q1', name: 'question', arguments: questionArgs }] },
        { role: 'tool', tool_call_id: 'q1', content: '["Postgres"]' },
        { role: 'assistant', content: 'done' },
      ],
      'hist-s1',
    )

    expect(kinds(out)).toEqual(['user', 'question', 'content'])
    expect(question(out)).toMatchObject({
      args: questionArgs,
      result: '["Postgres"]',
      streaming: false,
    })
  })

  it('keeps ordinary tool calls batched into one group', () => {
    const out = messagesFromProvider(
      [
        { role: 'assistant', content: '', tool_calls: [{ id: 't1', name: 'read', arguments: '{"path":"a"}' }] },
        { role: 'tool', tool_call_id: 't1', content: 'A' },
        { role: 'assistant', content: '', tool_calls: [{ id: 't2', name: 'edit', arguments: '{"path":"a"}' }] },
        { role: 'tool', tool_call_id: 't2', content: 'ok' },
      ],
      'hist-s1',
    )

    expect(kinds(out)).toEqual(['tool_group'])
    expect(out[0]).toMatchObject({ kind: 'tool_group', tools: [{ name: 'read', result: 'A' }, { name: 'edit', result: 'ok' }] })
  })

  it('breaks the tool chain around a question', () => {
    const out = messagesFromProvider(
      [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 't1', name: 'read', arguments: '{"path":"a"}' },
            { id: 'q1', name: 'question', arguments: questionArgs },
            { id: 't2', name: 'edit', arguments: '{"path":"a"}' },
          ],
        },
        { role: 'tool', tool_call_id: 't1', content: 'A' },
        { role: 'tool', tool_call_id: 'q1', content: '["MySQL"]' },
        { role: 'tool', tool_call_id: 't2', content: 'ok' },
      ],
      'hist-s1',
    )

    expect(kinds(out)).toEqual(['tool_group', 'question', 'tool_group'])
    expect(out[0]).toMatchObject({ tools: [{ name: 'read' }] })
    expect(out[2]).toMatchObject({ tools: [{ name: 'edit' }] })
    expect(question(out)).toMatchObject({ result: '["MySQL"]' })
  })

  it('shows an unanswered question as waiting only when it is the pending one', () => {
    const parsed = [
      { role: 'assistant', content: '', tool_calls: [{ id: 'q1', name: 'question', arguments: questionArgs }] },
    ]
    const pending = { questions: [{ question: 'Which database?' }] }

    expect(question(messagesFromProvider(parsed, 'hist-s1', pending))).toMatchObject({ streaming: true })
    expect(question(messagesFromProvider(parsed, 'hist-s1'))).toMatchObject({ streaming: false })
    expect(question(messagesFromProvider(parsed, 'hist-s1', { questions: [{ question: 'Something else?' }] }))).toMatchObject({
      streaming: false,
    })
  })

  it('leaves a call whose arguments are not a question in the tool group', () => {
    const out = messagesFromProvider(
      [{ role: 'assistant', content: '', tool_calls: [{ id: 't1', name: 'question', arguments: 'not json' }] }],
      'hist-s1',
    )

    expect(kinds(out)).toEqual(['tool_group'])
  })

  it('keeps ids stable across reads so row heights survive a reload', () => {
    const parsed = [{ role: 'user', content: 'hi' }]

    expect(messagesFromProvider(parsed, 'hist-s1').map((m) => m.id)).toEqual(messagesFromProvider(parsed, 'hist-s1').map((m) => m.id))
  })
})
