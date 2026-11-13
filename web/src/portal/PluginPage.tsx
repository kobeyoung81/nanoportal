// Mounting a route a plugin owns.
//
// The shell's own page is the fallback: with no plugin claiming the path (or with
// the page removed from the manifest) the built-in page renders exactly as
// before, so turning a plugin off is a manifest change, not a code change.

import { useCallback, useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { PageContext } from './contract'
import { portalApi } from './api'
import { portalUI } from './ui'
import { usePluginPages } from './registry'
import { getSession, getToken } from '../lib/auth'
import { useTheme } from '../lib/theme'

/** The context a page gets: a panel's context plus the kit, the strings and the client. */
function usePageContext(): PageContext {
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
    }),
    [userId, i18n.language, resolvedTheme, navigate, translate],
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
  const ctx = usePageContext()
  const page = pages.find((candidate) => candidate.path === path)
  if (!page) {
    return <>{fallback}</>
  }
  const Component = page.Component
  return <Component ctx={ctx} />
}
