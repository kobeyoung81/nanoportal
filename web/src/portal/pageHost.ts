// The page the shell is currently hosting.
//
// One page is on screen at a time, so a single slot is enough for the components
// the shell borrows on that page's behalf — today the file browser, which lives in
// the workspace module but is embedded by pages elsewhere. PluginPage installs the
// context on every render; a component that finds nothing here falls back to the
// shell's own copy, which is what keeps a page working without the plugin.

import type { PageContext } from './contract'

let current: PageContext | null = null

export function setPageHost(ctx: PageContext): void {
  current = ctx
}

export function getPageHost(): PageContext | null {
  return current
}
