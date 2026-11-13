import { clearSession, getSession, getToken, setSession, type Session } from './auth'
import { isRejection, refreshTokenChanged, type RefreshOutcome } from './sessionRace'
import type { ConversationAttention } from '../conversations/attention'
import i18n from '../i18n'

export type AdminIdentity = {
  user_id: string
  display_name: string
  role: string
}

export type LabelValue = {
  label: string
  value: string
}

export type AlertSummary = {
  rule_id: string
  severity: string
  message: string
}

export type Overview = {
  system_health: string
  summary: {
    active_users: number
    running_agents: number
    pending_inbound: number
    pending_outbound: number
    active_containers: number
  }
  tier_distribution: Record<string, number>
  top_alerts: AlertSummary[]
}

export type ComponentSummary = {
  type: string
  display_name: string
  status: string
  detail: string
  metrics: LabelValue[]
  updated_at: string
}

export type ComponentDetail = {
  type: string
  display_name: string
  status: string
  description: string
  config_version: string
  updated_at: string
  metrics: LabelValue[]
  instances: {
    id: string
    name: string
    status: string
    last_seen_at: string
    detail: string
  }[]
}

export type UserSummary = {
  user_id: string
  display_name: string
  status: string
  tier: string
  role: string
  /** "ldap" when the account signs in through the corporate directory. */
  auth_source?: string
  channels: string[]
  agent_status: string
  last_activity_at: string
}

export type UserDetail = UserSummary & {
  override_scopes: string[]
  containers: {
    id: string
    status: string
    level: string
    updated_at: string
  }[]
  effective_config: Record<string, unknown>
}

export type ConfigSummary = {
  component_type: string
  updated_at: string
  source: string
}

export type ConfigDetail = {
  component_type: string
  updated_at: string
  config: Record<string, unknown>
}

export type AuditEntry = {
  id: number
  actor_id: string
  /** The actor's display name, resolved by the bus; absent when the account is gone. */
  actor_name?: string
  actor_role: string
  action: string
  resource_type: string
  resource_id: string
  /** The display name behind resource_id for agents, users and groups. */
  resource_name?: string
  detail: Record<string, unknown> | null
  ip: string
  created_at: string
}

export type AlertRule = {
  id: number
  severity: string
  message: string
  metric: string
  threshold: number
  enabled: boolean
}

export type AgentDetail = {
  id: string
  user_id: string
  /** The owner's private grouping for this agent; absent = ungrouped. */
  group_id?: string
  display_name: string
  description: string
  model: string
  status: string
  tools: string[]
  owner_display_name?: string
}

export type AgentInput = {
  user_id?: string
  type_id?: string
  display_name: string
  description?: string
  // The default session mode new conversations start in. Model, thinking,
  // runtime settings, permissions and capabilities are per (agent, mode) and
  // live behind the /agents/{id}/modes/{type} endpoints (see lib/capabilities).
  default_agent?: string
  /** Moves the agent into one of the caller's groups (absent = ungrouped). */
  group_id?: string
  // Per-agent platform settings. Present = replace the map ({} clears), so a
  // caller sends exactly the keys it owns.
  settings?: Record<string, string>
}

/** The effective value of one per-agent setting, and where it comes from. */
export type AgentSettingRead = {
  key: string
  /** What this agent itself sets ("" = it inherits). */
  agent_value: string
  /** What "inherit" currently resolves to on this deployment. */
  platform_default: string
  effective: string
  source: 'agent' | 'platform'
}

export async function readAgentSetting(agentID: string, key: string): Promise<AgentSettingRead> {
  return fetchJson<AgentSettingRead>(
    `/agents/${encodeURIComponent(agentID)}/settings/${encodeURIComponent(key)}`,
    USER_API_BASE,
  )
}

export type SessionSummary = {
  id: string
  agent_id: string
  account_id: string
  channel: string
  chat_id: string
  status: string
  title?: string
  message_count: number
  turn_running?: boolean
  created_at: string
  updated_at: string
}

export type SessionPage = {
  agent_id: string
  sessions: SessionSummary[]
  count: number
  total: number
  has_more: boolean
}

