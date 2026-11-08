// The directory login settings are ordinary rows in service_config_items
// (component `auth`, keys `ldap.*`), so their metadata — which section a key
// belongs to, how it is edited, what it means — lives here, and nowhere else.
// The config API only ever deals in strings; toPayload turns the draft into the
// typed shape the auth service expects.
import type { DirectorySettingsPayload } from './directoryApi'

export type FieldKind = 'bool' | 'string' | 'int' | 'password' | 'textarea' | 'select'

export type FieldSection = 'status' | 'connection' | 'search' | 'matching' | 'group' | 'policy'

export type DirectoryField = {
  key: string
  kind: FieldKind
  section: FieldSection
  labelKey: string
  helpKey: string
  placeholderKey?: string
  options?: { value: string; labelKey: string }[]
}

export const DIRECTORY_PREFIX = 'ldap.'

export const DIRECTORY_SECTIONS: { key: FieldSection; labelKey: string }[] = [
  { key: 'status', labelKey: 'directory.sectionStatus' },
  { key: 'connection', labelKey: 'directory.sectionConnection' },
  { key: 'search', labelKey: 'directory.sectionSearch' },
  { key: 'matching', labelKey: 'directory.sectionMatching' },
  { key: 'group', labelKey: 'directory.sectionGroup' },
  { key: 'policy', labelKey: 'directory.sectionPolicy' },
]

// DIRECTORY_FIELDS is the editable inventory, in render order.
export const DIRECTORY_FIELDS: DirectoryField[] = [
  {
    key: 'ldap.enabled',
    kind: 'bool',
    section: 'status',
    labelKey: 'directory.field.enabled',
    helpKey: 'directory.help.enabled',
  },
  {
    key: 'ldap.url',
    kind: 'string',
    section: 'connection',
    labelKey: 'directory.field.url',
    helpKey: 'directory.help.url',
    placeholderKey: 'directory.placeholder.url',
  },
  {
    key: 'ldap.bindDN',
    kind: 'string',
    section: 'connection',
    labelKey: 'directory.field.bindDN',
    helpKey: 'directory.help.bindDN',
  },
  {
    key: 'ldap.bindPassword',
    kind: 'password',
    section: 'connection',
    labelKey: 'directory.field.bindPassword',
    helpKey: 'directory.help.bindPassword',
  },
  {
    key: 'ldap.startTLS',
    kind: 'bool',
    section: 'connection',
    labelKey: 'directory.field.startTLS',
    helpKey: 'directory.help.startTLS',
  },
  {
    key: 'ldap.tlsInsecureSkipVerify',
    kind: 'bool',
    section: 'connection',
    labelKey: 'directory.field.tlsInsecureSkipVerify',
    helpKey: 'directory.help.tlsInsecureSkipVerify',
  },
  {
    key: 'ldap.caCertPEM',
    kind: 'textarea',
    section: 'connection',
    labelKey: 'directory.field.caCertPEM',
    helpKey: 'directory.help.caCertPEM',
  },
  {
    key: 'ldap.timeoutSeconds',
    kind: 'int',
    section: 'connection',
    labelKey: 'directory.field.timeoutSeconds',
    helpKey: 'directory.help.timeoutSeconds',
  },
  {
    key: 'ldap.baseDN',
    kind: 'string',
    section: 'search',
    labelKey: 'directory.field.baseDN',
    helpKey: 'directory.help.baseDN',
    placeholderKey: 'directory.placeholder.baseDN',
  },
  {
    key: 'ldap.userFilter',
    kind: 'string',
    section: 'matching',
    labelKey: 'directory.field.userFilter',
    helpKey: 'directory.help.userFilter',
    placeholderKey: 'directory.placeholder.userFilter',
  },
  {
    key: 'ldap.attrUniqueId',
    kind: 'string',
    section: 'matching',
    labelKey: 'directory.field.attrUniqueId',
    helpKey: 'directory.help.attrUniqueId',
  },
  {
    key: 'ldap.attrUsername',
    kind: 'string',
    section: 'matching',
    labelKey: 'directory.field.attrUsername',
    helpKey: 'directory.help.attrUsername',
  },
  {
    key: 'ldap.attrDisplayName',
    kind: 'string',
    section: 'matching',
    labelKey: 'directory.field.attrDisplayName',
    helpKey: 'directory.help.attrDisplayName',
  },
  {
    key: 'ldap.requiredGroupDN',
    kind: 'string',
    section: 'group',
    labelKey: 'directory.field.requiredGroupDN',
    helpKey: 'directory.help.requiredGroupDN',
  },
  {
    key: 'ldap.groupMatchInChain',
    kind: 'bool',
    section: 'group',
    labelKey: 'directory.field.groupMatchInChain',
    helpKey: 'directory.help.groupMatchInChain',
  },
  {
    key: 'ldap.autoProvision',
    kind: 'bool',
    section: 'policy',
    labelKey: 'directory.field.autoProvision',
    helpKey: 'directory.help.autoProvision',
  },
  {
    key: 'ldap.linkPolicy',
    kind: 'select',
    section: 'policy',
    labelKey: 'directory.field.linkPolicy',
    helpKey: 'directory.help.linkPolicy',
    options: [
      { value: 'auto', labelKey: 'directory.linkPolicy.auto' },
      { value: 'refuse', labelKey: 'directory.linkPolicy.refuse' },
    ],
  },
  {
    key: 'ldap.disableOnMissing',
    kind: 'bool',
    section: 'policy',
    labelKey: 'directory.field.disableOnMissing',
    helpKey: 'directory.help.disableOnMissing',
  },
  {
    key: 'ldap.syncDisplayName',
    kind: 'bool',
    section: 'policy',
    labelKey: 'directory.field.syncDisplayName',
    helpKey: 'directory.help.syncDisplayName',
  },
]

