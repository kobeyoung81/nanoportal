// The directory page edits plain service_config_items rows, so these tests pin
// the two things that would silently corrupt a setting: which keys the draft
// covers (defaults, unknown keys, non-LDAP noise) and what a save actually
// writes (only changed keys, typed values).
import { describe, expect, it } from 'vitest'
import {
  changedKeys,
  draftFromConfig,
  isTrue,
  toPayload,
} from './directoryFields'

describe('draftFromConfig', () => {
  it('fills every modelled key, using the defaults for rows the store has not seeded', () => {
    const { draft } = draftFromConfig({})
    expect(draft['ldap.url']).toBe('ldap://127.0.0.1:389')
    expect(draft['ldap.autoProvision']).toBe('true')
    expect(draft['ldap.linkPolicy']).toBe('auto')
    expect(Object.keys(draft).length).toBeGreaterThanOrEqual(19)
  })

  it('keeps stored values and ignores keys outside the ldap namespace', () => {
    const { draft } = draftFromConfig({
      jwtPrivateKey: 'secret',
      'ldap.enabled': true,
      'ldap.baseDN': 'dc=corp,dc=local',
      'ldap.timeoutSeconds': 20,
    })
    expect(draft['ldap.enabled']).toBe('true')
    expect(draft['ldap.baseDN']).toBe('dc=corp,dc=local')
    expect(draft['ldap.timeoutSeconds']).toBe('20')
    expect(draft.jwtPrivateKey).toBeUndefined()
  })

  it('reports an ldap key the page does not model instead of dropping it', () => {
    const { draft, unknownKeys } = draftFromConfig({ 'ldap.future': 'kept' })
    expect(draft['ldap.future']).toBe('kept')
    expect(unknownKeys).toEqual(['ldap.future'])
  })
})

describe('changedKeys', () => {
  it('returns only the keys that moved', () => {
    const { draft } = draftFromConfig({ 'ldap.url': 'ldap://a', 'ldap.baseDN': 'dc=a' })
    const edited = { ...draft, 'ldap.baseDN': 'dc=b' }
    expect(changedKeys(edited, draft)).toEqual({ 'ldap.baseDN': 'dc=b' })
  })

  it('returns nothing when the draft equals the baseline', () => {
    const { draft } = draftFromConfig({ 'ldap.url': 'ldap://a' })
    expect(changedKeys(draft, draft)).toEqual({})
  })
})

describe('toPayload', () => {
  it('converts the string draft into the typed payload the auth service takes', () => {
    const { draft } = draftFromConfig({
      'ldap.enabled': 'true',
      'ldap.timeoutSeconds': '15',
      'ldap.groupMatchInChain': 'true',
      'ldap.userFilter': '(&(objectClass=user)(mail=%s))',
    })
    const payload = toPayload(draft)
    expect(payload.enabled).toBe(true)
    expect(payload.timeout_seconds).toBe(15)
    expect(payload.group_match_in_chain).toBe(true)
    expect(payload.link_policy).toBe('auto')
    expect(payload.disable_on_missing).toBe(false)
  })

  it('falls back to a usable timeout when the field is not a number', () => {
    const { draft } = draftFromConfig({ 'ldap.timeoutSeconds': 'soon' })
    expect(toPayload(draft).timeout_seconds).toBe(10)
  })
})

describe('isTrue', () => {
  it('reads the boolean spelling the store uses', () => {
    expect(isTrue('true')).toBe(true)
    expect(isTrue('TRUE')).toBe(true)
    expect(isTrue('false')).toBe(false)
    expect(isTrue(undefined)).toBe(false)
  })
})
