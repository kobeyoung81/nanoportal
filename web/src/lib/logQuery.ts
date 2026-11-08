// The admin log pages make one control per condition, so the query is built the
// same way: one parameter per non-empty field, and nothing at all for the rest.
// Keeping the paths here (rather than inline in the pages) is what lets a node
// test pin the encoding without a DOM.

/** How many rows a log page asks the bus for. The bus caps conversations at 200. */
export const LOG_ROWS_LIMIT = 200

export type ConversationFilters = {
  session: string
  agent: string
  account: string
  channel: string
  status: string
}

export type AuditFilters = {
  action: string
  actor: string
  resourceType: string
  resource: string
}

export const emptyConversationFilters: ConversationFilters = {
  session: '',
  agent: '',
  account: '',
  channel: '',
  status: '',
}

export const emptyAuditFilters: AuditFilters = {
  action: '',
  actor: '',
  resourceType: '',
  resource: '',
}

/** True when at least one condition is set — the page then offers "reset". */
export function hasFilters(filters: ConversationFilters | AuditFilters): boolean {
  return Object.values(filters).some((value) => value.trim() !== '')
}

function listPath(base: string, params: Array<[string, string]>): string {
  const search = new URLSearchParams({ limit: String(LOG_ROWS_LIMIT) })
  for (const [key, value] of params) {
    const trimmed = value.trim()
    if (trimmed !== '') {
      search.set(key, trimmed)
    }
  }
  return `${base}?${search.toString()}`
}

export function conversationListPath(filters: ConversationFilters): string {
  return listPath('/conversations', [
    ['session', filters.session],
    ['agent', filters.agent],
    ['account', filters.account],
    ['channel', filters.channel],
    ['status', filters.status],
  ])
}

export function auditListPath(filters: AuditFilters): string {
  return listPath('/audit', [
    ['action', filters.action],
    ['actor', filters.actor],
    ['resource_type', filters.resourceType],
    ['resource', filters.resource],
  ])
}

/**
 * What a table cell shows: the resolved name when the bus found one, otherwise the
 * id. A deleted account or agent has no row to resolve, and an id is still better
 * than an empty cell.
 */
export function displayLabel(name: string | undefined, id: string): string {
  return name && name.trim() !== '' ? name : id
}
