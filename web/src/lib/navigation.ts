import {
  Activity,
  Bell,
  Blocks,
  Bot,
  Boxes,
  Cpu,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  Mic,
  ScrollText,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { CrumbLabel } from './crumbLabel'
import { SECTION_ROLES, canAccessSection, type AdminSection } from './roles'

export type AdminNavSection = AdminSection

export type AdminNavItem = {
  path: string
  labelKey: string
  section: AdminSection
  icon: LucideIcon
  /** Roles allowed to see/access this item. */
  roles: string[]
}

export const ADMIN_NAV_SECTIONS: { key: AdminSection; labelKey: string }[] = [
  { key: 'overview', labelKey: 'nav.sectionOverview' },
  { key: 'operations', labelKey: 'nav.sectionOperations' },
  { key: 'management', labelKey: 'nav.sectionManagement' },
  { key: 'audit', labelKey: 'nav.sectionAudit' },
  { key: 'messages', labelKey: 'nav.sectionMessages' },
]

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { path: '/admin/overview', labelKey: 'nav.dashboard', section: 'overview', icon: LayoutDashboard, roles: SECTION_ROLES.overview },
  { path: '/admin/components', labelKey: 'nav.components', section: 'overview', icon: Boxes, roles: SECTION_ROLES.overview },
  { path: '/admin/users', labelKey: 'nav.users', section: 'operations', icon: Users, roles: SECTION_ROLES.operations },
  { path: '/admin/configs', labelKey: 'nav.configCenter', section: 'management', icon: SlidersHorizontal, roles: SECTION_ROLES.management },
  { path: '/admin/directory', labelKey: 'nav.directoryLogin', section: 'management', icon: KeyRound, roles: SECTION_ROLES.management },
  { path: '/admin/voice', labelKey: 'nav.voiceInput', section: 'management', icon: Mic, roles: SECTION_ROLES.management },
  { path: '/admin/models', labelKey: 'nav.modelCenter', section: 'management', icon: Cpu, roles: SECTION_ROLES.management },
  { path: '/admin/capabilities', labelKey: 'nav.capabilityCenter', section: 'management', icon: Blocks, roles: SECTION_ROLES.management },
  { path: '/admin/agent-types', labelKey: 'nav.agentCenter', section: 'management', icon: Bot, roles: SECTION_ROLES.management },
  { path: '/admin/audit', labelKey: 'nav.operationLogs', section: 'audit', icon: ScrollText, roles: SECTION_ROLES.audit },
  { path: '/admin/conversations', labelKey: 'nav.conversationLogs', section: 'audit', icon: MessageSquare, roles: SECTION_ROLES.audit },
  { path: '/admin/runtime', labelKey: 'nav.runtimeLogs', section: 'audit', icon: Activity, roles: SECTION_ROLES.audit },
  { path: '/admin/alerts', labelKey: 'nav.alertRules', section: 'messages', icon: Bell, roles: SECTION_ROLES.messages },
]

export function adminNavVisible(item: AdminNavItem, role?: string): boolean {
  return canAccessSection(role, item.section)
}

export function itemForPath(pathname: string): AdminNavItem | undefined {
  return ADMIN_NAV_ITEMS.find((item) => {
    if (item.path === '/admin/overview') {
      return pathname === item.path
    }
    return pathname === item.path || pathname.startsWith(item.path + '/')
  })
}

// A crumb shows `labelKey` (translated) or `label`. `title` is the hover hint
// for what a friendly label hides — the raw id behind an account name.
export type Crumb = { labelKey?: string; label?: string; to?: string; title?: string }

export function breadcrumbsForPath(pathname: string): Crumb[] {
  if (pathname.startsWith('/admin/users/')) {
    // The detail page owns the account's display name and passes it back
    // through useCrumbLabel; until then this reads as "User", and the id from
    // the URL stays available on hover either way.
    return [
      { labelKey: 'nav.users', to: '/admin/users' },
      { labelKey: 'userDetail.userFallback', title: decodeURIComponent(pathname.split('/')[3]) },
    ]
  }
  if (pathname.startsWith('/admin/components/')) {
    return [
      { labelKey: 'nav.components', to: '/admin/components' },
      { label: decodeURIComponent(pathname.split('/')[3]) },
    ]
  }
  const item = itemForPath(pathname)
  if (item) {
    return [{ labelKey: item.labelKey }]
  }
  if (pathname === '/agent') {
    return [{ labelKey: 'nav.agent' }]
  }
  if (pathname === '/me') {
    return [{ labelKey: 'nav.myAccount' }]
  }
  if (pathname === '/files') {
    return [{ labelKey: 'nav.files' }]
  }
  return [{ labelKey: 'nav.unknown' }]
}

// withCrumbOverride swaps the last crumb's visible text for the name the page
// resolved (see useCrumbLabel). `labelKey` is deliberately dropped: the renderer
// prefers a translation key over `label`, so leaving it in place would keep
// showing the placeholder. The crumb's own `title` survives unless the override
// brings one.
export function withCrumbOverride(crumbs: Crumb[], pathname: string, override: CrumbLabel | null): Crumb[] {
  // A name only applies to the route it was registered on. The page clears its
  // name on unmount, but that runs after the next route has already rendered —
  // without this check the crumb of the page the reader just opened would be
  // renamed after the page they left.
  if (!override || override.path !== pathname || crumbs.length === 0) {
    return crumbs
  }
  const last = crumbs[crumbs.length - 1]
  return [...crumbs.slice(0, -1), { to: last.to, label: override.label, title: override.title ?? last.title }]
}
