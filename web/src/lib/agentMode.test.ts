// The composer's build/plan switch is per conversation, and the conversation's
// own answer lives in the session it belongs to: nanosec records the session
// agent every turn ran as `_session_agent` in the session meta, carries it
// across a compaction handoff and drops it on /new. A per-agent pick in
// localStorage could not do that (two conversations of one agent shared one
// value, and another device knew nothing), so the mapping between that meta
// value and a mode is pinned here.
import { describe, expect, it } from 'vitest'
import { conversationModeOf, defaultModeOf, resolveAgentMode } from './agentMode'

describe('conversationModeOf', () => {
  it('maps the two platform session agents', () => {
    expect(conversationModeOf('plan')).toBe('plan')
    expect(conversationModeOf('build')).toBe('build')
  })

  it('is "no answer" for an absent or unknown session agent', () => {
    // A session that has not run a turn yet carries no key; an id this client
    // does not know is not a mode either. Both must fall back to the agent's
    // default — mapping them to build would silently override a plan-default
    // agent.
    expect(conversationModeOf(undefined)).toBeNull()
    expect(conversationModeOf(null)).toBeNull()
    expect(conversationModeOf('')).toBeNull()
    expect(conversationModeOf('general')).toBeNull()
    expect(conversationModeOf('PLAN')).toBeNull()
  })
})

describe('defaultModeOf', () => {
  it('is plan only for an agent configured that way', () => {
    expect(defaultModeOf('plan')).toBe('plan')
    expect(defaultModeOf('build')).toBe('build')
    expect(defaultModeOf(undefined)).toBe('build')
    expect(defaultModeOf('')).toBe('build')
  })
})

describe('resolveAgentMode', () => {
  it('shows the pick made in this pane', () => {
    expect(resolveAgentMode('plan', 'build', 'build')).toBe('plan')
    expect(resolveAgentMode('build', 'plan', 'plan')).toBe('build')
  })

  it('shows the conversation mode when this pane has no pick', () => {
    // Composed as the pane composes it: the conversation's answer comes from the
    // session's `_session_agent` through the mapping, not as a literal.
    expect(resolveAgentMode(null, conversationModeOf('plan'), defaultModeOf('build'))).toBe('plan')
    // A conversation that ran in build is build even when the agent defaults to
    // plan: the conversation's own history wins over the configured default.
    expect(resolveAgentMode(null, conversationModeOf('build'), defaultModeOf('plan'))).toBe('build')
  })

  it('falls back to the agent default when nothing else is known', () => {
    expect(resolveAgentMode(null, null, 'plan')).toBe('plan')
    expect(resolveAgentMode(null, null, 'build')).toBe('build')
  })
})
