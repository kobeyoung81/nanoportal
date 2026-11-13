// Hosting a page that lives in another application.
//
// A page is a panel with a route: the shell owns the route, the loading state and
// the retry; the application owns its screen. The page renders inside the shell's
// React tree, so it inherits theme, language and the router — which is what makes
// it a page rather than an iframe.

import { useEffect, useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import type { PageComponent, PortalContext } from './contract'
import { loadPanelComponent } from './loader'
import { Button } from '../components/ui/button'
import { Spinner } from '../components/ui/spinner'

type Attempt = { key: number; component: PageComponent } | { key: number; error: string }

type PageSpec = { entry: string; module: string; export: string }

/**
 * makeRemotePage binds a page spec to a component with the page contract's
 * signature. The spec comes from the manifest and never changes for a given
 * page, so the loading effect only re-runs on retry.
 */
export function makeRemotePage(spec: PageSpec): ComponentType<{ ctx: PortalContext }> {
  function RemotePage({ ctx }: { ctx: PortalContext }) {
    const { t } = useTranslation()
    const [attempt, setAttempt] = useState(0)
    const [result, setResult] = useState<Attempt | null>(null)

    useEffect(() => {
      let alive = true
      loadPanelComponent(spec).then(
        (component) => {
          if (alive) setResult({ key: attempt, component })
        },
        (error: unknown) => {
          if (alive) setResult({ key: attempt, error: error instanceof Error ? error.message : String(error) })
        },
      )
      return () => {
        alive = false
      }
      // `spec` is fixed for the lifetime of the page (see makeRemotePage).
    }, [attempt])

    if (!result || result.key !== attempt) {
      return (
        <div className="flex h-full items-center justify-center" data-remote-page-loading="">
          <Spinner label={t('workbench.remote.loading')} />
        </div>
      )
    }
    if ('error' in result) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" data-remote-page-error="">
          <p className="text-sm text-muted-foreground">{t('workbench.remote.unavailable')}</p>
          <p className="max-w-full break-words text-xs text-muted-foreground/80">{result.error}</p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
            {t('workbench.remote.retry')}
          </Button>
        </div>
      )
    }
    const Component = result.component
    return <Component ctx={ctx} />
  }
  return RemotePage
}
