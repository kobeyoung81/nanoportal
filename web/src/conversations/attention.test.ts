// The sidebar's two attention dots and the rules that decide them: the union per
// agent, and "a conversation this browser has open wins over the server's
// snapshot". The snapshot is up to one poll old, so a stale `running` left to win
// would keep a dot lit after the turn it describes had already finished — the
// same mistake the transcript's running indicator had to be fixed for.
import { describe, expect, it } from 'vitest'
import {
  agentAttention,
  applyLiveAttention,
  indexAttention,
  nextReadAt,
  sessionAttention,
  type ConversationAttention,
} from './attention'
import { EMPTY_SUMMARY, type ConversationTab, type TabSummary } from './store'
import type { SessionSummary } from '../lib/api'

function snapshotRow(agentId: string, chatId: string, running: boolean, awaiting: boolean): ConversationAttention {
  return { agent_id: agentId, chat_id: chatId, session_id: `web:${chatId}`, running, awaiting, updated_at: '' }
}

function tab(id: string, agentId: string, chatId: string | null): ConversationTab {
  return {
    id,
    agentId,
    sessionId: chatId ? `web:${chatId}` : null,
    resumeSessionId: chatId ? `web:${chatId}` : null,
    chatId,
    agentName: agentId,
    openedAt: 0,
    lastActiveAt: 0,
  }
}

function summary(busy: boolean, awaitingInput: boolean): TabSummary {
  return { ...EMPTY_SUMMARY, connected: true, busy, awaitingInput }
}

function sessionRow(chatId: string, turnRunning?: boolean): SessionSummary {
  return {
    id: `web:${chatId}`,
    agent_id: 'a1',
    account_id: 'u1',
    channel: 'web',
    chat_id: chatId,
    status: 'active',
    message_count: 1,
    turn_running: turnRunning,
    created_at: '2026-10-09T00:00:00Z',
    updated_at: '2026-10-09T00:00:00Z',
  }
}

describe('indexAttention', () => {
  it('indexes every conversation and unions them per agent', () => {
    const index = indexAttention([
      snapshotRow('a1', 'c1', true, false),
      snapshotRow('a1', 'c2', false, true),
      snapshotRow('a2', 'c3', false, false),
    ])

    expect(index.conversations['a1|c1']).toEqual({ running: true, awaiting: false, unread: false })
    expect(index.conversations['a1|c2']).toEqual({ running: false, awaiting: true, unread: false })
    expect(index.agents['a1']).toEqual({ running: true, awaiting: true, unread: false })
    expect(index.agents['a2']).toEqual({ running: false, awaiting: false, unread: false })
  })

  it('has nothing for an empty snapshot', () => {
    expect(indexAttention([])).toEqual({ conversations: {}, agents: {} })
  })
})

describe('applyLiveAttention', () => {
  it('lets an open conversation override a stale snapshot the browser can see is over', () => {
    const index = indexAttention([snapshotRow('a1', 'c1', true, false)])

    const live = applyLiveAttention(index, [tab('t1', 'a1', 'c1')], { t1: summary(false, false) })

    expect(live.conversations['a1|c1']).toEqual({ running: false, awaiting: false, unread: false })
    // …and the agent's union goes with it: a dot whose only source was that
    // conversation must not survive on the agent row.
    expect(live.agents['a1']).toEqual({ running: false, awaiting: false, unread: false })
  })

  it('adds a conversation the snapshot does not know yet', () => {
    const live = applyLiveAttention(indexAttention([]), [tab('t1', 'a1', 'c1')], { t1: summary(true, false) })

    expect(live.conversations['a1|c1']).toEqual({ running: true, awaiting: false, unread: false })
    expect(live.agents['a1']).toEqual({ running: true, awaiting: false, unread: false })
  })

  it('counts a tab with no chat id for its agent only', () => {
    // A conversation the gateway has not named yet cannot be keyed, but it is
    // still this agent's work.
    const live = applyLiveAttention(indexAttention([]), [tab('t1', 'a1', null)], { t1: summary(false, true) })

    expect(live.conversations).toEqual({})
    expect(live.agents['a1']).toEqual({ running: false, awaiting: true, unread: false })
  })

  it('changes nothing when no tab is open', () => {
    const index = indexAttention([snapshotRow('a1', 'c1', true, false)])

    expect(applyLiveAttention(index, [], {})).toBe(index)
  })

  it('keeps the snapshot for a tab that has not published a summary yet', () => {
    const index = indexAttention([snapshotRow('a1', 'c1', true, false)])

    const live = applyLiveAttention(index, [tab('t1', 'a1', 'c1')], {})

    expect(live.conversations['a1|c1']).toEqual({ running: true, awaiting: false, unread: false })
  })

  it('does not mutate the index it is given', () => {
    const index = indexAttention([snapshotRow('a1', 'c1', true, false)])

    applyLiveAttention(index, [tab('t1', 'a1', 'c1')], { t1: summary(false, false) })

    expect(index.conversations['a1|c1']).toEqual({ running: true, awaiting: false, unread: false })
    expect(index.agents['a1']).toEqual({ running: true, awaiting: false, unread: false })
  })
})

