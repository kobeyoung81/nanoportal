import { useEffect } from 'react'
import { getSession, clearSession } from '../lib/auth'
import { refreshAccessToken } from '../lib/api'
import { isRejection } from '../lib/sessionRace'
import { accessTokenExpiresAt, nextRefreshDelay } from '../lib/tokenExpiry'

// Keeps the access token alive without touching the refresh token more often
// than necessary: the token is renewed shortly before its `exp`, not on a fixed
// interval. Two tabs of the same browser therefore rarely rotate at all, and
// when they do the Web Lock in `api.ts` makes them take turns.
export function SessionRefresher() {
  useEffect(() => {
    let cancelled = false
    let timer = 0

    const schedule = () => {
      window.clearTimeout(timer)
      if (cancelled) {
        return
      }
      const session = getSession()
      if (!session?.refresh_token) {
        return
      }
      const delay = nextRefreshDelay(accessTokenExpiresAt(session.access_token), Date.now())
      timer = window.setTimeout(tick, delay)
    }

    const tick = () => {
      if (cancelled) {
        return
      }
      const session = getSession()
      if (!session?.refresh_token) {
        return
      }
      // Only renew once the token is inside the lead window. A tab that just
      // became visible again re-runs this, and usually only re-arms the timer.
      const expiresAt = accessTokenExpiresAt(session.access_token)
      const leadMs = 10 * 60 * 1000
      if (expiresAt !== null && expiresAt - Date.now() > leadMs) {
        schedule()
        return
      }
      void refreshAccessToken().then((outcome) => {
        if (cancelled || outcome.ok) {
          schedule()
          return
        }
        if (isRejection(outcome)) {
          clearSession()
          if (window.location.pathname !== '/login') {
            window.location.assign('/login')
          }
          return
        }
        if (outcome.reason === 'no-session') {
          return
        }
        // Transient (network, 5xx, deploy restart): keep the session and try
        // again — `schedule` floors an expired token at one minute.
        schedule()
      })
    }

    tick()

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        tick()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return null
}
