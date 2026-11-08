// When the access token runs out, and when to renew it.
//
// Only the `exp` claim is read, and only to schedule a refresh: nothing here is
// used for authorisation, so the signature is deliberately not verified. A
// token that is not a JWT (or has no usable `exp`) falls back to a fixed
// interval.

export type RefreshSchedule = {
  /** How long before expiry to renew. */
  leadMs?: number
  /** Interval used when `exp` cannot be read. */
  fallbackMs?: number
  /** Random spread added to (or subtracted from) the delay, so tabs do not fire together. */
  jitterMs?: number
  /** Lower bound for a single delay; an already-expired token retries this soon. */
  minMs?: number
}

const DEFAULT_LEAD_MS = 10 * 60 * 1000
const DEFAULT_FALLBACK_MS = 30 * 60 * 1000
const DEFAULT_JITTER_MS = 2 * 60 * 1000
const DEFAULT_MIN_MS = 60 * 1000

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

// accessTokenExpiresAt returns the token's expiry as a millisecond timestamp, or
// null when the payload cannot be read.
export function accessTokenExpiresAt(token: string | null | undefined): number | null {
  if (!token) {
    return null
  }
  const parts = token.split('.')
  if (parts.length < 2) {
    return null
  }
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as { exp?: unknown }
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= 0) {
      return null
    }
    return payload.exp * 1000
  } catch {
    return null
  }
}

// nextRefreshDelay returns how long to wait before the next refresh.
export function nextRefreshDelay(expiresAt: number | null, now: number, schedule: RefreshSchedule = {}): number {
  const leadMs = schedule.leadMs ?? DEFAULT_LEAD_MS
  const minMs = schedule.minMs ?? DEFAULT_MIN_MS
  const base =
    expiresAt === null
      ? (schedule.fallbackMs ?? DEFAULT_FALLBACK_MS)
      : Math.max(minMs, expiresAt - now - leadMs)

  const jitterMs = schedule.jitterMs ?? DEFAULT_JITTER_MS
  if (jitterMs <= 0) {
    return base
  }
  const offset = Math.round((Math.random() * 2 - 1) * jitterMs)
  return Math.max(minMs, base + offset)
}
