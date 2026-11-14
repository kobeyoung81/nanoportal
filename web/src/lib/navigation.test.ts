// The admin breadcrumb is derived from the URL alone, but an account's URL
// carries its id — not what a reader wants to see in the header. The crumb
// therefore falls back to a generic label and lets the page hand over the
// display name (useCrumbLabel); the id stays reachable on hover.
import { describe, expect, it } from 'vitest'
import {
  ADMIN_NAV_FALLBACK,
  adminNavVisible,
  breadcrumbsForPath,
  buildAdminNavItems,
  itemForPath,
  withCrumbOverride,
} from './navigation'
import type { NavContribution } from '../portal/contract'

const USER_ID = '139c8895-6a27-45ef-b793-8bd23f72a321'

describe('breadcrumbsForPath', () => {
  it('names the account section and keeps the user id out of the visible text', () => {
    expect(breadcrumbsForPath(`/admin/users/${USER_ID}`)).toEqual([
      { labelKey: 'nav.users', to: '/admin/users' },
      { labelKey: 'userDetail.userFallback', title: USER_ID },
    ])
  })

  it('decodes the id it keeps for the hover hint', () => {
    expect(breadcrumbsForPath('/admin/users/a%20b')).toEqual([
      { labelKey: 'nav.users', to: '/admin/users' },
      { labelKey: 'userDetail.userFallback', title: 'a b' },
    ])
  })

  it('keeps the component type as a label (it is a name, not an id)', () => {
    expect(breadcrumbsForPath('/admin/components/nanobus')).toEqual([
      { labelKey: 'nav.components', to: '/admin/components' },
      { label: 'nanobus' },
    ])
  })

  it('still resolves the static sections', () => {
    expect(breadcrumbsForPath('/admin/overview')).toEqual([{ labelKey: 'nav.dashboard' }])
    expect(breadcrumbsForPath('/agent')).toEqual([{ labelKey: 'nav.agent' }])
    expect(breadcrumbsForPath('/nonsense')).toEqual([{ labelKey: 'nav.unknown' }])
  })
})

describe('withCrumbOverride', () => {
  const path = `/admin/users/${USER_ID}`
  const crumbs = breadcrumbsForPath(path)

  it('shows the name the page resolved', () => {
    expect(withCrumbOverride(crumbs, path, { path, label: 'Stephanie' })).toEqual([
      { labelKey: 'nav.users', to: '/admin/users' },
      { label: 'Stephanie', title: USER_ID },
    ])
  })

  it('drops labelKey, which the renderer would otherwise prefer over the name', () => {
    expect(withCrumbOverride(crumbs, path, { path, label: 'Stephanie' }).at(-1)?.labelKey).toBeUndefined()
  })

  it('leaves the crumbs alone while the name is unknown', () => {
    expect(withCrumbOverride(crumbs, path, null)).toBe(crumbs)
  })

  it('lets an override bring its own hover hint', () => {
    const override = { path, label: 'Stephanie', title: 'steffy' }
    expect(withCrumbOverride(crumbs, path, override).at(-1)?.title).toBe('steffy')
  })

  it('ignores a name registered for a route the reader has already left', () => {
    const override = { path, label: 'Stephanie' }
    expect(withCrumbOverride(breadcrumbsForPath('/admin/overview'), '/admin/overview', override)).toEqual([
      { labelKey: 'nav.dashboard' },
    ])
  })

  it('is a no-op on an empty trail', () => {
    expect(withCrumbOverride([], path, { path, label: 'Stephanie' })).toEqual([])
  })
})

describe('the registry-driven menu', () => {
  const contributed: NavContribution[] = [
    { id: 'admin.reports', parent: 'admin', path: '/admin/reports', title: { en: 'Reports' }, icon: 'scroll-text', section: 'audit', order: 5 },
    { id: 'admin.overview', parent: 'admin', path: '/admin/overview', title: { en: 'Overview' }, icon: 'layout-dashboard', section: 'overview', order: 1 },
  ]

  it('falls back to the console\'s own menu when no plugin contributes', () => {
    expect(buildAdminNavItems([])).toBe(ADMIN_NAV_FALLBACK)
    expect(buildAdminNavItems(undefined)).toBe(ADMIN_NAV_FALLBACK)
  })

  it('orders the contributions and keeps their sections', () => {
    const items = buildAdminNavItems(contributed)
    expect(items.map((item) => item.path)).toEqual(['/admin/overview', '/admin/reports'])
    expect(items[1].section).toBe('audit')
    expect(items[1].label).toBeUndefined()
  })

  it('resolves a localized title through the map the layout passes', () => {
    const titles = new Map([['admin.reports', '报表']])
    expect(buildAdminNavItems(contributed, titles)[1].label).toBe('报表')
  })

  it('shows an entry with an unknown section to administrators only', () => {
    const [unknown] = buildAdminNavItems([
      { id: 'x.one', path: '/admin/one', title: { en: 'One' }, icon: 'boxes', section: 'invented', order: 1 },
    ])
    expect(adminNavVisible(unknown, 'admin')).toBe(true)
    expect(adminNavVisible(unknown, 'operator')).toBe(false)
    expect(adminNavVisible(unknown, undefined)).toBe(false)
  })

  it('keeps the section roles in the shell, not in the manifest', () => {
    const items = buildAdminNavItems(contributed)
    const reports = items[1]
    expect(adminNavVisible(reports, 'auditor')).toBe(true)
    expect(adminNavVisible(reports, 'support')).toBe(false)
  })

  it('matches a nested route to its menu entry', () => {
    const items = buildAdminNavItems(contributed)
    expect(itemForPath(items, '/admin/reports/2026')?.path).toBe('/admin/reports')
    expect(itemForPath(items, '/admin/unknown')).toBeUndefined()
  })
})
