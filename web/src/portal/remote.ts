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
  if (!Array.isArray(raw.panels) || raw.panels.length === 0) {
    return { ok: false, error: `${pluginId}: panels must be a non-empty array` }
  }

  const panels: PanelContribution[] = []
  const seen = new Set<string>()
  for (const item of raw.panels) {
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
  return { ok: true, value: { contract: CONTRACT_VERSION, plugin: pluginId, entry, panels } }
}

/** Test seam: the dock vocabulary, so a typo in a manifest test is caught. */
export const PANEL_DOCKS: readonly DockId[] = DOCKS
