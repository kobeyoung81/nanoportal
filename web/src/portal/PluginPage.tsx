// Mounting a route a plugin owns.
//
// The shell's own page is the fallback: with no plugin claiming the path (or with
// the page removed from the manifest) the built-in page renders exactly as
// before, so turning a plugin off is a manifest change, not a code change.

import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { matchPath, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { PageContext, PortalFeatures, SessionSnapshot } from './contract'
import { portalApi } from './api'
import { portalUI } from './ui'
import { usePluginPages } from './registry'
import { getSession, getToken, setSession, toStoredSession } from '../lib/auth'
import { setPageHost } from './pageHost'
import { CrumbLabelContext } from '../lib/crumbLabel'
import { useTheme } from '../lib/theme'
import { AgentFormDialog } from '../components/agent-form-dialog'
import { USER_API_BASE, fetchJson, type AgentDetail } from '../lib/api'
import { resetVoiceConfigCache } from '../voice/useVoiceConfig'

/**
 * The shell features a page may invoke.
 *
 * The agent editor belongs to the portal (it owns the agent rows), so a page asks
 * for it by id instead of rebuilding it; the shell loads the agent and owns the
 * dialog's lifetime.
 */
function usePageFeatures(): { features: PortalFeatures; dialog: ReactNode } {
  const { t } = useTranslation()
  const [request, setRequest] = useState<{
    userId: string
    agentId?: string
    onSaved?: () => void
    agent: AgentDetail | null
  } | null>(null)

  const openAgentForm = useCallback(
    (next: { userId: string; agentId?: string; onSaved?: () => void }) => {
      if (!next.agentId) {
        setRequest({ userId: next.userId, onSaved: next.onSaved, agent: null })
        return
      }
      void fetchJson<AgentDetail>(`/agents/${encodeURIComponent(next.agentId)}`, USER_API_BASE)
        .then((agent) => setRequest({ ...next, agent }))
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : t('errors.requestFailed', { status: 0 }))
        })
    },
    [t],
  )

  const features = useMemo(
    () => ({
      // The login and registration pages hand over a session; the shell stores it
      // (and purges another account's caches when the browser switches user).
      signIn: (next: SessionSnapshot) => {
        const session = toStoredSession(next)
        if (!session) {
          // A page that forgot the tokens would otherwise leave the browser
          // "signed in" with an identity and no credential.
          console.error('[portal] signIn was called without an access token')
          return
        }
        setSession(session)
      },
      patchSession: (patch: Partial<SessionSnapshot>) => {
        const current = getSession()
        if (current) {
          setSession({ ...current, ...patch })
        }
      },
      openAgentForm,
      // The dictation card asks the shell to forget its cached settings: the
      // composer reads the same configuration and must not keep the old one.
      refreshVoiceConfig: () => resetVoiceConfigCache(),
    }),
    [openAgentForm],
  )

  const dialog = request ? (
    <AgentFormDialog
      key={request.agentId ?? 'create'}
      open
      onOpenChange={(open) => {
        if (!open) {
          setRequest(null)
        }
      }}
      agent={request.agent}
      showUserPicker={false}
      defaultUserId={request.userId}
      onSaved={() => request.onSaved?.()}
    />
  ) : null

  return { features, dialog }
}

/** The context a page gets: a panel's context plus the kit, the strings and the client. */
function usePageContext(features: PortalFeatures, params: Record<string, string>): PageContext {
  const { i18n, t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const userId = getSession()?.user_id ?? ''
  // Depend on the setter, not on the context object: the provider hands out a new
  // object on every render, and a setter whose identity changed that often would
  // make every page effect that publishes a crumb re-run on every render — which
  // is a render loop, not an update.
  const setCrumbValue = useContext(CrumbLabelContext).setValue
  const setCrumb = useCallback(
    (label: string | null, title?: string) => {
      setCrumbValue(label ? { path: pathname, label, title } : null)
    },
    [setCrumbValue, pathname],
  )
  const translate = useCallback(
    (key: string, options?: Record<string, unknown>) => t(key, options),
    [t],
  )
  return useMemo(
    () => ({
      token: getToken() ?? '',
      userId,
      // A page may read the session (the forced-change screen) and the query
      // string (the login page's ?next=); both are the shell's data.
      session: (() => {
        const stored = getSession()
        return stored
          ? {
              user_id: stored.user_id,
              role: stored.role,
              display_name: stored.display_name,
              must_change_password: stored.must_change_password,
            }
          : { user_id: '' }
      })(),
      query: Object.fromEntries(new URLSearchParams(search).entries()),
      locale: i18n.language,
      theme: resolvedTheme,
      navigate: (path: string) => navigate(path),
      openPanel: () => {},
      t: translate,
      params,
      setCrumb,
      ui: portalUI,
      api: portalApi,
      features,
      toast: { success: toast.success, info: toast.info, warning: toast.warning, error: toast.error },
    }),
    [userId, i18n.language, resolvedTheme, navigate, translate, params, setCrumb, features],
  )
}

/**
 * PluginPage renders the plugin that owns `path`, or `fallback` when none does.
 *
 * The fallback is deliberately silent: an entry that is not in the manifest is a
 * configuration choice, not a failure. A plugin that *is* listed but fails to load
 * shows the error and a retry, because that is a real failure and hiding it would
 * silently swap the screen the user expected.
 */
export function PluginPage({ fallback }: { fallback: ReactNode }) {
  const { pages } = usePluginPages()
  const { features, dialog } = usePageFeatures()
  const { pathname } = useLocation()
  const rawParams = useParams()
  // React Router types a param as possibly undefined; the page contract says a
  // missing parameter is the empty string, which is what a page can render.
  const params = useMemo(() => {
    const filled: Record<string, string> = {}
    for (const [key, value] of Object.entries(rawParams)) {
      filled[key] = value ?? ''
    }
    return filled
  }, [rawParams])
  // A contribution may be a pattern (`/admin/users/:id`), so the match is a route
  // match against the current location rather than a string compare.
  const page = pages.find((candidate) => matchPath({ path: candidate.path, end: true }, pathname) !== null)
  const ctx = usePageContext(features, params)
  // The shell's borrowed components (the file browser) read the page they are on
  // from here. Install it before anything below renders.
  setPageHost(ctx)
  // The breadcrumb belongs to the shell: a page publishes a name and the shell
  // clears it when the page goes away, so the next route never inherits it.
  useEffect(() => () => ctx.setCrumb(null), [ctx.setCrumb])
  if (!page) {
    return <>{fallback}</>
  }
  const Component = page.Component
  return (
    <>
      <Component ctx={ctx} />
      {dialog}
    </>
  )
}
