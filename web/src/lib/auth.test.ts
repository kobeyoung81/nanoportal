import { describe, expect, it } from 'vitest'
import { toStoredSession } from './auth'

// The login and registration pages sign in through the shell (`features.signIn`).
// A snapshot that carries the identity but not the tokens is not a session: the
// shell stored it as-is once, which left the browser "signed in" with no
// credential and every request answered 401.
describe('toStoredSession', () => {
  it('keeps the tokens the sign-in issued', () => {
    const session = toStoredSession({
      user_id: 'u1',
      role: 'admin',
      display_name: 'Ada',
      access_token: 'access',
      refresh_token: 'refresh',
    })
    expect(session).toEqual({
      access_token: 'access',
      refresh_token: 'refresh',
      user_id: 'u1',
      role: 'admin',
      display_name: 'Ada',
      must_change_password: undefined,
    })
  })

  it('refuses a snapshot without an access token', () => {
    expect(toStoredSession({ user_id: 'u1', role: 'user' })).toBeNull()
  })

  it('defaults the role rather than storing an empty one', () => {
    expect(toStoredSession({ user_id: 'u1', access_token: 'a' })?.role).toBe('user')
  })
})
