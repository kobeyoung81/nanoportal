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
import {
  type PageComponent,
  type PanelContext,
  type PanelComponent,
  type PanelIcon,
  type RemoteManifest,
} from './contract'
import { parseShellManifest, resolveShellPanels } from './manifest'
import { localizedTitle, panelIDOf, parseRemoteManifest } from './remote'
import { makeRemotePanel } from './RemotePanel'
import { makeRemotePage } from './pages'
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
  return function PanelWithContext({ ctx }: { ctx?: PanelContext }) {
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

/** One validated remote manifest, tagged with the id the shell knows it by. */
export type RemoteEntry = {
  pluginId: string
  manifest: {
    entry: string
    panels: NonNullable<RemoteManifest['panels']>
    pages?: RemoteManifest['pages']
    provides?: RemoteManifest['provides']
  }
}

/**
 * useRemoteManifests reads every remote entry's manifest once per page load.
 *
 * Both hooks below read from here: a page plugin and a panel plugin are the same
 * manifest, and fetching it twice would let the two views disagree about a
 * plugin that failed to load.
 */
export function useRemoteManifests(): { entries: RemoteEntry[]; errors: string[] } {
  const [state, setState] = useState<{ entries: RemoteEntry[]; errors: string[] }>({ entries: [], errors: [] })

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
            return { entry: null, error: parsed.error }
          }
          return { entry: { pluginId, manifest: parsed.value }, error: '' }
        } catch (error) {
          return { entry: null, error: `${pluginId}: ${error instanceof Error ? error.message : String(error)}` }
        }
      }),
    ).then((results) => {
      if (!alive) {
        return
      }
      const loaded: RemoteEntry[] = []
      const errors: string[] = []
      for (const result of results) {
        if (result.entry) {
          loaded.push(result.entry)
        } else if (result.error) {
          errors.push(result.error)
        }
      }
      if (errors.length > 0) {
        console.warn('[portal] plugin entries rejected:', errors.join('; '))
      }
      setState({ entries: loaded, errors })
    })
    return () => {
      alive = false
    }
  }, [])

  return state
}

/** A page a plugin contributes, ready for the shell to mount. */
export type ResolvedPage = {
  id: string
  path: string
  title: string
  Component: PageComponent
}

/**
 * usePluginPages resolves the routes remote plugins take over.
 *
 * A page mount has to be a module: the shell renders it in its own React tree,
 * which is what keeps theme, i18n and the router working. A frame page is skipped
 * with a reason rather than mounted somewhere it does not belong.
 */
export function usePluginPages(): { pages: ResolvedPage[]; errors: string[] } {
  const { i18n } = useTranslation()
  const language = i18n.language
  const { entries, errors } = useRemoteManifests()

  return useMemo(() => {
    const pages: ResolvedPage[] = []
    const problems: string[] = []
    for (const { pluginId, manifest } of entries) {
      for (const page of manifest.pages ?? []) {
        if (page.mount.kind !== 'module') {
          problems.push(`${pluginId}: page ${page.id} uses a frame mount, which the shell does not host`)
          continue
        }
        pages.push({
          id: `${pluginId}.${page.id}`,
          path: page.path,
          title: localizedTitle(page.title, language),
          Component: makeRemotePage({ entry: manifest.entry, module: page.mount.module, export: page.mount.export }),
        })
      }
    }
    return { pages, errors: [...errors, ...problems] }
  }, [entries, errors, language])
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
  const { entries, errors } = useRemoteManifests()

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

  const remote = useMemo(() => {
    const plugins: WorkbenchPlugin[] = []
    for (const { pluginId, manifest } of entries) {
      for (const panel of manifest.panels) {
        plugins.push({
          id: panelIDOf(pluginId, panel.id),
          icon: ICONS[panel.icon],
          title: localizedTitle(panel.title, language),
          titleKey: '',
          defaultSlot: panel.slot,
          ctxAware: true,
          Component: panel.mount.kind === 'module'
            ? ctxAdapter(
                makeRemotePanel({
                  entry: manifest.entry,
                  module: panel.mount.module,
                  export: panel.mount.export,
                }),
              )
            : makeFramePlaceholder(panel.mount.url),
        })
      }
    }
    return { plugins, errors: [] as string[] }
  }, [entries, language])

  return useMemo(
    () => ({ plugins: [...shell.plugins, ...remote.plugins], errors: [...shell.errors, ...errors, ...remote.errors] }),
    [shell, remote, errors],
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
