// The admin breadcrumb is derived from the URL alone, but an account's URL
// carries its id — not what a reader wants to see in the header. The crumb
// therefore falls back to a generic label and lets the page hand over the
// display name (useCrumbLabel); the id stays reachable on hover.
import { describe, expect, it } from 'vitest'
import { breadcrumbsForPath, withCrumbOverride } from './navigation'

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
