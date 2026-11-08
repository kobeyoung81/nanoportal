// Loading a panel component from another application at runtime.
//
// The single entry the design calls for: callers know a panel, never a loader.
// Today it is Module Federation's `loadRemote`; the call sites (registry and
// panel host) would not change if the transport did.

import { loadRemote, registerRemotes } from '@module-federation/runtime'
import type { PanelComponent } from './contract'

/** The default ceiling for "the remote answered and exported something". */
export const LOAD_TIMEOUT_MS = 15_000

type PanelSpec = { entry: string; module: string; export: string }

// One promise per (entry, expose, export). A second panel from the same remote
// must not start a second load; a failed load is dropped so the panel's retry
// button can try again.
const loaded = new Map<string, Promise<PanelComponent>>()

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
  const { remote, expose } = splitModule(spec.module)
  const key = `${spec.entry}|${remote}/${expose}|${spec.export}`
  const cached = loaded.get(key)
  if (cached) {
    return cached
  }

  const task = (async () => {
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
    return component as PanelComponent
  })()

  loaded.set(key, task)
  task.catch(() => loaded.delete(key))
  return task
}
