import { describe, expect, it } from 'vitest'
import { handshakeVerdict, resumeIDFor } from './sessionResume'

describe('resumeIDFor', () => {
  it('prefers the session the socket is actually running', () => {
    expect(resumeIDFor('web:live', 'web:from-mount')).toBe('web:live')
  })

  it('falls back to the prop before the first ready arrives', () => {
    expect(resumeIDFor(null, 'web:from-mount')).toBe('web:from-mount')
  })

  it('sends no session for a conversation the server has not named yet', () => {
    expect(resumeIDFor(null, null)).toBeUndefined()
  })
})

describe('handshakeVerdict', () => {
  it('treats a session the store does not know as gone', () => {
    expect(handshakeVerdict('session not found')).toBe('gone')
  })

  it('keeps a network or upstream failure retryable', () => {
    expect(handshakeVerdict('Failed to fetch')).toBe('unreachable')
    expect(handshakeVerdict('upstream unavailable: dial tcp: connection refused')).toBe('unreachable')
    expect(handshakeVerdict(undefined)).toBe('unreachable')
  })
})
