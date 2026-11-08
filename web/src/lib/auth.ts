import { purgeListCache } from './listCache'
import { adoptLegacyState, setCurrentUser } from './clientState'

export type Session = {
  access_token: string
  refresh_token?: string
  user_id: string
  role: string
  display_name?: string
  must_change_password?: boolean
}

const TOKEN_KEY = 'nanosec.portal.token'

export function getSession(): Session | null {
  const raw = localStorage.getItem(TOKEN_KEY)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as Session
  } catch {
    localStorage.removeItem(TOKEN_KEY)
    return null
  }
}

export function getToken(): string | null {
  return getSession()?.access_token ?? null
}

export function setSession(session: Session): void {
  const previous = getSession()
  const signedInAsAnother = previous !== null && previous.user_id !== session.user_id
  if (signedInAsAnother) {
    // Another account is signing in on this browser: drop the previous user's
    // cached agent/conversation lists before anything can read them.
    purgeListCache()
  }
  localStorage.setItem(TOKEN_KEY, JSON.stringify(session))
  // Every path that establishes a session (sign-in, registration, a token
  // refresh) tells the client-state module whose state this tab reads. The first
  // account to sign in after the upgrade adopts whatever the browser held before
  // keys were namespaced; the guard makes that a one-off, not a per-refresh scan.
  if (signedInAsAnother || previous === null) {
    adoptLegacyState(session.user_id)
  }
  setCurrentUser(session.user_id)
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY)
  // The list snapshot is per user; signing out must not leave it on a shared
  // browser. Someone's tabs, layout and preferences stay in their own namespace —
  // signing back in is what brings them back. Message transcripts are never
  // persisted, so there is nothing else to drop.
  purgeListCache()
  setCurrentUser(null)
}
