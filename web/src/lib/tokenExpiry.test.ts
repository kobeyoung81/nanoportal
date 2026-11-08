import { describe, expect, it } from 'vitest'

import { accessTokenExpiresAt, nextRefreshDelay } from './tokenExpiry'

// Build a token-shaped string with a given payload. The signature is bogus on
// purpose: nothing in this module verifies it.
function tokenWith(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value))
    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.signature`
}

describe('accessTokenExpiresAt', () => {
  it('reads the exp claim as a millisecond timestamp', () => {
    const token = tokenWith({ sub: 'user-1', exp: 1_800_000_000 })
    expect(accessTokenExpiresAt(token)).toBe(1_800_000_000_000)
  })

  it('decodes a payload that carries non-ASCII text', () => {
    const token = tokenWith({ name: '张 三', exp: 1_700_000_000 })
    expect(accessTokenExpiresAt(token)).toBe(1_700_000_000_000)
  })

  it('returns null for a missing, malformed or exp-less token', () => {
    expect(accessTokenExpiresAt(undefined)).toBeNull()
    expect(accessTokenExpiresAt(null)).toBeNull()
    expect(accessTokenExpiresAt('')).toBeNull()
    expect(accessTokenExpiresAt('not-a-jwt')).toBeNull()
    expect(accessTokenExpiresAt('header.%%%.signature')).toBeNull()
    expect(accessTokenExpiresAt(tokenWith({ sub: 'user-1' }))).toBeNull()
    expect(accessTokenExpiresAt(tokenWith({ exp: 'soon' }))).toBeNull()
  })
})

describe('nextRefreshDelay', () => {
  it('renews the token a lead time before it expires', () => {
    const now = 1_000_000
    const expiresAt = now + 12 * 60 * 60 * 1000
    // jitter 0 keeps the assertion exact.
    expect(nextRefreshDelay(expiresAt, now, { jitterMs: 0 })).toBe(expiresAt - now - 10 * 60 * 1000)
  })

  it('retries soon when the token is already inside the lead window', () => {
    const now = 1_000_000
    expect(nextRefreshDelay(now + 60_000, now, { jitterMs: 0 })).toBe(60_000)
    expect(nextRefreshDelay(now - 5 * 60_000, now, { jitterMs: 0 })).toBe(60_000)
  })

  it('falls back to a fixed interval when exp is unreadable', () => {
    expect(nextRefreshDelay(null, 1_000_000, { jitterMs: 0 })).toBe(30 * 60 * 1000)
    expect(nextRefreshDelay(null, 1_000_000, { jitterMs: 0, fallbackMs: 5 * 60 * 1000 })).toBe(5 * 60 * 1000)
  })

  it('keeps jitter inside the configured band and never below the minimum', () => {
    const now = 1_000_000
    const expiresAt = now + 4 * 60 * 1000
    for (let i = 0; i < 50; i++) {
      const delay = nextRefreshDelay(expiresAt, now, { jitterMs: 120_000, minMs: 30_000 })
      // Base is clamped to the minimum, so the band is [min, min + jitter].
      expect(delay).toBeGreaterThanOrEqual(30_000)
      expect(delay).toBeLessThanOrEqual(150_000)
    }
  })
})
