export const ROLE_ADMIN = 'admin'
// Role identifiers are historical: `operator` is the DevOps role and
// `support` is the Operations role. See SECTION_ROLES for what each owns.
export const ROLE_OPERATOR = 'operator'
export const ROLE_SUPPORT = 'support'
export const ROLE_AUDITOR = 'auditor'
export const ROLE_USER = 'user'

export const ROLE_RANK: Record<string, number> = {
  [ROLE_ADMIN]: 100,
  [ROLE_OPERATOR]: 80,
  [ROLE_SUPPORT]: 60,
  [ROLE_AUDITOR]: 40,
  [ROLE_USER]: 20,
}

export const ADMIN_PANEL_ROLES = new Set<string>([ROLE_ADMIN, ROLE_OPERATOR, ROLE_SUPPORT, ROLE_AUDITOR])

export function roleRank(role?: string): number {
  return role ? ROLE_RANK[role] ?? 0 : 0
}

export function canAccessAdminPanel(role?: string): boolean {
  return role ? ADMIN_PANEL_ROLES.has(role) : false
}

export function isOperatorOrAbove(role?: string): boolean {
  return roleRank(role) >= ROLE_RANK[ROLE_OPERATOR]
}

export function canWriteAdmin(role?: string): boolean {
  return isOperatorOrAbove(role)
}

// Admin console sections. Membership is explicit (not rank-based) because the
// roles are not strictly linear: Operations (`support`) ranks below DevOps
// (`operator`) yet owns a different section.
export type AdminSection = 'overview' | 'operations' | 'management' | 'audit' | 'messages'

export const SECTION_ROLES: Record<AdminSection, string[]> = {
  overview: [ROLE_ADMIN, ROLE_OPERATOR, ROLE_SUPPORT, ROLE_AUDITOR],
  operations: [ROLE_ADMIN, ROLE_SUPPORT],
  management: [ROLE_ADMIN, ROLE_OPERATOR],
  audit: [ROLE_ADMIN, ROLE_AUDITOR],
  messages: [ROLE_ADMIN, ROLE_OPERATOR],
}

export function canAccessSection(role: string | undefined, section: AdminSection): boolean {
  return role ? SECTION_ROLES[section].includes(role) : false
}

// Operations (support) and admins may manage other users' accounts/resources.
export function canManageUsers(role?: string): boolean {
  return role === ROLE_ADMIN || role === ROLE_SUPPORT
}