export type AgentSessionDetail = {
  session_id: string
  agent_id: string
  account_id: string
  channel: string
  chat_id: string
  status: string
  messages: string
  summary: string
  meta?: string
  turn_running?: boolean
  created_at: string
  updated_at: string
  total?: number
  before?: number
  has_more?: boolean
}

export type FileEntry = {
  name: string
  is_dir: boolean
  size?: number
  modified?: number
  /** Agent-managed runtime entry (sessions / cron.json / media). */
  runtime?: boolean
}

// File type classification lives in `fileTypes.ts` so it stays importable without
// a DOM (that module is pure; this one pulls in i18n and therefore `document`).
export {
  NANOWORK_EXTENSIONS,
  canOpenFile,
  classifyFileType,
  type FileKind,
} from './fileTypes'

export type FileListing = {
  agent_id: string
  path: string
  entries: FileEntry[]
}

// The console splits by owner: every module answers under /api/v1/<module>/,
// so admin-owned pages (configuration, catalogue, prompts, audit) use this base
// and portal-owned ones (users, containers, overview, logs, runners) use
// PORTAL_ADMIN_API_BASE. nginx does the routing; only it knows the split.
export const ADMIN_API_BASE = '/api/v1/admin'
// The portal's slice of the console, on its historical prefix.
export const PORTAL_ADMIN_API_BASE = '/api/admin/v1'
export const USER_API_BASE = '/api/user/v1'
// Files and git belong to nanoworkspace, which owns the routing and the tunnel
// to the agent container; the browser uses the target-state prefix.
export const WORKSPACE_API_BASE = '/api/v1/workspace'
// Identity is nanoauth's own API, reached straight from nginx: the portal is no
// longer part of the login path, so an unavailable console cannot lock users out.
// /api/v1/auth/ is the target-state prefix (nginx rewrites it to /auth/v1/); the
// older /api/auth/v1/ stays mounted for tabs opened before a deploy.
export const AUTH_API_BASE = '/api/v1/auth'

// Every tab of this browser shares one session in localStorage, while refresh
// tokens are single-use: the server revokes the ticket it was handed and issues
// a successor. Two tabs refreshing at the same moment therefore used to
// invalidate each other — the loser got a 401 and cleared the shared session,
// signing every tab out at once. Three rules prevent that now:
//
//  * refreshes are serialised across tabs with the Web Locks API;
//  * after taking the lock (and again after a failure) the stored session is
//    re-read: if its refresh token already changed, another tab rotated and its
//    result is adopted instead of asking for a second rotation;
//  * only a definitive 401 signs the user out — network and 5xx failures keep
//    the session (a portal restart during a deploy used to log everyone out).
const REFRESH_LOCK = 'nanosec.portal.refresh'
const REFRESH_LOCK_TIMEOUT_MS = 10_000

function signOut(): void {
  clearSession()
  if (window.location.pathname !== '/login') {
    window.location.assign('/login')
  }
}

async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks?.request) {
    // Older engines: fall back to an unlocked attempt. The post-failure re-read
    // below still stops a second tab from clearing a session it no longer owns.
    return fn()
  }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REFRESH_LOCK_TIMEOUT_MS)
  let locked = false
  try {
    return await locks.request(REFRESH_LOCK, { signal: controller.signal }, async () => {
      locked = true
      return fn()
    })
  } catch (err) {
    if (locked) {
      // The refresh itself failed; let the caller classify it.
      throw err
    }
    // Waiting timed out (a frozen tab still holds the lock): make one attempt.
    return fn()
  } finally {
    window.clearTimeout(timer)
  }
}

// Single-flight within this tab; the lock above serialises across tabs.
let refreshPromise: Promise<RefreshOutcome> | null = null

