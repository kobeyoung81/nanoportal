// Loading a panel component from another application at runtime.
//
// The single entry the design calls for: callers know a panel, never a loader.
// Today it is Module Federation's `loadRemote`; the call sites (registry and
// panel host) would not change if the transport did.

import { loadRemote, registerRemotes } from '@module-federation/runtime'
import type { ComponentType } from 'react'
import type { PanelComponent, PortalContext } from './contract'

/** The default ceiling for "the remote answered and exported something". */
export const LOAD_TIMEOUT_MS = 15_000

type PanelSpec = { entry: string; module: string; export: string }

// One promise per (entry, expose, export). A second panel from the same remote
// must not start a second load; a failed load is dropped so the panel's retry
// button can try again.
const loaded = new Map<string, Promise<ComponentType<never>>>()

export function resetPanelLoaderCache(): void {
  loaded.clear()
}

/** splitModule turns `nanoartifacts/panels` into the remote and the expose. */
export function splitModule(module: string): { remote: string; expose: string } {
  const at = module.indexOf('/')
  if (at <= 0 || at === module.length - 1) {
    throw new Error(`module "${module}" must look like "<remote>/<expose>"`)
  }
  return { remote: module.slice(0, at), expose: module.slice(at + 1) }
}

function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} did not load within ${ms} ms`)), ms)
    task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * loadPanelComponent resolves and loads one exported panel component.
 *
 * `registerRemotes(..., { force: true })` runs before every load: the entry may
 * have been rebuilt since the tab opened (that is the point of a remote), and a
 * cached remote description would keep serving the previous build.
 */
export async function loadPanelComponent(spec: PanelSpec, timeoutMs = LOAD_TIMEOUT_MS): Promise<PanelComponent> {
  return loadExportedComponent<{ ctx: PortalContext }>(spec, timeoutMs) as Promise<PanelComponent>
}

/**
 * loadExportedComponent resolves one named export from a remote.
 *
 * A panel is the common case (hence the named wrapper above), but the shell also
 * borrows a component a module owns — the file browser is the workspace module's —
 * and that one takes props of its own. The cache is keyed the same way, so the two
 * never start a second load for the same export.
 */
export async function loadExportedComponent<P>(
  spec: PanelSpec,
  timeoutMs = LOAD_TIMEOUT_MS,
): Promise<ComponentType<P>> {
  const { remote, expose } = splitModule(spec.module)
  const key = `${spec.entry}|${remote}/${expose}|${spec.export}`
  const cached = loaded.get(key)
  if (cached) {
    return cached as unknown as Promise<ComponentType<P>>
  }

  const task: Promise<ComponentType<P>> = (async () => {
    registerRemotes([{ name: remote, entry: spec.entry, type: 'module' }], { force: true })
    const module = await withTimeout(
      loadRemote<Record<string, unknown>>(`${remote}/${expose}`),
      timeoutMs,
      `${remote}/${expose}`,
    )
    const component = module?.[spec.export]
    if (typeof component !== 'function') {
      throw new Error(`${remote}/${expose} does not export "${spec.export}"`)
    }
    return component as ComponentType<P>
  })()

  loaded.set(key, task as unknown as Promise<ComponentType<never>>)
  task.catch(() => loaded.delete(key))
  return task
}
