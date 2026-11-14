// Hosting a panel that lives in another application.
//
// The shell owns the frame, the loading state and the retry; the application
// owns its content. A failed remote must look like a failed panel, not a broken
// workbench, so every failure is caught here and rendered inside the panel.

import { useEffect, useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import type { PanelComponent, PanelContext } from './contract'
import { loadPanelComponent } from './loader'
import { Button } from '../components/ui/button'
import { Spinner } from '../components/ui/spinner'

type Attempt = { key: number; component: PanelComponent } | { key: number; error: string }

type PanelSpec = { entry: string; module: string; export: string }

/**
 * makeRemotePanel binds a panel spec to a component with the panel contract's
 * signature. The spec comes from the manifest and never changes for a given
 * panel id, so the loading effect only re-runs on retry.
 */
export function makeRemotePanel(spec: PanelSpec): ComponentType<{ ctx: PanelContext }> {
  function RemotePanel({ ctx }: { ctx: PanelContext }) {
    const { t } = useTranslation()
    const [attempt, setAttempt] = useState(0)
    // The result carries the attempt it belongs to: a stale reply from an
    // earlier try must not overwrite the one on screen, and comparing the key
    // during render avoids a second render pass just to show "loading".
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
    // `spec` is fixed for the lifetime of the panel (see makeRemotePanel).
    }, [attempt])

    if (!result || result.key !== attempt) {
      return (
        <div className="flex h-full items-center justify-center" data-remote-panel-loading="">
          <Spinner label={t('workbench.remote.loading')} />
        </div>
      )
    }
    if ('error' in result) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" data-remote-panel-error="">
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
  return RemotePanel
}
