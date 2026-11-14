import type { LucideIcon } from 'lucide-react'
import { iconForPanel } from '../portal/icons'
import type { NavContribution } from '../portal/contract'
import type { CrumbLabel } from './crumbLabel'
import { SECTION_ROLES, canAccessSection, type AdminSection } from './roles'

// The console's navigation.
//
// The entries are the admin module's: its manifest declares them, and this module
// turns them into menu items. What stays here is policy — an entry names a
// section, and the section's roles decide who sees it — plus the fallback list the
// console uses when the admin plugin is not installed. Without that fallback,
// removing a plugin would leave an empty console instead of an old one.

export type AdminNavSection = AdminSection

export type AdminNavItem = {
  /** Stable id: `"admin"` for the fallback list, `<plugin>.<nav id>` for a plugin. */
  id: string
  path: string
  /** Translation key (the fallback list) or a resolved title (a plugin). */
  labelKey?: string
  label?: string
  section?: AdminSection
  icon: LucideIcon
  /** Position among its siblings; ties keep manifest order. */
  order: number
}

export const ADMIN_NAV_SECTIONS: { key: AdminSection; labelKey: string }[] = [
  { key: 'overview', labelKey: 'nav.sectionOverview' },
  { key: 'operations', labelKey: 'nav.sectionOperations' },
  { key: 'management', labelKey: 'nav.sectionManagement' },
  { key: 'audit', labelKey: 'nav.sectionAudit' },
  { key: 'messages', labelKey: 'nav.sectionMessages' },
]

/**
 * ADMIN_NAV_FALLBACK is the console's own menu, used when no plugin contributes
 * navigation. It is the menu the shell has always had; keeping it here is what
 * makes the plugin removable without emptying the console.
 */
export const ADMIN_NAV_FALLBACK: AdminNavItem[] = [
  { id: 'overview', path: '/admin/overview', labelKey: 'nav.dashboard', section: 'overview', icon: iconForPanel('layout-dashboard'), order: 10 },
  { id: 'components', path: '/admin/components', labelKey: 'nav.components', section: 'overview', icon: iconForPanel('boxes'), order: 20 },
  { id: 'users', path: '/admin/users', labelKey: 'nav.users', section: 'operations', icon: iconForPanel('users'), order: 10 },
  { id: 'configs', path: '/admin/configs', labelKey: 'nav.configCenter', section: 'management', icon: iconForPanel('sliders-horizontal'), order: 10 },
  { id: 'directory', path: '/admin/directory', labelKey: 'nav.directoryLogin', section: 'management', icon: iconForPanel('key-round'), order: 20 },
  { id: 'voice', path: '/admin/voice', labelKey: 'nav.voiceInput', section: 'management', icon: iconForPanel('mic'), order: 30 },
  { id: 'models', path: '/admin/models', labelKey: 'nav.modelCenter', section: 'management', icon: iconForPanel('cpu'), order: 40 },
  { id: 'capabilities', path: '/admin/capabilities', labelKey: 'nav.capabilityCenter', section: 'management', icon: iconForPanel('blocks'), order: 50 },
  { id: 'agent-types', path: '/admin/agent-types', labelKey: 'nav.agentCenter', section: 'management', icon: iconForPanel('bot'), order: 60 },
  { id: 'audit', path: '/admin/audit', labelKey: 'nav.operationLogs', section: 'audit', icon: iconForPanel('scroll-text'), order: 10 },
  { id: 'conversations', path: '/admin/conversations', labelKey: 'nav.conversationLogs', section: 'audit', icon: iconForPanel('message-square'), order: 20 },
  { id: 'runtime', path: '/admin/runtime', labelKey: 'nav.runtimeLogs', section: 'audit', icon: iconForPanel('activity'), order: 30 },
  { id: 'alerts', path: '/admin/alerts', labelKey: 'nav.alertRules', section: 'messages', icon: iconForPanel('bell'), order: 10 },
]

const KNOWN_SECTIONS = new Set<string>(ADMIN_NAV_SECTIONS.map((section) => section.key))

/**
 * buildAdminNavItems turns the plugins' navigation entries into menu items,
 * falling back to the console's own list when nothing contributes.
 *
 * An entry that names an unknown (or no) section is visible to `admin` only: the
 * shell must never widen access because a manifest forgot a field.
 */
export function buildAdminNavItems(nav?: NavContribution[], titles?: Map<string, string>): AdminNavItem[] {
  if (!nav || nav.length === 0) {
    return ADMIN_NAV_FALLBACK
  }
  const items = nav.map((entry) => {
    const section = entry.section && KNOWN_SECTIONS.has(entry.section) ? (entry.section as AdminSection) : undefined
    return {
      id: entry.id,
      path: entry.path,
      label: titles?.get(entry.id),
      section,
      icon: iconForPanel(entry.icon),
      order: entry.order,
    }
  })
  // Stable within an order: the sort only reorders across different `order`s.
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.order - b.item.order || a.index - b.index)
    .map(({ item }) => item)
}

/** adminNavVisible reports whether the signed-in role may see one entry. */
export function adminNavVisible(item: AdminNavItem, role?: string): boolean {
  if (!item.section) {
    return role === 'admin'
  }
  return canAccessSection(role, item.section)
}

export function itemForPath(items: AdminNavItem[], pathname: string): AdminNavItem | undefined {
  return items.find((item) => {
    if (item.path === '/admin/overview') {
      return pathname === item.path
    }
    return pathname === item.path || pathname.startsWith(item.path + '/')
  })
}

// A crumb shows `labelKey` (translated) or `label`. `title` is the hover hint
// for what a friendly label hides — the raw id behind an account name.
export type Crumb = { labelKey?: string; label?: string; to?: string; title?: string }

export function breadcrumbsForPath(pathname: string, items: AdminNavItem[] = ADMIN_NAV_FALLBACK): Crumb[] {
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
  const item = itemForPath(items, pathname)
  if (item) {
    return [{ labelKey: item.labelKey, label: item.label }]
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

// SECTION_ROLES is re-exported for the sidebar's section headings: the console
// groups entries by section and hides an empty group.
export { SECTION_ROLES }
