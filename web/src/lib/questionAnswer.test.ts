// The answer text one question sends back to the agent. The free-text field is
// the only place a user can answer outside the options, so what happens to it
// (trimmed, appended, never duplicated) is pinned here.
import { describe, expect, it } from 'vitest'
import { composeAnswer } from './questionAnswer'

describe('composeAnswer', () => {
  it('sends the picked labels in order', () => {
    expect(composeAnswer(['A', 'B'], '')).toBe('A, B')
  })

  it('appends the custom text after the picked labels', () => {
    expect(composeAnswer(['A'], 'something else')).toBe('A, something else')
  })

  it('sends the custom text alone when nothing was picked', () => {
    expect(composeAnswer([], 'just text')).toBe('just text')
  })

  it('trims the custom text and ignores one that is only whitespace', () => {
    expect(composeAnswer(['A'], '  spaced  ')).toBe('A, spaced')
    expect(composeAnswer(['A'], '   ')).toBe('A')
  })

  it('does not repeat a label the custom text already matches', () => {
    expect(composeAnswer(['A', 'B'], 'B')).toBe('A, B')
  })

  it('sends an empty string when the user answered nothing', () => {
    expect(composeAnswer([], '')).toBe('')
  })
})