export const FIELD_BY_KEY: Record<string, DirectoryField> = Object.fromEntries(
  DIRECTORY_FIELDS.map((field) => [field.key, field]),
)

// DIRECTORY_DEFAULTS mirror parseConfig in nanoauth/internal/directory/config.go.
// They are only used to render a key the store has not seeded yet (the keys
// arrive with the next deploy's `nanobus config seed`); the auth service is the
// authority on every value it actually reads.
export const DIRECTORY_DEFAULTS: Record<string, string> = {
  'ldap.enabled': 'false',
  'ldap.url': 'ldap://127.0.0.1:389',
  'ldap.startTLS': 'false',
  'ldap.tlsInsecureSkipVerify': 'false',
  'ldap.caCertPEM': '',
  'ldap.timeoutSeconds': '10',
  'ldap.baseDN': '',
  'ldap.userFilter': '(&(objectClass=user)(mail=%s))',
  'ldap.requiredGroupDN': '',
  'ldap.groupMatchInChain': 'false',
  'ldap.bindDN': '',
  'ldap.bindPassword': '',
  'ldap.attrUniqueId': 'objectGUID',
  'ldap.attrUsername': 'sAMAccountName',
  'ldap.attrDisplayName': 'displayName',
  'ldap.autoProvision': 'true',
  'ldap.linkPolicy': 'auto',
  'ldap.disableOnMissing': 'false',
  'ldap.syncDisplayName': 'false',
}

export type DirectoryDraft = Record<string, string>

export function fieldsOfSection(section: FieldSection): DirectoryField[] {
  return DIRECTORY_FIELDS.filter((field) => field.section === section)
}

// draftFromConfig turns the config API's map into the draft the page edits,
// keeping any ldap.* key the page does not model so an unknown setting is never
// silently dropped on save.
export function draftFromConfig(config: Record<string, unknown>): {
  draft: DirectoryDraft
  unknownKeys: string[]
} {
  const draft: DirectoryDraft = {}
  const known = new Set(DIRECTORY_FIELDS.map((field) => field.key))
  const unknownKeys: string[] = []

  for (const key of Object.keys(DIRECTORY_DEFAULTS)) {
    draft[key] = DIRECTORY_DEFAULTS[key]
  }
  for (const [key, value] of Object.entries(config)) {
    if (!key.startsWith(DIRECTORY_PREFIX)) {
      continue
    }
    draft[key] = value === null || value === undefined ? '' : String(value)
    if (!known.has(key)) {
      unknownKeys.push(key)
    }
  }
  unknownKeys.sort()
  return { draft, unknownKeys }
}

// changedKeys is what gets written: only the keys the draft actually moved.
export function changedKeys(draft: DirectoryDraft, baseline: DirectoryDraft): DirectoryDraft {
  const changed: DirectoryDraft = {}
  for (const [key, value] of Object.entries(draft)) {
    if ((baseline[key] ?? '') !== value) {
      changed[key] = value
    }
  }
  return changed
}

export function isTrue(value: string | undefined): boolean {
  return (value ?? '').toLowerCase() === 'true'
}

export function boolString(value: boolean): string {
  return value ? 'true' : 'false'
}

// toPayload renders the draft as the typed payload the auth service accepts.
export function toPayload(draft: DirectoryDraft): DirectorySettingsPayload {
  const text = (key: string) => draft[key] ?? ''
  const timeout = Number.parseInt(text('ldap.timeoutSeconds'), 10)
  return {
    enabled: isTrue(draft['ldap.enabled']),
    url: text('ldap.url'),
    start_tls: isTrue(draft['ldap.startTLS']),
    tls_insecure_skip_verify: isTrue(draft['ldap.tlsInsecureSkipVerify']),
    ca_cert_pem: text('ldap.caCertPEM'),
    timeout_seconds: Number.isFinite(timeout) && timeout > 0 ? timeout : 10,
    base_dn: text('ldap.baseDN'),
    user_filter: text('ldap.userFilter'),
    required_group_dn: text('ldap.requiredGroupDN'),
    group_match_in_chain: isTrue(draft['ldap.groupMatchInChain']),
    bind_dn: text('ldap.bindDN'),
    bind_password: text('ldap.bindPassword'),
    attr_unique_id: text('ldap.attrUniqueId'),
    attr_username: text('ldap.attrUsername'),
    attr_display_name: text('ldap.attrDisplayName'),
    auto_provision: isTrue(draft['ldap.autoProvision']),
    link_policy: text('ldap.linkPolicy') || 'auto',
    disable_on_missing: isTrue(draft['ldap.disableOnMissing']),
    sync_display_name: isTrue(draft['ldap.syncDisplayName']),
  }
}
