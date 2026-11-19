import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Layers, LayoutGrid, Shield } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApi } from '../hooks/useApi'
import type { AdminIdentity } from '../lib/api'
import { logout, USER_API_BASE } from '../lib/api'
import { clearSession } from '../lib/auth'
import { canAccessAdminPanel } from '../lib/roles'
import { BrandMark } from './brand-mark'
import { IdentityMenu } from './identity-menu'
import { LanguageToggle } from './language-toggle'
import { ThemeToggle } from './theme-toggle'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

function Brand() {
  return (
    <Link to="/agent" className="flex items-center gap-2.5">
      <BrandMark className="h-7 w-7" />
      <div className="hidden sm:block">
        <p className="text-sm font-semibold tracking-tight">NanoSec</p>
      </div>
    </Link>
  )
}

const NAV_LINKS = [
  // The workspace is the whole panel frame (agents, conversation, files,
  // terminal), so it gets a layout icon rather than the conversation's own
  // speech bubble, which the chat panel inside already uses.
  { to: '/agent', labelKey: 'nav.workspace', icon: LayoutGrid },
  // The library is a full-page surface of its own, not a workbench panel: it
  // owns its routing (inside an iframe) and must not be squeezed into the
  // reading-width container the account pages use.
  { to: '/artifacts', labelKey: 'nav.artifacts', icon: Layers },
]

export function UserLayout() {
  const { t } = useTranslation()
  const { data } = useApi<AdminIdentity>('/me', USER_API_BASE)
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const signOut = () => {
    void logout()
    clearSession()
    navigate('/login', { replace: true })
  }

  const showAdminPanel = canAccessAdminPanel(data?.role)
  const isFullBleed = pathname === '/agent' || pathname.startsWith('/artifacts')

  return (
    <div className={isFullBleed ? 'flex h-dvh flex-col overflow-hidden bg-background' : 'min-h-screen bg-background'}>
      <header className="ui-shell-header-compact sticky top-0 z-40 flex items-center gap-3 border-b bg-sidebar px-4 backdrop-blur-md sm:px-6">
        <Brand />

        <nav className="ml-6 hidden items-center gap-1 md:flex" aria-label={t('nav.primary')}>
          {NAV_LINKS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? 'rail-active bg-primary-weak text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`
              }
            >
              <item.icon className="h-3.5 w-3.5" />
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <LanguageToggle />
          <ThemeToggle />

          {showAdminPanel ? (
            <span className="flex">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" asChild aria-label={t('nav.openAdmin')}>
                    <Link to="/admin">
                      <Shield className="h-4 w-4" />
                      <span className="hidden sm:inline">{t('nav.adminPanel')}</span>
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('nav.openAdmin')}</TooltipContent>
              </Tooltip>
            </span>
          ) : null}

          <IdentityMenu identity={data} onSignOut={signOut} showMyAccount />
        </div>
      </header>

      <main
        className={
          isFullBleed
            ? 'flex min-h-0 flex-1 flex-col'
            : 'mx-auto max-w-5xl px-4 py-[var(--ui-pad-page)] sm:px-6 lg:px-8'
        }
      >
        <Outlet />
      </main>
    </div>
  )
}
