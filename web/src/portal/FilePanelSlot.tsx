// The file browser a page embeds.
//
// The component is the workspace module's (it owns the bytes, the previews and the
// dialogs), and the manifest says where to find it. The shell borrows it and hands
// over the page's context, so the same implementation serves a page in this shell
// and the workspace's own /files page. Without the plugin — or while it loads —
// the shell's own copy renders, which is also the fallback of its /files page.

import { createElement, useEffect, useState, type ComponentType } from 'react'
import type { PageContext } from './contract'
import { loadExportedComponent } from './loader'
import { getPageHost } from './pageHost'
import { useRemoteManifests } from './registry'
import { FilePanel as BuiltInFilePanel } from '../components/agent/FilePanel'

type FilePanelProps = { ctx: PageContext; agentId: string | null; allowUpload?: boolean }

function useProvidedFilePanel(): ComponentType<FilePanelProps> | null {
  const { entries } = useRemoteManifests()
  const spec = entries.find((entry) => entry.manifest.provides?.filePanel)?.manifest
  const module = spec?.provides?.filePanel.module ?? ''
  const exported = spec?.provides?.filePanel.export ?? ''
  const entry = spec?.entry ?? ''
  const [component, setComponent] = useState<ComponentType<FilePanelProps> | null>(null)

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
        // The built-in copy is already on screen: say why in the console and keep
        // working rather than replacing the browser with an error.
        console.warn('[portal] the provided file panel did not load:', error)
      })
    return () => {
      alive = false
    }
  }, [entry, module, exported])

  return component
}

export function FilePanelSlot({ agentId, allowUpload = true }: { agentId: string | null; allowUpload?: boolean }) {
  const Provided = useProvidedFilePanel()
  const host = getPageHost()
  if (!Provided || !host) {
    return <BuiltInFilePanel agentId={agentId} allowUpload={allowUpload} />
  }
  // createElement rather than JSX: the component type arrives from a hook, which
  // the compiler's static-components rule cannot prove is a component. The tree is
  // the same either way, and the type only changes when the plugin finishes loading.
  return createElement(Provided, { ctx: host, agentId, allowUpload })
}
