// The plugin contract, in the shape the frontend design calls for: types and
// constants only, no implementation and no data access.
//
// A plugin contributes panels today (routes, slots and nav arrive with the
// modules that need them). The shell names the contract version it speaks; a
// manifest from another version is refused rather than half-loaded, and every
// plugin is expected to keep working against the previous version so the shell
// can be rolled back alone.
//
// This module is the seed of `@nanosec/portal-contract`. It becomes a package
// when the second plugin ships; until then a path import keeps the build free of
// package-manager changes.

import type { ComponentType } from 'react'
import type { DockId } from '../workbench/types'

/** The plugin contract this shell speaks. Bump only with a release window. */
export const CONTRACT_VERSION = 1

/** A string per language tag, e.g. `{ "zh-CN": "作品库", en: "Library" }`. */
export type LocalizedText = Record<string, string>

/**
 * Icons a manifest may name. A remote cannot ship a React component, and an
 * arbitrary SVG from the network would be a styling and safety problem, so the
 * vocabulary is closed and mapped to the shell's own icons.
 */
export const PANEL_ICONS = ['layers', 'file-text', 'folder', 'layout-grid', 'book-open'] as const
export type PanelIcon = (typeof PANEL_ICONS)[number]

/**
 * How a panel's content is produced.
 *
 * - `module` is a component the shell loads at runtime (Module Federation
 *   remote). It renders inside the shell's React tree, so it inherits theme,
 *   i18n and the drag/resize behaviour.
 * - `frame` carries an application that cannot share the shell's stack. It is
 *   the boundary for heterogeneous or third-party UIs.
 */
export type PanelMount =
  | { kind: 'module'; module: string; export: string }
  | { kind: 'frame'; url: string }

export type PanelContribution = {
  /** Panel id inside its plugin; the shell prefixes it with the plugin id. */
  id: string
  title: LocalizedText
  icon: PanelIcon
  /** Where a fresh browser puts the panel; the user can move it afterwards. */
  slot: DockId
  mount: PanelMount
}

/**
 * What a panel gets from the shell. Every field is data the shell already owns:
 * a plugin never reaches into the shell's storage, router or theme.
 */
export type PortalContext = {
  token: string
  userId: string
  locale: string
  theme: 'light' | 'dark'
  navigate: (path: string) => void
  openPanel: (panelId: string) => void
}

/**
 * A whole page a plugin contributes: the shell mounts it at `path` instead of
 * its own built-in page for that route.
 *
 * A page is the same kind of contribution as a panel — a module the shell loads
 * at runtime — with one difference: it owns the route. That is what lets a
 * module ship a screen (the work library, the account pages) without the shell
 * importing its code, and without an iframe boundary it does not need.
 */
export type PageContribution = {
  /** Page id inside its plugin; the shell prefixes it with the plugin id. */
  id: string
  /** The shell route this page answers, e.g. `/artifacts`. */
  path: string
  title: LocalizedText
  mount: PanelMount
}

/** A page component, as exported by a `module` mount. */
export type PageComponent = ComponentType<{ ctx: PortalContext }>

/** A panel component, as exported by a `module` mount. */
export type PanelComponent = ComponentType<{ ctx: PortalContext }>

/** What an application publishes at <base>/plugin.json. */
export type RemoteManifest = {
  contract: number
  plugin: string
  /** Remote entry of the module federation build, same-origin path. */
  entry: string
  panels: PanelContribution[]
  /** Routes this plugin takes over. Optional: a plugin may contribute panels only. */
  pages?: PageContribution[]
}

/** The shell's own table: which plugins load, and which panels the shell ships. */
export type ShellManifest = {
  contract: number
  plugins: Record<string, ShellPluginEntry>
}

export type ShellPluginEntry = {
  impl?: string
  /** Same-origin path to the application's manifest (module plugins). */
  manifest?: string
  /** Panel ids this entry contributes, in activity-bar order (the shell). */
  panels?: string[]
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }
