// The file browser a page embeds.
//
// The component is the workspace module's (it owns the bytes, the previews and the
// dialogs), and the manifest says where to find it. The shell borrows it and hands
// over the page's context, so the same implementation serves a page in this shell
// and the workspace's own /files page. The shell keeps no copy of its own: a
// second implementation drifted from this one, so a missing plugin now says so
// instead of quietly rendering an older browser.

import { createElement, useEffect, useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import type { PageContext } from './contract'
import { loadExportedComponent } from './loader'
import { getPageHost } from './pageHost'
import { useRemoteManifests } from './registry'
import { Spinner } from '../components/ui/spinner'

type FilePanelProps = { ctx: PageContext; agentId: string | null; allowUpload?: boolean }

function useProvidedFilePanel(): { Provided: ComponentType<FilePanelProps> | null; loading: boolean } {
  const { entries, loading: manifestsLoading } = useRemoteManifests()
  const spec = entries.find((entry) => entry.manifest.provides?.filePanel)?.manifest
  const module = spec?.provides?.filePanel.module ?? ''
  const exported = spec?.provides?.filePanel.export ?? ''
  const entry = spec?.entry ?? ''
  const [component, setComponent] = useState<ComponentType<FilePanelProps> | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!entry || !module || !exported) {
      return
    }
    let alive = true
    loadExportedComponent<FilePanelProps>({ entry, module, export: exported })
      .then((loaded) => {
        if (alive) {
          setComponent(() => loaded)
        }
      })
      .catch((error: unknown) => {
        // The slot keeps saying the browser belongs to the workspace module; a
        // failure to load it is worth a console line, not a replacement copy.
        console.warn('[portal] the provided file panel did not load:', error)
        if (alive) {
          setFailed(true)
        }
      })
    return () => {
      alive = false
    }
  }, [entry, module, exported])

  // "Not fetched yet" and "nothing provides it" are different answers: the first
  // one is a spinner, so a page never flashes "unavailable" while the manifests
  // are still in flight (the same distinction PluginPage makes for routes).
  const expected = Boolean(entry && module && exported)
  const loading = manifestsLoading || (expected && !component && !failed)
  return { Provided: component, loading }
}

export function FilePanelSlot({ agentId, allowUpload = true }: { agentId: string | null; allowUpload?: boolean }) {
  const { t } = useTranslation()
  const { Provided, loading } = useProvidedFilePanel()
  const host = getPageHost()
  if (loading) {
    return (
      <div className="flex h-full min-h-[12rem] items-center justify-center p-6">
        <Spinner />
      </div>
    )
  }
  if (!Provided || !host) {
    return (
      <div
        data-file-panel-unavailable="1"
        className="flex h-full min-h-[12rem] items-center justify-center p-6 text-center text-sm text-muted-foreground"
      >
        {t('pluginUnavailable.filePanel')}
      </div>
    )
  }
  // createElement rather than JSX: the component type arrives from a hook, which
  // the compiler's static-components rule cannot prove is a component. The tree is
  // the same either way, and the type only changes when the plugin finishes loading.
  return createElement(Provided, { ctx: host, agentId, allowUpload })
}
