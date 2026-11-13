// Reading a plugin's manifest.
//
// Everything here is pure: a manifest arrives as JSON from another application,
// so it is untrusted input. A malformed or wrong-version manifest is refused as a
// whole — half a plugin is worse than none, and the error names what is wrong so
// the browser console is enough to diagnose it.

import {
  CONTRACT_VERSION,
  PANEL_ICONS,
  type LocalizedText,
  type PageContribution,
  type PanelContribution,
  type PanelIcon,
  type PanelMount,
  type ParseResult,
  type RemoteManifest,
} from './contract'
import type { DockId } from '../workbench/types'

const DOCKS: DockId[] = ['left', 'center', 'right', 'bottom']

/** The panel id the workbench stores: `<plugin>.<panel>`. */
export function panelIDOf(pluginId: string, panelId: string): string {
  return `${pluginId}.${panelId}`
}

/**
 * localizedTitle picks the string for the shell's language. A manifest may carry
 * any tags; the first substring match wins (`zh-CN` serves `zh`), and a manifest
 * with no matching tag falls back to its first entry so a panel never renders an
 * empty tab.
 */
export function localizedTitle(title: LocalizedText, language: string): string {
  if (typeof title !== 'string' && title && typeof title === 'object') {
    const wanted = language.toLowerCase()
    for (const [tag, value] of Object.entries(title)) {
      if (typeof value === 'string' && value !== '' && wanted.startsWith(tag.toLowerCase())) {
        return value
      }
    }
    for (const value of Object.values(title)) {
      if (typeof value === 'string' && value !== '') {
        return value
      }
    }
  }
  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is LocalizedText {
  return isRecord(value) && Object.values(value).some((entry) => typeof entry === 'string' && entry !== '')
}

function parseMount(raw: unknown): ParseResult<PanelMount> {
  if (!isRecord(raw)) {
    return { ok: false, error: 'mount must be an object' }
  }
  if (raw.kind === 'module') {
    const module = typeof raw.module === 'string' ? raw.module.trim() : ''
    const expose = typeof raw.export === 'string' ? raw.export.trim() : ''
    if (module === '' || expose === '') {
      return { ok: false, error: 'a module mount needs both module and export' }
    }
    // `<remote>/<expose>`: the remote name is what the application's federation
    // build calls itself, and it must match the entry the shell registers.
    if (!module.includes('/')) {
      return { ok: false, error: 'module must be "<remote>/<expose>"' }
    }
    return { ok: true, value: { kind: 'module', module, export: expose } }
  }
  if (raw.kind === 'frame') {
    const url = typeof raw.url === 'string' ? raw.url.trim() : ''
    // Same-origin only: the frame boundary exists for applications that cannot
    // share the shell's stack, not for arbitrary origins the shell cannot audit.
    if (!url.startsWith('/')) {
      return { ok: false, error: 'a frame mount needs a same-origin url starting with /' }
    }
    return { ok: true, value: { kind: 'frame', url } }
  }
  return { ok: false, error: 'mount.kind must be "module" or "frame"' }
}

function parsePanel(raw: unknown): ParseResult<PanelContribution> {
  if (!isRecord(raw)) {
    return { ok: false, error: 'panel must be an object' }
  }
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (id === '') {
    return { ok: false, error: 'panel id is required' }
  }
  if (!isText(raw.title)) {
    return { ok: false, error: `panel ${id}: title needs at least one localized string` }
  }
  const icon = raw.icon
  if (typeof icon !== 'string' || !PANEL_ICONS.includes(icon as PanelIcon)) {
    return { ok: false, error: `panel ${id}: icon must be one of ${PANEL_ICONS.join(', ')}` }
  }
  const slot = raw.slot
  if (typeof slot !== 'string' || !DOCKS.includes(slot as DockId)) {
    return { ok: false, error: `panel ${id}: slot must be one of ${DOCKS.join(', ')}` }
  }
  const mount = parseMount(raw.mount)
  if (!mount.ok) {
    return { ok: false, error: `panel ${id}: ${mount.error}` }
  }
  return {
    ok: true,
    value: {
      id,
      title: raw.title as LocalizedText,
      icon: icon as PanelIcon,
      slot: slot as DockId,
      mount: mount.value,
    },
  }
}

function parsePage(raw: unknown): ParseResult<PageContribution> {
  if (!isRecord(raw)) {
    return { ok: false, error: 'page must be an object' }
  }
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (id === '') {
    return { ok: false, error: 'page id is required' }
  }
  const path = typeof raw.path === 'string' ? raw.path.trim() : ''
  // The shell mounts the page at this route; a relative or query-bearing path
  // would not match a route at all, so it is refused rather than half-mounted.
  if (!path.startsWith('/') || path.includes('?') || path.includes('#')) {
    return { ok: false, error: `page ${id}: path must be an absolute route like /artifacts` }
  }
  if (!isText(raw.title)) {
    return { ok: false, error: `page ${id}: title needs at least one localized string` }
  }
  const mount = parseMount(raw.mount)
  if (!mount.ok) {
    return { ok: false, error: `page ${id}: ${mount.error}` }
  }
  return { ok: true, value: { id, path, title: raw.title as LocalizedText, mount: mount.value } }
}

/**
 * parseRemoteManifest validates one application's table.
 *
 * `pluginId` is the id the shell's own `plugins.json` gave this entry; the
 * manifest must agree, otherwise two tables would disagree about who owns a
 * panel id.
 */
export function parseRemoteManifest(raw: unknown, pluginId: string): ParseResult<RemoteManifest> {
  if (!isRecord(raw)) {
    return { ok: false, error: `${pluginId}: manifest must be a JSON object` }
  }
  if (raw.contract !== CONTRACT_VERSION) {
    return {
      ok: false,
      error: `${pluginId}: plugin asks for contract ${String(raw.contract)}, the shell speaks ${CONTRACT_VERSION}`,
    }
  }
  if (raw.plugin !== pluginId) {
    return { ok: false, error: `${pluginId}: manifest names plugin ${String(raw.plugin)}` }
  }
  const entry = typeof raw.entry === 'string' ? raw.entry.trim() : ''
  if (!entry.startsWith('/')) {
    return { ok: false, error: `${pluginId}: entry must be a same-origin path starting with /` }
  }
  if (raw.panels !== undefined && !Array.isArray(raw.panels)) {
    return { ok: false, error: `${pluginId}: panels must be an array when present` }
  }
  const rawPanels: unknown[] = Array.isArray(raw.panels) ? raw.panels : []

  const panels: PanelContribution[] = []
  const seen = new Set<string>()
  for (const item of rawPanels) {
    const panel = parsePanel(item)
    if (!panel.ok) {
      return { ok: false, error: `${pluginId}: ${panel.error}` }
    }
    if (seen.has(panel.value.id)) {
      return { ok: false, error: `${pluginId}: duplicate panel id ${panel.value.id}` }
    }
    seen.add(panel.value.id)
    panels.push(panel.value)
  }
  const pages: PageContribution[] = []
  const seenPages = new Set<string>()
  const seenPaths = new Set<string>()
  if (raw.pages !== undefined) {
    if (!Array.isArray(raw.pages)) {
      return { ok: false, error: `${pluginId}: pages must be an array when present` }
    }
    for (const item of raw.pages) {
      const page = parsePage(item)
      if (!page.ok) {
        return { ok: false, error: `${pluginId}: ${page.error}` }
      }
      if (seenPages.has(page.value.id)) {
        return { ok: false, error: `${pluginId}: duplicate page id ${page.value.id}` }
      }
      // One route, one owner: two pages on the same path would make which one
      // renders depend on manifest order.
      if (seenPaths.has(page.value.path)) {
        return { ok: false, error: `${pluginId}: duplicate page path ${page.value.path}` }
      }
      seenPages.add(page.value.id)
      seenPaths.add(page.value.path)
      pages.push(page.value)
    }
  }

  // A plugin that contributes nothing is a configuration mistake, not an empty
  // plugin: it would be loaded on every page load for no reason.
  if (panels.length === 0 && pages.length === 0) {
    return { ok: false, error: `${pluginId}: a plugin must contribute at least one panel or page` }
  }

  const provides: Record<string, { module: string; export: string }> = {}
  if (raw.provides !== undefined) {
    if (!isRecord(raw.provides)) {
      return { ok: false, error: `${pluginId}: provides must be an object` }
    }
    for (const [role, value] of Object.entries(raw.provides)) {
      if (!isRecord(value)) {
        return { ok: false, error: `${pluginId}: provides.${role} must be an object` }
      }
      const module = typeof value.module === 'string' ? value.module.trim() : ''
      const exported = typeof value.export === 'string' ? value.export.trim() : ''
      if (!module.includes('/') || exported === '') {
        return { ok: false, error: `${pluginId}: provides.${role} needs "<remote>/<expose>" and an export` }
      }
      provides[role] = { module, export: exported }
    }
  }

  return { ok: true, value: { contract: CONTRACT_VERSION, plugin: pluginId, entry, panels, pages, provides } }
}

/** Test seam: the dock vocabulary, so a typo in a manifest test is caught. */
export const PANEL_DOCKS: readonly DockId[] = DOCKS
