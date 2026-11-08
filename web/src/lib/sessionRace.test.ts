import { describe, expect, it } from 'vitest'

import { isRejection, refreshTokenChanged } from './sessionRace'

describe('refreshTokenChanged', () => {
  it('detects that another tab rotated the ticket', () => {
    expect(refreshTokenChanged('T1', { refresh_token: 'T2' })).toBe(true)
  })

  it('reports no change when the same ticket is still stored', () => {
    expect(refreshTokenChanged('T1', { refresh_token: 'T1' })).toBe(false)
  })

  it('reports no change for a session that is gone or has no ticket', () => {
    // Nothing to adopt: a signed-out tab must not be resurrected by a stale refresh.
    expect(refreshTokenChanged('T1', null)).toBe(false)
    expect(refreshTokenChanged('T1', {})).toBe(false)
  })
})

describe('isRejection', () => {
  it('accepts a successful refresh', () => {
    expect(isRejection({ ok: true })).toBe(false)
  })

  it('treats a server refusal as a rejection', () => {
    expect(isRejection({ ok: false, reason: 'rejected' })).toBe(true)
  })

  it('never signs the user out for a transient failure', () => {
    // This is the deploy-restart case: the portal is briefly unreachable.
    expect(isRejection({ ok: false, reason: 'transient' })).toBe(false)
    expect(isRejection({ ok: false, reason: 'no-session' })).toBe(false)
  })
})