export async function refreshAccessToken(): Promise<RefreshOutcome> {
  if (refreshPromise) {
    return refreshPromise
  }
  const startedToken = getSession()?.refresh_token
  if (!startedToken) {
    return { ok: false, reason: 'no-session' }
  }
  refreshPromise = withRefreshLock(async (): Promise<RefreshOutcome> => {
    const current = getSession()
    if (!current?.refresh_token) {
      return { ok: false, reason: 'no-session' }
    }
    if (refreshTokenChanged(startedToken, current)) {
      // Another tab rotated while this one was queued for the lock.
      return { ok: true }
    }
    try {
      const auth = await refresh(current.refresh_token)
      const latest = getSession()
      // Only write back if this attempt still owns the stored session: a
      // sign-in or sign-out in the meantime must win.
      if (!latest || latest.refresh_token === current.refresh_token) {
        setSession({ ...sessionFromAuth(auth), refresh_token: auth.refresh_token ?? current.refresh_token })
      }
      return { ok: true }
    } catch (err) {
      if (refreshTokenChanged(current.refresh_token, getSession())) {
        // Refused because another tab already consumed the ticket, not because
        // the credentials are dead.
        return { ok: true }
      }
      return { ok: false, reason: isUnauthorizedError(err) ? 'rejected' : 'transient' }
    }
  })
  try {
    return await refreshPromise
  } catch {
    // Defensive: a failure outside the request itself (storage quota, a lock
    // API quirk) must still read as "try later", never as "signed out".
    return { ok: false, reason: 'transient' }
  } finally {
    refreshPromise = null
  }
}

function isUnauthorizedError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'status' in err && (err as { status?: unknown }).status === 401
}

// authorizedFetch performs an authenticated request, renewing the access token
// once on 401 and retrying. The session is cleared only when the server
// definitively refused the refresh ticket.
async function authorizedFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  const token = getToken()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  let response = await fetch(path, { ...init, headers })
  if (response.status === 401) {
    const outcome = await refreshAccessToken()
    if (outcome.ok) {
      const refreshed = getToken()
      if (refreshed) {
        headers.set('Authorization', `Bearer ${refreshed}`)
      }
      response = await fetch(path, { ...init, headers })
    } else if (isRejection(outcome) || outcome.reason === 'no-session') {
      signOut()
    }
  }
  return response
}

export async function fetchJson<T>(path: string, base = ADMIN_API_BASE): Promise<T> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const response = await authorizedFetch(`${base}${normalizedPath}`)
  if (!response.ok) {
    const payload = (await safeJson(response)) as { error?: string } | null
    console.warn('[api]', 'GET', `${base}${normalizedPath}`, response.status, payload?.error ?? '')
    throw new Error(payload?.error ?? i18n.t('errors.requestFailed', { status: response.status }))
  }
  return (await response.json()) as T
}

export async function postJson<T>(
  path: string,
  body: unknown,
  base = ADMIN_API_BASE,
  signal?: AbortSignal,
): Promise<T> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const response = await authorizedFetch(`${base}${normalizedPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    const payload = (await safeJson(response)) as { error?: string } | null
    console.warn('[api]', 'POST', `${base}${normalizedPath}`, response.status, payload?.error ?? '')
    throw new Error(payload?.error ?? i18n.t('errors.requestFailed', { status: response.status }))
  }
  return (await response.json()) as T
}

export async function deleteJson<T>(path: string, base = ADMIN_API_BASE): Promise<T> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const response = await authorizedFetch(`${base}${normalizedPath}`, { method: 'DELETE' })
  if (!response.ok) {
    const payload = (await safeJson(response)) as { error?: string } | null
    console.warn('[api]', 'DELETE', `${base}${normalizedPath}`, response.status, payload?.error ?? '')
    throw new Error(payload?.error ?? i18n.t('errors.requestFailed', { status: response.status }))
  }
  return (await response.json()) as T
}

export async function putJson<T>(path: string, body: unknown, base = ADMIN_API_BASE): Promise<T> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const response = await authorizedFetch(`${base}${normalizedPath}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const payload = (await safeJson(response)) as { error?: string } | null
    throw new Error(payload?.error ?? i18n.t('errors.requestFailed', { status: response.status }))
  }
  return (await response.json()) as T
}