describe('sessionAttention', () => {
  it('falls back to the row turn flag before the snapshot lands', () => {
    const index = indexAttention([])

    expect(sessionAttention(index, 'a1', sessionRow('c1', true))).toEqual({ running: true, awaiting: false, unread: false })
    expect(sessionAttention(index, 'a1', sessionRow('c2'))).toEqual({ running: false, awaiting: false, unread: false })
  })

  it('prefers the snapshot once it knows the conversation', () => {
    const index = indexAttention([snapshotRow('a1', 'c1', false, true)])

    expect(sessionAttention(index, 'a1', sessionRow('c1', true))).toEqual({ running: false, awaiting: true, unread: false })
  })

  it('carries the unread flag through to the row', () => {
    // The row renders exactly what this returns, so "unread" has to survive the
    // lookup: the index knows it, the row is where the user sees it.
    const read = { 'a1|c1': '2026-10-09T00:00:00Z' }
    const index = indexAttention(
      [{ ...snapshotRow('a1', 'c1', false, false), updated_at: '2026-10-09T00:00:10Z' }],
      read,
    )

    expect(sessionAttention(index, 'a1', sessionRow('c1'))).toEqual({ running: false, awaiting: false, unread: true })
  })

  it('has nothing but the row flag without an agent', () => {
    const index = indexAttention([snapshotRow('a1', 'c1', false, true)])

    // No agent means no key to look the conversation up by, so the row falls back
    // to its own turn flag (and cannot report waiting at all).
    expect(sessionAttention(index, null, sessionRow('c1', true))).toEqual({ running: true, awaiting: false, unread: false })
  })
})

describe('agentAttention', () => {
  it('reports what the snapshot knows about that agent', () => {
    const index = indexAttention([snapshotRow('a1', 'c1', true, false), snapshotRow('a1', 'c2', false, true)])

    expect(agentAttention(index, 'a1')).toEqual({ running: true, awaiting: true, unread: false })
  })

  it('reports nothing for an agent it does not know', () => {
    expect(agentAttention(indexAttention([]), 'a9')).toEqual({ running: false, awaiting: false, unread: false })
  })
})

describe('unread', () => {
  const older = '2026-10-09T00:00:00Z'
  const newer = '2026-10-09T00:00:10Z'

  function row(chatId: string, updatedAt: string) {
    return { ...snapshotRow('a1', chatId, false, false), updated_at: updatedAt }
  }

  it('marks a conversation that moved past the read mark', () => {
    const index = indexAttention([row('c1', newer)], { 'a1|c1': older })
    expect(index.conversations['a1|c1'].unread).toBe(true)
    expect(index.agents['a1'].unread).toBe(true)
  })

  it('does not mark a conversation at or before the read mark', () => {
    expect(indexAttention([row('c1', older)], { 'a1|c1': older }).conversations['a1|c1'].unread).toBe(false)
    expect(indexAttention([row('c1', older)], { 'a1|c1': newer }).conversations['a1|c1'].unread).toBe(false)
  })

  it('treats a conversation never read as read (the first snapshot is a baseline)', () => {
    expect(indexAttention([row('c1', newer)]).conversations['a1|c1'].unread).toBe(false)
  })

  it('ignores an unparseable or missing updated_at', () => {
    expect(indexAttention([row('c1', '')], { 'a1|c1': older }).conversations['a1|c1'].unread).toBe(false)
    expect(indexAttention([row('c1', 'not a date')], { 'a1|c1': older }).conversations['a1|c1'].unread).toBe(false)
  })

  it('clears unread for the conversation the browser is showing', () => {
    const index = indexAttention([row('c1', newer)], { 'a1|c1': older })
    const live = applyLiveAttention(index, [tab('t1', 'a1', 'c1')], { t1: summary(false, false) })
    expect(live.conversations['a1|c1'].unread).toBe(false)
  })

  it('nextReadAt fills the missing marks and keeps the existing ones', () => {
    const next = nextReadAt(
      [row('c1', newer), row('c2', older)],
      { 'a1|c1': older },
    )
    expect(next).toEqual({ 'a1|c1': older, 'a1|c2': older })
  })

  it('nextReadAt returns the same object when there is nothing to fill', () => {
    const previous = { 'a1|c1': newer }
    expect(nextReadAt([row('c1', newer)], previous)).toBe(previous)
  })
})
