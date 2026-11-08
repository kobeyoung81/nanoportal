// The two log pages used to have one box that matched several columns at once.
// They now have one control per condition, filtered by the bus, and show the names
// behind the ids. None of that renders without a DOM, so what a node test can pin
// is the wiring: which path each page asks for, and what each cell renders.

import { describe, expect, it } from 'vitest'
import conversationsSource from '../pages/ConversationLogsPage.tsx?raw'
import auditSource from '../pages/AuditPage.tsx?raw'

describe('conversation log filters', () => {
  it('asks the bus with one parameter per condition', () => {
    expect(conversationsSource).toContain('conversationListPath(debounced)')
    expect(conversationsSource).toContain('setFilter(')
    // The old local text filter is gone: every condition is a request.
    expect(conversationsSource).not.toContain('debouncedSearch')
    expect(conversationsSource).not.toContain('item.id.toLowerCase().includes')
  })

  it('offers a control per condition, and a reset once one is set', () => {
    for (const key of ['session', 'agent', 'account', 'channel', 'status']) {
      expect(conversationsSource).toContain(`filters.${key}`)
    }
    expect(conversationsSource).toContain('hasFilters(filters)')
    expect(conversationsSource).toContain("t('common.reset')")
  })

  it('keeps the dropdown options from an unfiltered read', () => {
    expect(conversationsSource).toContain('conversationListPath(emptyConversationFilters)')
  })

  it('shows the resolved agent and account names, with the id as secondary text', () => {
    expect(conversationsSource).toContain('displayLabel(item.agent_name, item.agent_id)')
    expect(conversationsSource).toContain('displayLabel(item.account_name')
  })
})

describe('audit log filters', () => {
  it('asks the bus with one parameter per condition', () => {
    expect(auditSource).toContain('auditListPath(debounced)')
    expect(auditSource).toContain('setFilter(')
    expect(auditSource).not.toContain('debouncedSearch')
    expect(auditSource).not.toContain('entry.actor_id.toLowerCase().includes')
  })

  it('offers the action and resource-type dropdowns plus the two name boxes', () => {
    for (const key of ['action', 'actor', 'resourceType', 'resource']) {
      expect(auditSource).toContain(`filters.${key}`)
    }
    expect(auditSource).toContain("t('audit.resourceType')")
    expect(auditSource).toContain("t('common.reset')")
  })

  it('shows the resource name the bus resolved', () => {
    expect(auditSource).toContain('displayLabel(entry.resource_name, entry.resource_id')
  })

  it('is titled the way the menu names it', () => {
    expect(auditSource).toContain("t('nav.operationLogs')")
    expect(auditSource).not.toContain("t('nav.auditLog')")
  })
})