export async function patchJson<T>(path: string, body: unknown, base = ADMIN_API_BASE): Promise<T> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const response = await authorizedFetch(`${base}${normalizedPath}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const payload = (await safeJson(response)) as { error?: string } | null
    console.warn('[api]', 'PATCH', `${base}${normalizedPath}`, response.status, payload?.error ?? '')
    throw new Error(payload?.error ?? i18n.t('errors.requestFailed', { status: response.status }))
  }
  return (await response.json()) as T
}

// --- User management (Operations section) ------------------------------------

export async function updateUserRole(userID: string, role: string): Promise<{ user_id: string; role: string }> {
  return patchJson(`/users/${encodeURIComponent(userID)}/role`, { role }, PORTAL_ADMIN_API_BASE)
}

export async function updateUserTier(userID: string, tier: string): Promise<{ user_id: string; tier: string }> {
  return patchJson(`/users/${encodeURIComponent(userID)}/tier`, { tier }, PORTAL_ADMIN_API_BASE)
}

export async function freezeUser(userID: string): Promise<{ user_id: string; status: string }> {
  return postJson(`/users/${encodeURIComponent(userID)}/freeze`, {}, PORTAL_ADMIN_API_BASE)
}

export async function unfreezeUser(userID: string): Promise<{ user_id: string; status: string }> {
  return postJson(`/users/${encodeURIComponent(userID)}/unfreeze`, {}, PORTAL_ADMIN_API_BASE)
}

export async function restoreUser(userID: string): Promise<{ user_id: string; status: string }> {
  return postJson(`/users/${encodeURIComponent(userID)}/restore`, {}, PORTAL_ADMIN_API_BASE)
}

export async function deleteUser(userID: string): Promise<{ user_id: string; status: string }> {
  return deleteJson(`/users/${encodeURIComponent(userID)}`, PORTAL_ADMIN_API_BASE)
}

export async function resetUserPassword(
  userID: string,
): Promise<{ user_id: string; temp_password: string }> {
  return postJson(`/users/${encodeURIComponent(userID)}/reset-password`, {}, PORTAL_ADMIN_API_BASE)
}

export type AuthResponse = {
  access_token: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  user_id: string
  display_name?: string
  role: string
  tier?: string
  must_change_password?: boolean
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`${AUTH_API_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) {
    const payload = (await safeJson(response)) as { error?: string; code?: string } | null
    throw new Error(loginErrorMessage(payload, response.status))
  }
  return (await response.json()) as AuthResponse
}

/**
 * loginErrorMessage prefers the server's stable code over its English text, so a
 * directory outage reads as a directory problem rather than a wrong password.
 */
function loginErrorMessage(payload: { error?: string; code?: string } | null, status: number): string {
  switch (payload?.code) {
    case 'directory_unavailable':
      return i18n.t('errors.directoryUnavailable')
    case 'account_not_provisioned':
      return i18n.t('errors.accountNotProvisioned')
    case 'account_conflict':
      return i18n.t('errors.accountConflict')
    case 'account_disabled':
      return i18n.t('errors.accountDisabled')
  }
  return payload?.error ?? i18n.t('errors.loginFailed', { status })
}

