// Pure helpers behind the directory login page: applying a suggestion to the
// draft, turning server codes into translation keys, and answering "did my save
// take effect" by comparing the stored settings with the ones in force.
import type { AttributeStat, DirectorySettingsPayload, Recommendation } from './directoryApi'
import type { DirectoryDraft } from './directoryFields'
import { toPayload } from './directoryFields'

// PAYLOAD_KEY_BY_FIELD is the inverse of toPayload: which setting a field of the
// effective configuration came from. bind_password is deliberately absent — the
// service never returns it, so it cannot be compared.
const PAYLOAD_KEY_BY_FIELD: [keyof DirectorySettingsPayload, string][] = [
  ['enabled', 'ldap.enabled'],
  ['url', 'ldap.url'],
  ['start_tls', 'ldap.startTLS'],
  ['tls_insecure_skip_verify', 'ldap.tlsInsecureSkipVerify'],
  ['ca_cert_pem', 'ldap.caCertPEM'],
  ['timeout_seconds', 'ldap.timeoutSeconds'],
  ['base_dn', 'ldap.baseDN'],
  ['user_filter', 'ldap.userFilter'],
  ['required_group_dn', 'ldap.requiredGroupDN'],
  ['group_match_in_chain', 'ldap.groupMatchInChain'],
  ['bind_dn', 'ldap.bindDN'],
  ['attr_unique_id', 'ldap.attrUniqueId'],
  ['attr_username', 'ldap.attrUsername'],
  ['attr_display_name', 'ldap.attrDisplayName'],
  ['auto_provision', 'ldap.autoProvision'],
  ['link_policy', 'ldap.linkPolicy'],
  ['disable_on_missing', 'ldap.disableOnMissing'],
  ['sync_display_name', 'ldap.syncDisplayName'],
]

// applyRecommendation writes one suggestion into the draft. A recommendation
// without a value is a warning: it has nothing to apply.
export function applyRecommendation(draft: DirectoryDraft, rec: Recommendation): DirectoryDraft {
  if (!rec.value) {
    return draft
  }
  return { ...draft, [rec.key]: rec.value }
}

export function applyRecommendations(draft: DirectoryDraft, recs: Recommendation[]): DirectoryDraft {
  return recs.reduce((next, rec) => applyRecommendation(next, rec), draft)
}

// recommendationReasonKey renders why a suggestion was made.
export function recommendationReasonKey(reason: string): string {
  return `directory.reason.${reason}`
}

// outcomeKey renders what a dry run would do.
export function outcomeKey(outcome: string): string {
  return `directory.outcome.${outcome}`
}

export function outcomeTone(outcome: string): 'success' | 'warning' | 'danger' {
  switch (outcome) {
    case 'sign_in':
    case 'link':
    case 'provision':
      return 'success'
    case 'local_password':
    case 'wrong_password':
    case 'no_directory_entry':
      return 'warning'
    default:
      return 'danger'
  }
}

// attributeHelpKey names a directory attribute in plain language, when the page
// knows it.
export function attributeHelpKey(attribute: string): string | null {
  const known = [
    'mail',
    'userprincipalname',
    'samaccountname',
    'uid',
    'cn',
    'displayname',
    'givenname',
    'sn',
    'objectguid',
    'entryuuid',
    'memberof',
  ]
  const normalized = attribute.toLowerCase()
  return known.includes(normalized) ? `directory.attribute.${normalized}` : null
}

export function presencePercent(stat: AttributeStat): number {
  if (stat.samples === 0) {
    return 0
  }
  return Math.round((stat.present / stat.samples) * 100)
}

export function uniqueIDSourceKey(source?: string): string {
  return `directory.uniqueIdSource.${source || 'attribute'}`
}

export type EffectiveDiff = { key: string; saved: string; effective: string }

// diffEffective lists the settings whose stored value is not the one in force
// yet, which is how the page answers "did my save take effect".
export function diffEffective(
  draft: DirectoryDraft,
  effective: DirectorySettingsPayload,
): EffectiveDiff[] {
  const payload = toPayload(draft)
  const differences: EffectiveDiff[] = []
  for (const [field, key] of PAYLOAD_KEY_BY_FIELD) {
    const saved = String(payload[field] ?? '')
    const live = String(effective[field] ?? '')
    if (saved !== live) {
      differences.push({ key, saved, effective: live })
    }
  }
  return differences
}
