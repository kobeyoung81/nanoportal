// The composer's trailing button: mic, send, stop, or busy.
import { describe, expect, it } from 'vitest'
import { trailingAction, type TrailingActionInput } from './trailingAction'

function input(overrides: Partial<TrailingActionInput> = {}): TrailingActionInput {
  return {
    working: false,
    voice: 'idle',
    voiceAvailable: true,
    hasDraft: false,
    hasAttachments: false,
    ...overrides,
  }
}

describe('trailingAction', () => {
  it('offers the microphone on an empty composer with voice available', () => {
    expect(trailingAction(input())).toBe('mic')
  })

  it('swaps to Send as soon as there is text', () => {
    expect(trailingAction(input({ hasDraft: true }))).toBe('send')
  })

  it('keeps Send reachable when only an attachment is staged', () => {
    // An image with no caption must still be sendable.
    expect(trailingAction(input({ hasAttachments: true }))).toBe('send')
  })

  it('never offers the microphone when the platform has no voice', () => {
    expect(trailingAction(input({ voiceAvailable: false }))).toBe('send')
  })

  it('shows Stop while the agent works, even on an empty composer', () => {
    expect(trailingAction(input({ working: true }))).toBe('stop-turn')
  })

  it('holds the microphone while connecting and recording', () => {
    expect(trailingAction(input({ voice: 'connecting' }))).toBe('mic-active')
    expect(trailingAction(input({ voice: 'recording' }))).toBe('mic-active')
  })

  it('does not let live dictation text turn the button into Send', () => {
    // The transcript streams into the box while the user is still holding the
    // button; the slot must stay the microphone until the session ends.
    expect(trailingAction(input({ voice: 'recording', hasDraft: true }))).toBe('mic-active')
  })

  it('shows a spinner while the transcript is finalized and polished', () => {
    expect(trailingAction(input({ voice: 'finalizing' }))).toBe('spinner')
    // The batch pass owns the slot the same way the polish pass does: the take
    // is not over until it lands.
    expect(trailingAction(input({ voice: 'refining' }))).toBe('spinner')
    expect(trailingAction(input({ voice: 'polishing' }))).toBe('spinner')
  })

  it('keeps the dictation control while a lost session is being continued', () => {
    // The user can still stop a dictation whose session is being replaced.
    expect(trailingAction(input({ voice: 'reconnecting', hasDraft: true }))).toBe('mic-active')
  })

  it('returns to the microphone once dictation ends', () => {
    // After a result the box holds the text, so the slot is Send again; this
    // pins the handover rather than the intermediate state.
    expect(trailingAction(input({ voice: 'idle', hasDraft: false }))).toBe('mic')
  })
})