export async function register(input: {
  email: string
  password: string
  display_name?: string
}): Promise<AuthResponse> {
  const response = await fetch(`${AUTH_API_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const payload = (await safeJson(response)) as { error?: string } | null
    throw new Error(payload?.error ?? i18n.t('errors.registerFailed', { status: response.status }))
  }
  return (await response.json()) as AuthResponse
}

export class RefreshError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'RefreshError'
    this.status = status
  }
}

export async function refresh(refreshToken: string): Promise<AuthResponse> {
  const response = await fetch(`${AUTH_API_BASE}/token/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
  if (!response.ok) {
    const payload = (await safeJson(response)) as { error?: string } | null
    throw new RefreshError(
      payload?.error ?? i18n.t('errors.refreshFailed', { status: response.status }),
      response.status,
    )
  }
  return (await response.json()) as AuthResponse
}

// logout revokes the refresh token server-side. It is best-effort: the caller
// clears the local session regardless of the result.
export async function logout(): Promise<void> {
  const session = getSession()
  if (!session?.refresh_token) {
    return
  }
  try {
    await fetch(`${AUTH_API_BASE}/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    })
  } catch {
    // ignore — the local session is cleared by the caller
  }
}

export function sessionFromAuth(auth: AuthResponse): Session {
  return {
    access_token: auth.access_token,
    refresh_token: auth.refresh_token,
    user_id: auth.user_id,
    role: auth.role,
    display_name: auth.display_name,
    must_change_password: auth.must_change_password,
  }
}

// changeMyPassword rotates the signed-in user's password and clears the
// forced-change flag set by an admin password reset.
export async function changeMyPassword(currentPassword: string, newPassword: string): Promise<void> {
  await postJson<{ status: string }>(
    '/me/password',
    { current_password: currentPassword, new_password: newPassword },
    USER_API_BASE,
  )
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export async function disposeContainer(userID: string): Promise<{ status: string }> {
  return postJson<{ status: string }>(
    `/containers/${encodeURIComponent(userID)}/dispose`,
    {},
    ADMIN_API_BASE,
  )
}

export async function restartContainer(userID: string): Promise<{ status: string }> {
  return postJson<{ status: string }>(
    `/containers/${encodeURIComponent(userID)}/restart`,
    {},
    ADMIN_API_BASE,
  )
}

// reprovisionContainer revives a disposed/failed container request so a fresh
// container is provisioned without requiring user chat traffic.
export async function reprovisionContainer(userID: string): Promise<{ status: string }> {
  return postJson<{ status: string }>(
    `/containers/${encodeURIComponent(userID)}/reprovision`,
    {},
    ADMIN_API_BASE,
  )
}

export async function createAgent(input: AgentInput): Promise<{ id: string; status: string }> {
  return postJson<{ id: string; status: string }>('/agents', input, USER_API_BASE)
}

export async function updateAgent(agentID: string, input: AgentInput): Promise<{ id: string; status: string }> {
  return putJson<{ id: string; status: string }>(`/agents/${encodeURIComponent(agentID)}`, input, USER_API_BASE)
}

export async function deleteAgent(agentID: string): Promise<{ id: string; status: string }> {
  return deleteJson<{ id: string; status: string }>(`/agents/${encodeURIComponent(agentID)}`, USER_API_BASE)
}

export async function provisionAgent(agentID: string): Promise<{ id: string; status: string }> {
  return postJson<{ id: string; status: string }>(`/agents/${encodeURIComponent(agentID)}/provision`, {}, USER_API_BASE)
}

export async function restartAgent(agentID: string): Promise<{ id: string; status: string }> {
  return postJson<{ id: string; status: string }>(`/agents/${encodeURIComponent(agentID)}/restart`, {}, USER_API_BASE)
}

export async function restoreAgent(agentID: string): Promise<{ id: string; status: string }> {
  return postJson<{ id: string; status: string }>(`/agents/${encodeURIComponent(agentID)}/restore`, {}, USER_API_BASE)
}

export type RunnerSummary = {
  id: string
  hostname: string
  docker_host: string
  status: string
  last_heartbeat: string
  registered_at: string
}

export type ConversationSummary = {
  id: string
  agent_id: string
  /** The agent's display name, resolved by the bus. */
  agent_name?: string
  account_id: string
  /** The owning account's display name, resolved by the bus. */
  account_name?: string
  channel: string
  chat_id: string
  status: string
  message_count: number
  /** Serialized size of the stored conversation, maintained on every save. */
  messages_bytes: number
  updated_at: string
}

export type ConversationDetail = ConversationSummary & {
  summary: string
  messages: unknown
}

export type RuntimeContainer = {
  user_id: string
  level: string
  status: string
  runner_id: string
  updated_at: string
}

export type RuntimeAgent = {
  id: string
  user_id: string
  display_name: string
  status: string
  updated_at: string
}

export type RuntimeSnapshot = {
  containers: RuntimeContainer[]
  agents: RuntimeAgent[]
  runners: RunnerSummary[]
}

export async function listRunners(): Promise<RunnerSummary[]> {
  return fetchJson<RunnerSummary[]>('/runners', PORTAL_ADMIN_API_BASE)
}

export async function deleteRunner(id: string): Promise<{ id: string; status: string }> {
  return deleteJson<{ id: string; status: string }>(`/runners/${encodeURIComponent(id)}`, PORTAL_ADMIN_API_BASE)
}

export async function listAgentSessions(
  agentID: string,
  opts?: { limit?: number; offset?: number },
): Promise<SessionPage> {
  const params = new URLSearchParams()
  if (opts?.limit) {
    params.set('limit', String(opts.limit))
  }
  if (opts?.offset) {
    params.set('offset', String(opts.offset))
  }
  const qs = params.toString()
  return fetchJson<SessionPage>(
    `/agents/${encodeURIComponent(agentID)}/sessions${qs ? `?${qs}` : ''}`,
    USER_API_BASE,
  )
}

/**
 * Reads every conversation's attention state (running / waiting for the user)
 * for the caller's agents in one request. The sidebar needs it because neither
 * the session list nor the browser can see, on its own, an agent it never
 * fetched or a conversation that is blocked on a question.
 */
export async function listAgentAttention(): Promise<ConversationAttention[]> {
  const body = await fetchJson<{ conversations: ConversationAttention[] }>('/agents/attention', USER_API_BASE)
  return body.conversations ?? []
}

/** The outcome of a conditional history read. `notModified` means the stored
 * conversation is unchanged since the validator was issued, so the caller can
 * keep the copy it already parsed. */
export type AgentSessionRead =
  | { notModified: true }
  | { notModified: false; detail: AgentSessionDetail; etag?: string }

/**
 * Reads one session, optionally conditionally. Unlike fetchJson this treats 304
 * as a normal outcome rather than an error, and hands back the ETag the next
 * call can send as `If-None-Match`.
 */
export async function readAgentSession(
  sessionID: string,
  opts?: { limit?: number; before?: number; etag?: string },
): Promise<AgentSessionRead> {
  const params = new URLSearchParams()
  if (opts?.limit) {
    params.set('limit', String(opts.limit))
  }
  if (opts?.before !== undefined) {
    params.set('before', String(opts.before))
  }
  const qs = params.toString()
  const headers: Record<string, string> = {}
  if (opts?.etag) {
    headers['If-None-Match'] = opts.etag
  }
  const response = await authorizedFetch(
    `${USER_API_BASE}/sessions/${encodeURIComponent(sessionID)}${qs ? `?${qs}` : ''}`,
    { headers },
  )
  if (response.status === 304) {
    return { notModified: true }
  }
  if (!response.ok) {
    const payload = (await safeJson(response)) as { error?: string } | null
    throw new Error(payload?.error ?? i18n.t('errors.requestFailed', { status: response.status }))
  }
  const detail = (await response.json()) as AgentSessionDetail
  return { notModified: false, detail, etag: response.headers.get('ETag') ?? undefined }
}

/**
 * Reads a session's metadata only. The turn-end reconciliation uses this instead
 * of the history page: a few KB instead of the whole transcript, and the server
 * answers without reading the messages blob.
 */
export async function readAgentSessionMeta(sessionID: string): Promise<AgentSessionDetail> {
  return fetchJson<AgentSessionDetail>(
    `/sessions/${encodeURIComponent(sessionID)}?meta=1`,
    USER_API_BASE,
  )
}

export async function archiveAgentSession(sessionID: string): Promise<{ status: string }> {
  return deleteJson<{ status: string }>(`/sessions/${encodeURIComponent(sessionID)}`, USER_API_BASE)
}

// --- Self-service (user namespace) ---

export async function getMeDetail(): Promise<UserDetail> {
  return fetchJson<UserDetail>('/me/detail', USER_API_BASE)
}

export async function listMeAgents(): Promise<AgentDetail[]> {
  return fetchJson<AgentDetail[]>('/me/agents', USER_API_BASE)
}

export async function restartMeContainer(): Promise<{ status: string }> {
  return postJson<{ status: string }>('/me/container/restart', {}, USER_API_BASE)
}

// --- Agent files (user namespace) ---

// fileListingPath is the directory-listing URL, spelled in one place so the
// panel's own fetch and its "is this directory still there?" probe cannot drift
// apart. An empty path is the agent's home.
export function fileListingPath(agentID: string, path: string): string {
  return `/files/${encodeURIComponent(agentID)}${path ? `?path=${encodeURIComponent(path)}` : ''}`
}

export async function listFiles(agentID: string, path: string): Promise<FileListing> {
  return fetchJson<FileListing>(fileListingPath(agentID, path), WORKSPACE_API_BASE)
}

export async function downloadFile(agentID: string, path: string): Promise<Blob> {
  const query = `?path=${encodeURIComponent(path)}`
  const response = await authorizedFetch(`${WORKSPACE_API_BASE}/files/${encodeURIComponent(agentID)}/content${query}`)
  if (!response.ok) {
    const payload = (await safeJson(response)) as { error?: string } | null
    throw new Error(payload?.error ?? i18n.t('errors.downloadFailed', { status: response.status }))
  }
  return response.blob()
}

// readTextFile reads a small text file from an agent's home (e.g. the
// scheduler's agent/cron.json). A missing file is null, not an error: an agent
// that has never written the file is a normal state the caller renders as
// "nothing yet", while a failed read must still surface.
export async function readTextFile(agentID: string, path: string): Promise<string | null> {
  const query = `?path=${encodeURIComponent(path)}`
  const response = await authorizedFetch(`${WORKSPACE_API_BASE}/files/${encodeURIComponent(agentID)}/content${query}`)
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    const payload = (await safeJson(response)) as { error?: string } | null
    throw new Error(payload?.error ?? i18n.t('errors.downloadFailed', { status: response.status }))
  }
  return response.text()
}

export async function uploadFile(agentID: string, path: string, body: Blob): Promise<{ status: string }> {
  const query = `?path=${encodeURIComponent(path)}`
  const response = await authorizedFetch(`${WORKSPACE_API_BASE}/files/${encodeURIComponent(agentID)}/content${query}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
  })
  if (!response.ok) {
    const payload = (await safeJson(response)) as { error?: string } | null
    throw new Error(payload?.error ?? i18n.t('errors.uploadFailed', { status: response.status }))
  }
  return (await response.json()) as { status: string }
}

export async function deleteFile(agentID: string, path: string): Promise<{ status: string }> {
  const query = `?path=${encodeURIComponent(path)}`
  const response = await authorizedFetch(`${WORKSPACE_API_BASE}/files/${encodeURIComponent(agentID)}/content${query}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    const payload = (await safeJson(response)) as { error?: string } | null
    throw new Error(payload?.error ?? i18n.t('errors.deleteFailed', { status: response.status }))
  }
  return (await response.json()) as { status: string }
}

// createFolder creates a directory (and any missing parents) inside an
// agent's files.
export async function createFolder(agentID: string, path: string): Promise<{ status: string }> {
  return postJson<{ status: string }>(
    `/files/${encodeURIComponent(agentID)}/mkdir?path=${encodeURIComponent(path)}`,
    {},
    WORKSPACE_API_BASE,
  )
}

// renameEntry renames (or moves) a file entry from `from` to `to`.
export async function renameEntry(agentID: string, from: string, to: string): Promise<{ status: string }> {
  return postJson<{ status: string }>(
    `/files/${encodeURIComponent(agentID)}/rename?path=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    {},
    WORKSPACE_API_BASE,
  )
}

// copyEntry copies a file entry (recursively for directories) from
// `from` to `to`.
export async function copyEntry(agentID: string, from: string, to: string): Promise<{ status: string }> {
  return postJson<{ status: string }>(
    `/files/${encodeURIComponent(agentID)}/copy?path=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    {},
    WORKSPACE_API_BASE,
  )
}

// fetchFileText downloads a file and returns its text
// content (used by the file viewer/editor).
export async function fetchFileText(agentID: string, path: string): Promise<string> {
  const blob = await downloadFile(agentID, path)
  return blob.text()
}

// ---- Agent terminals (hypervisor PTY sessions) ----

export type TerminalSessionInfo = {
  terminal_id: string
  agent_id: string
  created_at: number
}

// TerminalAttachment carries the PTY id and a base64 ring-buffer snapshot used
// to replay the visible screen on (re)attach.
export type TerminalAttachment = {
  terminal_id: string
  replay?: string
}

export async function listTerminals(agentId: string): Promise<TerminalSessionInfo[]> {
  const data = await fetchJson<{ terminals: TerminalSessionInfo[] }>(
    `/agents/${encodeURIComponent(agentId)}/terminals`,
    USER_API_BASE,
  )
  return data.terminals ?? []
}

export async function attachTerminal(
  agentId: string,
  body: { terminal_id?: string; cols?: number; rows?: number },
): Promise<TerminalAttachment> {
  return postJson<TerminalAttachment>(
    `/agents/${encodeURIComponent(agentId)}/terminals/attach`,
    body,
    USER_API_BASE,
  )
}

export async function killTerminal(agentId: string, terminalId: string): Promise<{ status: string }> {
  return deleteJson<{ status: string }>(
    `/agents/${encodeURIComponent(agentId)}/terminals/${encodeURIComponent(terminalId)}`,
    USER_API_BASE,
  )
}
