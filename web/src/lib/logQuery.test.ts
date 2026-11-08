import { describe, expect, it } from 'vitest'
import {
  auditListPath,
  conversationListPath,
  displayLabel,
  emptyAuditFilters,
  emptyConversationFilters,
  hasFilters,
} from './logQuery'

describe('conversationListPath', () => {
  it('asks for the page size and nothing else when no condition is set', () => {
    expect(conversationListPath(emptyConversationFilters)).toBe('/conversations?limit=200')
  })

  it('sends each condition as its own parameter', () => {
    expect(
      conversationListPath({ session: 'web:chat-1', agent: 'ada', account: 'bob', channel: 'web', status: 'active' }),
    ).toBe('/conversations?limit=200&session=web%3Achat-1&agent=ada&account=bob&channel=web&status=active')
  })

  it('leaves blank and whitespace-only fields out', () => {
    expect(conversationListPath({ ...emptyConversationFilters, agent: '  ', account: ' bob ' })).toBe(
      '/conversations?limit=200&account=bob',
    )
  })

  it('encodes characters that would otherwise break the query', () => {
    const path = conversationListPath({ ...emptyConversationFilters, agent: 'a&b=c d' })
    expect(path).toBe('/conversations?limit=200&agent=a%26b%3Dc+d')
  })
})

describe('auditListPath', () => {
  it('asks for the page size and nothing else when no condition is set', () => {
    expect(auditListPath(emptyAuditFilters)).toBe('/audit?limit=200')
  })

  it('names the resource-type parameter the way the bus reads it', () => {
    expect(
      auditListPath({ action: 'agent.delete', actor: 'ada', resourceType: 'agent', resource: 'ops-bot' }),
    ).toBe('/audit?limit=200&action=agent.delete&actor=ada&resource_type=agent&resource=ops-bot')
  })
})

describe('hasFilters', () => {
  it('is false for blanks and true for a single condition', () => {
    expect(hasFilters(emptyConversationFilters)).toBe(false)
    expect(hasFilters({ ...emptyAuditFilters, actor: '   ' })).toBe(false)
    expect(hasFilters({ ...emptyAuditFilters, actor: 'ada' })).toBe(true)
  })
})

describe('displayLabel', () => {
  it('prefers the resolved name and falls back to the id', () => {
    expect(displayLabel('Ada', 'agent-1')).toBe('Ada')
    expect(displayLabel(undefined, 'agent-1')).toBe('agent-1')
    expect(displayLabel('  ', 'agent-1')).toBe('agent-1')
  })
})
