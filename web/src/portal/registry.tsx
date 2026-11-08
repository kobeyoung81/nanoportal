// The shell's plugin registry.
//
// `plugins.json` decides which panels exist and in which order the activity bar
// shows them; this module turns that table into workbench plugins. The shell's
// own six panels resolve through a static map (P0), a plugin entry resolves
// through its application's manifest and Module Federation (remote panels).
//
// One id, one owner: a panel id may appear once across the whole table, and a
// plugin's manifest must agree on the id it was registered under. Both rules are
// checked before anything renders, because a duplicate silently steals a tab.

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, FileText, Folder, Layers, LayoutGrid } from 'lucide-react'
import { type PanelComponent, type PanelIcon, type PortalContext } from './contract'
import { parseShellManifest, resolveShellPanels } from './manifest'
import { localizedTitle, panelIDOf, parseRemoteManifest } from './remote'
import { makeRemotePanel } from './RemotePanel'
import shellSource from './plugins.json'
import type { WorkbenchPlugin } from '../workbench/types'

const ICONS: Record<PanelIcon, typeof Layers> = {
  layers: Layers,
  'file-text': FileText,
  folder: Folder,
  'layout-grid': LayoutGrid,
  'book-open': BookOpen,
}

/**
 * ctxAdapter narrows the workbench's optional context to the contract's required
 * one. The shell always supplies it for a ctxAware panel; the adapter is what
 * makes that guarantee type-safe instead of a cast.
 */
function ctxAdapter(Inner: PanelComponent) {
  return function PanelWithContext({ ctx }: { ctx?: PortalContext }) {
    return ctx ? <Inner ctx={ctx} /> : null
  }
}

// One manifest fetch per URL per page load. The manifest is what makes a plugin
// loadable, so it is read once and kept; a rebuild is picked up on the next page
// load, which is the granularity a remote release already has.
const manifests = new Map<string, Promise<unknown>>()

export function resetManifestCache(): void {
  manifests.clear()
}

async function fetchManifest(url: string, timeoutMs = 15_000): Promise<unknown> {
  const cached = manifests.get(url)
  if (cached) {
    return cached
  }
  const task = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
      if (!response.ok) {
        throw new Error(`${url}: HTTP ${response.status}`)
      }
      return (await response.json()) as unknown
    } finally {
      clearTimeout(timer)
    }
  })()
  manifests.set(url, task)
  task.catch(() => manifests.delete(url))
  return task
}

const SHELL = parseShellManifest(shellSource)
if (!SHELL.ok) {
  // The table ships with the shell, so this is a build mistake, not a runtime
  // one. Keep the shell usable (its own panels still exist) and say why.
  console.error('[portal] plugins.json rejected:', SHELL.error)
}

export type PluginSet = {
  plugins: WorkbenchPlugin[]
  errors: string[]
}

/**
 * usePlugins builds the workbench plugin list.
 *
 * `builtins` is the static map of the shell's own panels; remote entries are
 * fetched and validated asynchronously. A rejected entry contributes nothing and
 * its reason is reported — one broken plugin never removes another's panels.
 */
export function usePlugins(builtins: Record<string, WorkbenchPlugin>): PluginSet {
  const { i18n } = useTranslation()
  const language = i18n.language
  const [remote, setRemote] = useState<PluginSet>({ plugins: [], errors: [] })

  const shell = useMemo(() => {
    if (!SHELL.ok) {
      return { plugins: [] as WorkbenchPlugin[], errors: [SHELL.error] }
    }
    const order = resolveShellPanels(SHELL.value, Object.keys(builtins))
    if (!order.ok) {
      return { plugins: [] as WorkbenchPlugin[], errors: [order.error] }
    }
    const plugins = order.value.map((id) => builtins[id]).filter((plugin): plugin is WorkbenchPlugin => Boolean(plugin))
    return { plugins, errors: [] as string[] }
  }, [builtins])

  useEffect(() => {
    if (!SHELL.ok) {
      return
    }
    let alive = true
    const entries = Object.entries(SHELL.value.plugins).filter(([, entry]) => entry.manifest)
    void Promise.all(
      entries.map(async ([pluginId, entry]) => {
        const manifestURL = entry.manifest as string
        try {
          const parsed = parseRemoteManifest(await fetchManifest(manifestURL), pluginId)
          if (!parsed.ok) {
            return { plugins: [] as WorkbenchPlugin[], errors: [parsed.error] }
          }
          const plugins = parsed.value.panels.map<WorkbenchPlugin>((panel) => ({
            id: panelIDOf(pluginId, panel.id),
            icon: ICONS[panel.icon],
            title: localizedTitle(panel.title, language),
            titleKey: '',
            defaultSlot: panel.slot,
            ctxAware: true,
            Component: panel.mount.kind === 'module'
              ? ctxAdapter(
                  makeRemotePanel({
                    entry: parsed.value.entry,
                    module: panel.mount.module,
                    export: panel.mount.export,
                  }),
                )
              : makeFramePlaceholder(panel.mount.url),
          }))
          return { plugins, errors: [] as string[] }
        } catch (error) {
          return {
            plugins: [] as WorkbenchPlugin[],
            errors: [`${pluginId}: ${error instanceof Error ? error.message : String(error)}`],
          }
        }
      }),
    ).then((results) => {
      if (!alive) {
        return
      }
      const plugins: WorkbenchPlugin[] = []
      const errors: string[] = []
      for (const result of results) {
        plugins.push(...result.plugins)
        errors.push(...result.errors)
      }
      if (errors.length > 0) {
        console.warn('[portal] plugin entries rejected:', errors.join('; '))
      }
      setRemote({ plugins, errors })
    })
    return () => {
      alive = false
    }
  }, [language])

  return useMemo(
    () => ({ plugins: [...shell.plugins, ...remote.plugins], errors: [...shell.errors, ...remote.errors] }),
    [shell, remote],
  )
}

/**
 * frame mounts are part of the contract but not of this round: a frame panel
 * declares it, and the shell says plainly that it does not host one yet.
 */
function makeFramePlaceholder(url: string) {
  return function FrameNotHosted() {
    const { t } = useTranslation()
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm text-muted-foreground">{t('workbench.remote.frameUnsupported')}</p>
        <p className="max-w-full break-all text-xs text-muted-foreground/70">{url}</p>
      </div>
    )
  }
}
