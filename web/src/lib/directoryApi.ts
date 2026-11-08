// The directory login console talks to two backends: the config API (the
// settings, which live in service_config_items) and the auth service's read-only
// diagnostics behind /api/admin/v1/directory/*.
import { fetchJson, postJson, putJson } from './api'
import type { DirectoryDraft } from './directoryFields'
import { toPayload } from './directoryFields'

export type DirectorySettingsPayload = {
  enabled: boolean
  url: string
  start_tls: boolean
  tls_insecure_skip_verify: boolean
  ca_cert_pem: string
  timeout_seconds: number
  base_dn: string
  user_filter: string
  required_group_dn: string
  group_match_in_chain: boolean
  bind_dn: string
  bind_password: string
  attr_unique_id: string
  attr_username: string
  attr_display_name: string
  auto_provision: boolean
  link_policy: string
  disable_on_missing: boolean
  sync_display_name: boolean
  bind_password_set?: boolean
}

export type DirectoryPreset = {
  kind: string
  user_filter: string
  attr_unique_id: string
  attr_username: string
  attr_display_name: string
}

export type ProbeStep = {
  name: string
  status: 'ok' | 'skipped' | 'failed'
  detail: string
  duration_ms: number
}

export type ProbeResult = {
  ok: boolean
  kind: string
  vendor?: string
  vendor_version?: string
  auth_dn?: string
  anonymous: boolean
  naming_contexts?: string[]
  supported_ldap_versions?: string[]
  paged_results: boolean
  preset: DirectoryPreset
  steps: ProbeStep[]
}

export type BrowseNode = {
  dn: string
  label: string
  kind: string
  description?: string
  has_children: boolean
  subordinates?: number
  members?: number
}

export type BrowseResult = {
  base_dn: string
  kind: string
  naming_contexts?: string[]
  nodes: BrowseNode[]
  truncated: boolean
}

export type AttributeStat = {
  attribute: string
  present: number
  samples: number
  distinct: number
  duplicates: number
  examples?: string[]
}

export type Recommendation = {
  key: string
  value: string
  reason: string
  level: 'suggestion' | 'warning'
}

export type AnalyzeResult = {
  base_dn: string
  kind: string
  samples: number
  truncated: boolean
  class_counts: Record<string, number>
  attributes: AttributeStat[]
  recommendations: Recommendation[]
}

export type CheckResult = {
  filter: string
  match_count: number
  dn?: string
  username?: string
  display_name?: string
  unique_id?: string
  unique_id_source?: string
  group_required?: string
  group_ok: boolean
  bind_attempted: boolean
  bound: boolean
  bind_error?: string
  attributes?: Record<string, string>
}

export type ExistingAccount = {
  user_id: string
  email: string
  display_name: string
  role: string
  status: string
  linked: boolean
}

export type CheckResponse = {
  check: CheckResult
  outcome: string
  filter: string
  existing_account?: ExistingAccount
  account_not_local: boolean
}

export type EffectiveResponse = {
  configured: boolean
  settings?: DirectorySettingsPayload
  loaded_at?: string
}

export type FieldError = { code: string; message: string }

export type ValidateResponse = {
  valid: boolean
  errors: Record<string, FieldError>
}

type OpRequest = {
  settings?: DirectorySettingsPayload
  use_saved_password?: boolean
  base_dn?: string
  filter?: string
  email?: string
  password?: string
}

// putDirectoryKey writes one setting. The bus upserts it, so a key a deploy has
// not seeded yet is created rather than rejected.
export async function putDirectoryKey(key: string, value: string): Promise<void> {
  await putJson(`/configs/auth/${encodeURIComponent(key)}`, { value })
}

function opBody(
  draft: DirectoryDraft | null,
  useSavedPassword: boolean,
  extra: Partial<OpRequest> = {},
): OpRequest {
  const body: OpRequest = { use_saved_password: useSavedPassword, ...extra }
  if (draft) {
    body.settings = toPayload(draft)
  }
  return body
}

// validateDraft is the server's own rule set: what it rejects here is what would
// break logins later.
export async function validateDraft(
  draft: DirectoryDraft,
  useSavedPassword = true,
): Promise<ValidateResponse> {
  return postJson<ValidateResponse>('/directory/validate', opBody(draft, useSavedPassword))
}

export async function testConnection(
  draft: DirectoryDraft | null,
  useSavedPassword = false,
): Promise<ProbeResult> {
  return postJson<ProbeResult>('/directory/test', opBody(draft, useSavedPassword))
}

export async function browseDirectory(
  draft: DirectoryDraft | null,
  baseDN: string,
  useSavedPassword = false,
): Promise<BrowseResult> {
  return postJson<BrowseResult>('/directory/browse', opBody(draft, useSavedPassword, { base_dn: baseDN }))
}

export async function searchDirectory(
  draft: DirectoryDraft | null,
  baseDN: string,
  filter: string,
  useSavedPassword = false,
): Promise<BrowseResult> {
  return postJson<BrowseResult>(
    '/directory/search',
    opBody(draft, useSavedPassword, { base_dn: baseDN, filter }),
  )
}

export async function analyzeDirectory(
  draft: DirectoryDraft | null,
  baseDN: string,
  useSavedPassword = false,
): Promise<AnalyzeResult> {
  return postJson<AnalyzeResult>('/directory/analyze', opBody(draft, useSavedPassword, { base_dn: baseDN }))
}

export async function checkLogin(
  draft: DirectoryDraft | null,
  email: string,
  password: string,
  useSavedPassword = false,
): Promise<CheckResponse> {
  return postJson<CheckResponse>('/directory/check', opBody(draft, useSavedPassword, { email, password }))
}

export async function getDirectoryEffective(): Promise<EffectiveResponse> {
  return fetchJson<EffectiveResponse>('/directory/effective')
}
