// The "restore the built-in prompt" button is an immediate write, not part of
// the draft — so it may only appear where the bus has something to restore. A
// type with no bundled prompt answers 404, and a prompt that already is the
// bundle has nothing to do.
import { describe, expect, it } from 'vitest'
import { canResetPrompt, type AgentPromptStatus } from './promptStatus'

const status = (source: AgentPromptStatus['source']): AgentPromptStatus => ({
  id: 'role_explore',
  source,
  stored_version: 2,
  bundled_version: 2,
})

describe('canResetPrompt', () => {
  it('offers the reset when the stored text is not the bundled text', () => {
    for (const source of ['edited', 'stale', 'empty'] as const) {
      expect(canResetPrompt(status(source))).toBe(true)
    }
  })

  it('hides it when there is nothing to restore', () => {
    expect(canResetPrompt(status('bundled'))).toBe(false)
    expect(canResetPrompt(status('none'))).toBe(false)
  })

  it('hides it when the baseline has not loaded', () => {
    expect(canResetPrompt(undefined)).toBe(false)
  })
})
