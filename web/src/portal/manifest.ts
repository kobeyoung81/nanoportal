// Reading the shell's own plugin table.
//
// `plugins.json` ships with the shell (it is in the image, no network), and it is
// the only place that decides which panels exist and in what order. The checks
// here are the ones a build mistake would otherwise hide: a panel id with no
// implementation, or the same id contributed twice, would silently drop or steal
// a tab.

import { CONTRACT_VERSION, type ParseResult, type ShellManifest } from './contract'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** parseShellManifest validates the table the shell ships with. */
export function parseShellManifest(raw: unknown): ParseResult<ShellManifest> {
  if (!isRecord(raw)) {
    return { ok: false, error: 'plugins.json must be a JSON object' }
  }
  if (raw.contract !== CONTRACT_VERSION) {
    return {
      ok: false,
      error: `plugins.json asks for contract ${String(raw.contract)}, the shell speaks ${CONTRACT_VERSION}`,
    }
  }
  if (!isRecord(raw.plugins) || Object.keys(raw.plugins).length === 0) {
    return { ok: false, error: 'plugins.json needs a non-empty plugins table' }
  }
  const plugins: ShellManifest['plugins'] = {}
  for (const [id, entry] of Object.entries(raw.plugins)) {
    if (!isRecord(entry)) {
      return { ok: false, error: `plugin ${id}: entry must be an object` }
    }
    if (entry.panels !== undefined && !Array.isArray(entry.panels)) {
      return { ok: false, error: `plugin ${id}: panels must be an array` }
    }
    plugins[id] = {
      impl: typeof entry.impl === 'string' ? entry.impl : undefined,
      manifest: typeof entry.manifest === 'string' ? entry.manifest : undefined,
      panels: Array.isArray(entry.panels) ? entry.panels.filter((p): p is string => typeof p === 'string') : undefined,
    }
  }
  return { ok: true, value: { contract: CONTRACT_VERSION, plugins } }
}

/**
 * resolveShellPanels returns the shell's panel ids in manifest order.
 *
 * A panel the map does not implement is an error, not a silent skip: the table
 * and the code would otherwise drift and a tab would disappear without a trace.
 */
export function resolveShellPanels(manifest: ShellManifest, builtinIDs: string[]): ParseResult<string[]> {
  const known = new Set(builtinIDs)
  const seen = new Set<string>()
  const order: string[] = []
  for (const [pluginId, entry] of Object.entries(manifest.plugins)) {
    for (const panelId of entry.panels ?? []) {
      if (!known.has(panelId)) {
        return { ok: false, error: `${pluginId}: panel ${panelId} has no implementation` }
      }
      if (seen.has(panelId)) {
        return { ok: false, error: `panel ${panelId} is contributed twice` }
      }
      seen.add(panelId)
      order.push(panelId)
    }
  }
  return { ok: true, value: order }
}

