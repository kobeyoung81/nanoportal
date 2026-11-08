// Two answers the page must get right: which suggestion fills which setting, and
// whether the values the auth service is using are the ones the operator saved.
import { describe, expect, it } from 'vitest'
import type { DirectorySettingsPayload, Recommendation } from './directoryApi'
import { draftFromConfig } from './directoryFields'
import {
  applyRecommendation,
  applyRecommendations,
  attributeHelpKey,
  diffEffective,
  outcomeKey,
  presencePercent,
  recommendationReasonKey,
} from './directoryLogic'

function settings(overrides: Partial<DirectorySettingsPayload> = {}): DirectorySettingsPayload {
  return {
    enabled: false,
    url: 'ldap://127.0.0.1:389',
    start_tls: false,
    tls_insecure_skip_verify: false,
    ca_cert_pem: '',
    timeout_seconds: 10,
    base_dn: '',
    user_filter: '(&(objectClass=user)(mail=%s))',
    required_group_dn: '',
    group_match_in_chain: false,
    bind_dn: '',
    bind_password: '',
    attr_unique_id: 'objectGUID',
    attr_username: 'sAMAccountName',
    attr_display_name: 'displayName',
    auto_provision: true,
    link_policy: 'auto',
    disable_on_missing: false,
    sync_display_name: false,
    ...overrides,
  }
}

describe('applyRecommendation', () => {
  const suggestion: Recommendation = {
    key: 'ldap.userFilter',
    value: '(&(objectClass=inetOrgPerson)(mail=%s))',
    reason: 'mail_unique',
    level: 'suggestion',
  }

  it('writes the value into the setting it came from', () => {
    const { draft } = draftFromConfig({})
    expect(applyRecommendation(draft, suggestion)['ldap.userFilter']).toBe(
      '(&(objectClass=inetOrgPerson)(mail=%s))',
    )
  })

  it('leaves other settings alone', () => {
    const { draft } = draftFromConfig({ 'ldap.baseDN': 'dc=corp,dc=local' })
    const next = applyRecommendation(draft, suggestion)
    expect(next['ldap.baseDN']).toBe('dc=corp,dc=local')
  })

  it('ignores a warning, which carries no value', () => {
    const { draft } = draftFromConfig({})
    const warning: Recommendation = { key: 'ldap.attrUniqueId', value: '', reason: 'no_unique_identifier', level: 'warning' }
    expect(applyRecommendation(draft, warning)['ldap.attrUniqueId']).toBe('objectGUID')
  })
})

describe('applyRecommendations', () => {
  it('applies every suggestion in one pass', () => {
    const { draft } = draftFromConfig({})
    const next = applyRecommendations(draft, [
      { key: 'ldap.attrUsername', value: 'uid', reason: 'login_name_present', level: 'suggestion' },
      { key: 'ldap.attrUniqueId', value: 'entryUUID', reason: 'unique_id_present', level: 'suggestion' },
      { key: 'ldap.attrDisplayName', value: '', reason: 'no_display_name', level: 'warning' },
    ])
    expect(next['ldap.attrUsername']).toBe('uid')
    expect(next['ldap.attrUniqueId']).toBe('entryUUID')
    expect(next['ldap.attrDisplayName']).toBe('displayName')
  })
})

describe('diffEffective', () => {
  it('reports nothing when the saved values are the ones in force', () => {
    const { draft } = draftFromConfig({ 'ldap.url': 'ldap://a', 'ldap.enabled': 'true' })
    expect(diffEffective(draft, settings({ url: 'ldap://a', enabled: true }))).toEqual([])
  })

  it('lists the settings that have not been picked up yet', () => {
    const { draft } = draftFromConfig({ 'ldap.url': 'ldap://new' })
    expect(diffEffective(draft, settings({ url: 'ldap://old' }))).toEqual([
      { key: 'ldap.url', saved: 'ldap://new', effective: 'ldap://old' },
    ])
  })

  it('never compares the bind password, which the service does not return', () => {
    const { draft } = draftFromConfig({ 'ldap.bindPassword': 'hunter2' })
    expect(diffEffective(draft, settings())).toEqual([])
  })
})

describe('translation keys', () => {
  it('names the reason and the outcome codes the service sends', () => {
    expect(recommendationReasonKey('mail_unique')).toBe('directory.reason.mail_unique')
    expect(outcomeKey('refuse_policy')).toBe('directory.outcome.refuse_policy')
  })

  it('explains a known attribute and stays quiet about an unknown one', () => {
    expect(attributeHelpKey('sAMAccountName')).toBe('directory.attribute.samaccountname')
    expect(attributeHelpKey('objectGUID')).toBe('directory.attribute.objectguid')
    expect(attributeHelpKey('employeeNumber')).toBeNull()
  })
})

describe('presencePercent', () => {
  it('rounds the share of sampled entries that carry the attribute', () => {
    expect(presencePercent({ attribute: 'mail', present: 3, samples: 4, distinct: 3, duplicates: 0 })).toBe(75)
  })

  it('is zero when nothing was sampled', () => {
    expect(presencePercent({ attribute: 'mail', present: 0, samples: 0, distinct: 0, duplicates: 0 })).toBe(0)
  })
})
