// Mounting a route a plugin owns.
//
// The shell's own page is the fallback: with no plugin claiming the path (or with
// the page removed from the manifest) the built-in page renders exactly as
// before, so turning a plugin off is a manifest change, not a code change.

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { PortalFeatures, PageContext } from './contract'
import { portalApi } from './api'
import { portalUI } from './ui'
import { usePluginPages } from './registry'
import { getSession, getToken } from '../lib/auth'
import { useTheme } from '../lib/theme'
import { AgentFormDialog } from '../components/agent-form-dialog'
import { USER_API_BASE, fetchJson, type AgentDetail } from '../lib/api'

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

  const features = useMemo(() => ({ openAgentForm }), [openAgentForm])

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
function usePageContext(features: PortalFeatures): PageContext {
  const { i18n, t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const navigate = useNavigate()
  const userId = getSession()?.user_id ?? ''
  const translate = useCallback(
    (key: string, options?: Record<string, unknown>) => t(key, options),
    [t],
  )
  return useMemo(
    () => ({
      token: getToken() ?? '',
      userId,
      locale: i18n.language,
      theme: resolvedTheme,
      navigate: (path: string) => navigate(path),
      openPanel: () => {},
      t: translate,
      ui: portalUI,
      api: portalApi,
      features,
      toast: { success: toast.success, error: toast.error },
    }),
    [userId, i18n.language, resolvedTheme, navigate, translate, features],
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
export function PluginPage({ path, fallback }: { path: string; fallback: ReactNode }) {
  const { pages } = usePluginPages()
  const { features, dialog } = usePageFeatures()
  const ctx = usePageContext(features)
  const page = pages.find((candidate) => candidate.path === path)
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
