import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, Bell, Menu, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApi } from '../hooks/useApi'
import type { AdminIdentity } from '../lib/api'
import { logout, USER_API_BASE } from '../lib/api'
import { clearSession } from '../lib/auth'
import {
  ADMIN_NAV_SECTIONS,
  adminNavVisible,
  buildAdminNavItems,
  itemForPath,
  type AdminNavItem,
} from '../lib/navigation'
import { localizedTitle } from '../portal/remote'
import { usePluginNav } from '../portal/registry'
import { Breadcrumbs, CrumbLabelProvider } from './breadcrumbs'
import { Button } from './ui/button'
import { ErrorBoundary } from './ui/error-boundary'
import { IdentityMenu } from './identity-menu'
import { LanguageToggle } from './language-toggle'
import { ThemeToggle } from './theme-toggle'
import { PluginPage } from '../portal/PluginPage'

function Brand() {
  const { t } = useTranslation()
  return (
    <Link to="/admin/overview" className="flex items-center gap-2.5 px-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2 text-sm font-bold text-primary">
        N
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold tracking-tight">{t('nav.adminPanel')}</p>
        <p className="text-xs text-muted-foreground">{t('nav.adminTagline')}</p>
      </div>
    </Link>
  )
}

function SidebarNav({ role, items }: { role?: string; items: AdminNavItem[] }) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const active = itemForPath(items, pathname)

  return (
    <nav className="flex flex-col gap-5 px-3" aria-label={t('nav.primary')}>
      {ADMIN_NAV_SECTIONS.map((section) => {
        const sectionItems = items.filter(
          (item) => item.section === section.key && adminNavVisible(item, role),
        )
        if (sectionItems.length === 0) {
          return null
        }
        return (
          <div key={section.key} className="flex flex-col gap-1">
            <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t(section.labelKey)}
            </p>
            {sectionItems.map((item) => {
              const isActive = active?.path === item.path
              const Icon = item.icon
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`group flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'rail-active bg-primary-weak text-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <Icon
                    className={`h-4.5 w-4.5 shrink-0 ${
                      isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                    }`}
                  />
                  {item.labelKey ? t(item.labelKey) : item.label}
                </Link>
              )
            })}
          </div>
        )
      })}
    </nav>
  )
}

function NoAccessNotice() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
      <ShieldAlert className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">{t('nav.noAdminAccess')}</p>
      <p className="text-xs text-muted-foreground">{t('nav.noAdminAccessHint')}</p>
    </div>
  )
}

// Guards the current route by section. The server enforces the same rules; this
// only prevents rendering a section the signed-in role cannot access.
function SectionGuard({ role, items, children }: { role?: string; items: AdminNavItem[]; children: ReactNode }) {
  const { pathname } = useLocation()
  const item = itemForPath(items, pathname)
  if (item && !adminNavVisible(item, role)) {
    const fallback = items.find((candidate) => adminNavVisible(candidate, role))
    if (fallback) {
      return <Navigate to={fallback.path} replace />
    }
    return <NoAccessNotice />
  }
  return <>{children}</>
}

export default function AdminLayout() {
  const { t } = useTranslation()
  const { data, loading } = useApi<AdminIdentity>('/me', USER_API_BASE)
  // The menu is the admin module's data: its manifest declares the entries and
  // this only applies the shell's sections and roles. With no plugin installed the
  // console keeps its own list (ADMIN_NAV_FALLBACK), so removing the plugin is a
  // rollback rather than an empty console.
  const { nav } = usePluginNav()
  const { i18n } = useTranslation()
  const language = i18n.language
  const navTitles = useMemo(
    () => new Map(nav.map((entry) => [entry.id, localizedTitle(entry.title, language)])),
    [nav, language],
  )
  const items = useMemo(() => buildAdminNavItems(nav, navTitles), [nav, navTitles])
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // Below `lg` the sidebar is a drawer: the fixed 256px column would leave a
  // phone about 119px of content. It closes on navigation, on the backdrop and
  // on Escape, so it never covers the page the user just asked for.
  const [navOpen, setNavOpen] = useState(false)

  // Close on navigation. Doing it while rendering (rather than in an effect)
  // follows the same "adjust state when the input changes" pattern the chat pane
  // uses, and keeps the drawer from covering the page the user just asked for.
  const [navPath, setNavPath] = useState(pathname)
  if (navPath !== pathname) {
    setNavPath(pathname)
    setNavOpen(false)
  }

  useEffect(() => {
    if (!navOpen) {
      return
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNavOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  const signOut = () => {
    void logout()
    clearSession()
    navigate('/login', { replace: true })
  }

  if (loading || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        {t('nav.loadingAdmin')}
      </div>
    )
  }

  return (
    <CrumbLabelProvider>
      <div className="min-h-screen bg-background">
        {navOpen ? (
          <div
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
            onClick={() => setNavOpen(false)}
            aria-hidden="true"
          />
        ) : null}
        {/* One element serves both shapes: fixed on `lg`, a drawer below it. */}
        <div
          id="admin-nav"
          className={`ui-shell-sidebar fixed inset-y-0 left-0 z-50 flex flex-col gap-6 overflow-y-auto border-r border-border bg-sidebar p-4 pt-6 transition-transform lg:z-40 lg:translate-x-0 ${
            navOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <Brand />
          <SidebarNav role={data?.role} items={items} />
          <div className="mt-auto rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Bell className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground">{t('nav.adminPanel')}</span>
            </div>
            <p className="mt-1.5 leading-relaxed">{t('nav.adminFooter')}</p>
          </div>
        </div>

        <div className="lg:pl-64">
          <header className="ui-shell-header sticky top-0 z-30 flex items-center gap-3 border-b bg-sidebar px-4 backdrop-blur-md sm:px-6">
            <button
              type="button"
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
              onClick={() => setNavOpen((open) => !open)}
              aria-label={t('nav.openMenu')}
              aria-expanded={navOpen}
              aria-controls="admin-nav"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex min-w-0 flex-1 items-center">
              <Breadcrumbs items={items} />
            </div>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/agent">
                  <ArrowLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('nav.backToApp')}</span>
                </Link>
              </Button>
              <LanguageToggle />
              <ThemeToggle />
              <IdentityMenu identity={data} onSignOut={signOut} />
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-4 py-[var(--ui-pad-page)] sm:px-6 lg:px-8">
            <SectionGuard role={data.role} items={items}>
              {/* One page throwing must not take the console's chrome with it:
                  the boundary keeps the sidebar and the way back, and clears
                  itself when the route changes. */}
              <ErrorBoundary resetKey={pathname}>
                <Routes>
                <Route path="" element={<Navigate to="overview" replace />} />
                {/* One route per menu entry, generated from the same list the
                    sidebar renders: a screen cannot be reachable in the menu and
                    missing from the router, or the other way round. The screen
                    itself belongs to the admin or auth module; the shell keeps no
                    copy, so a missing plugin reports "unavailable" instead of
                    rendering a second implementation. */}
                {items.map((item) => (
                  <Route
                    key={item.id}
                    path={item.path.replace(/^\/admin\/?/, '')}
                    element={<PluginPage />}
                  />
                ))}
                {/* Two routes the menu cannot express: a parameterised detail page,
                    and the component filter's deep link. */}
                <Route path="users/:id" element={<PluginPage />} />
                <Route path="components/:type" element={<PluginPage />} />
                <Route path="files" element={<Navigate to="/admin/users" replace />} />
                <Route path="*" element={<Navigate to="overview" replace />} />
              </Routes>
              </ErrorBoundary>
            </SectionGuard>
          </main>
        </div>
      </div>
    </CrumbLabelProvider>
  )
}
