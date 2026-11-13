import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, Bell, Menu, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApi } from '../hooks/useApi'
import type { AdminIdentity } from '../lib/api'
import { logout, USER_API_BASE } from '../lib/api'
import { clearSession } from '../lib/auth'
import { ADMIN_NAV_ITEMS, ADMIN_NAV_SECTIONS, adminNavVisible, itemForPath } from '../lib/navigation'
import { Breadcrumbs, CrumbLabelProvider } from './breadcrumbs'
import { Button } from './ui/button'
import { ErrorBoundary } from './ui/error-boundary'
import { IdentityMenu } from './identity-menu'
import { LanguageToggle } from './language-toggle'
import { ThemeToggle } from './theme-toggle'
import { OverviewPage } from '../pages/OverviewPage'
import { ComponentsPage } from '../pages/ComponentsPage'
import { UsersPage } from '../pages/UsersPage'
import { PluginPage } from '../portal/PluginPage'
import { UserDetailPage } from '../pages/UserDetailPage'
import { ConfigsPage } from '../pages/ConfigsPage'
import { DirectoryPage } from '../pages/DirectoryPage'
import { ModelsPage } from '../pages/ModelsPage'
import { VoicePage } from '../pages/VoicePage'
import AgentTypesPage from '../pages/AgentTypesPage'
import { AuditPage } from '../pages/AuditPage'
import { ConversationLogsPage } from '../pages/ConversationLogsPage'
import { RuntimeLogsPage } from '../pages/RuntimeLogsPage'
import { AlertsPage } from '../pages/AlertsPage'
import CapabilitiesPage from '../pages/CapabilitiesPage'

function Brand() {
  const { t } = useTranslation()
  return (
    <Link to="/admin/overview" className="flex items-center gap-2.5 px-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
        N
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold tracking-tight">{t('nav.adminPanel')}</p>
        <p className="text-xs text-muted-foreground">{t('nav.adminTagline')}</p>
      </div>
    </Link>
  )
}

function SidebarNav({ role }: { role?: string }) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const active = itemForPath(pathname)

  return (
    <nav className="flex flex-col gap-5 px-3" aria-label={t('nav.primary')}>
      {ADMIN_NAV_SECTIONS.map((section) => {
        const items = ADMIN_NAV_ITEMS.filter(
          (item) => item.section === section.key && adminNavVisible(item, role),
        )
        if (items.length === 0) {
          return null
        }
        return (
          <div key={section.key} className="flex flex-col gap-1">
            <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t(section.labelKey)}
            </p>
            {items.map((item) => {
              const isActive = active?.path === item.path
              const Icon = item.icon
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`group flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <Icon
                    className={`h-4.5 w-4.5 shrink-0 ${
                      isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                    }`}
                  />
                  {t(item.labelKey)}
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
function SectionGuard({ role, children }: { role?: string; children: ReactNode }) {
  const { pathname } = useLocation()
  const item = itemForPath(pathname)
  if (item && !adminNavVisible(item, role)) {
    const fallback = ADMIN_NAV_ITEMS.find((candidate) => adminNavVisible(candidate, role))
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
          className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col gap-6 overflow-y-auto border-r bg-card p-4 pt-6 transition-transform lg:z-40 lg:translate-x-0 ${
            navOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <Brand />
          <SidebarNav role={data?.role} />
          <div className="mt-auto rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Bell className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground">{t('nav.adminPanel')}</span>
            </div>
            <p className="mt-1.5 leading-relaxed">{t('nav.adminFooter')}</p>
          </div>
        </div>

        <div className="lg:pl-64">
          <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
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
              <Breadcrumbs />
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
          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <SectionGuard role={data.role}>
              {/* One page throwing must not take the console's chrome with it:
                  the boundary keeps the sidebar and the way back, and clears
                  itself when the route changes. */}
              <ErrorBoundary resetKey={pathname}>
                <Routes>
                <Route path="" element={<Navigate to="overview" replace />} />
                <Route path="overview" element={<OverviewPage />} />
                <Route path="components" element={<ComponentsPage />} />
                <Route path="components/:type" element={<ComponentsPage />} />
                {/* The account list is the auth module's page (it ships at /plugins/auth/);
                    the shell's own page stays as the fallback when that plugin is not
                    installed, which is also what keeps its utility classes compiled. */}
                <Route path="users" element={<PluginPage path="/admin/users" fallback={<UsersPage />} />} />
                <Route path="users/:id" element={<UserDetailPage />} />
                <Route path="configs" element={<ConfigsPage />} />
                <Route path="directory" element={<DirectoryPage />} />
                <Route path="voice" element={<VoicePage />} />
                <Route path="models" element={<ModelsPage />} />
                <Route path="agent-types" element={<AgentTypesPage />} />
                <Route path="audit" element={<AuditPage />} />
                <Route path="conversations" element={<ConversationLogsPage />} />
                {/* The runtime snapshot is the admin module's page (it ships at
                    /plugins/admin/); the shell's own page is the fallback. */}
                <Route
                  path="runtime"
                  element={<PluginPage path="/admin/runtime" fallback={<RuntimeLogsPage />} />}
                />
                <Route path="alerts" element={<AlertsPage />} />
                <Route path="capabilities" element={<CapabilitiesPage />} />
                <Route path="files" element={<Navigate to="/admin/users" replace />} />
                </Routes>
              </ErrorBoundary>
            </SectionGuard>
          </main>
        </div>
      </div>
    </CrumbLabelProvider>
  )
}
