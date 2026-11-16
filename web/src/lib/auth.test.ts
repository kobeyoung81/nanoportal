import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSession, toStoredSession } from './auth'

// A minimal localStorage: the module under test only reads, writes and removes one
// key, and the test environment has no window.
function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
  }
}

const KEY = 'nanosec.portal.token'

let storage: ReturnType<typeof memoryStorage>

beforeEach(() => {
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

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

// The other half of the same rule: a session already in the browser.
describe('getSession', () => {
  it('returns a stored session that has a token', () => {
    storage.setItem(KEY, JSON.stringify({ access_token: 'a', user_id: 'u1', role: 'user' }))
    expect(getSession()?.user_id).toBe('u1')
  })

  it('drops a stored session that has no token, so the browser returns to the login screen', () => {
    // This is exactly what a sign-in page that forgot the token used to leave
    // behind: an identity with no credential. Keeping it means every request is
    // answered 401 while the shell still shows the console.
    storage.setItem(KEY, JSON.stringify({ user_id: 'u1', role: 'user' }))
    expect(getSession()).toBeNull()
    expect(storage.getItem(KEY)).toBeNull()
  })

  it('drops an empty token as well', () => {
    storage.setItem(KEY, JSON.stringify({ access_token: '', user_id: 'u1', role: 'user' }))
    expect(getSession()).toBeNull()
  })

  it('drops unparseable storage', () => {
    storage.setItem(KEY, '{not json')
    expect(getSession()).toBeNull()
    expect(storage.getItem(KEY)).toBeNull()
  })
})
