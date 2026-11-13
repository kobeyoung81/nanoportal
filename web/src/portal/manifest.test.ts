import { describe, expect, it } from 'vitest'
import { parseShellManifest, resolveShellPanels } from './manifest'
import shellSource from './plugins.json'

// The shell's own panels, in the order this build ships. The table is what the
// activity bar and the phone's default set read, so a change here is a change to
// the product, not a refactor detail.
const BUILTINS = ['agents', 'chat', 'files', 'terminal', 'git-browser', 'user-config']

describe('parseShellManifest', () => {
  it('accepts the shipped table', () => {
    const parsed = parseShellManifest(shellSource)
    if (!parsed.ok) {
      throw new Error(parsed.error)
    }
    expect(Object.keys(parsed.value.plugins)).toEqual(['shell', 'nanoartifacts', 'auth', 'admin', 'workspace'])
  })

  it('refuses a different contract version', () => {
    const parsed = parseShellManifest({ ...shellSource, contract: 2 })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error).toContain('speaks 1')
    }
  })

  it('refuses an empty plugin table', () => {
    expect(parseShellManifest({ contract: 1, plugins: {} }).ok).toBe(false)
  })
})

describe('resolveShellPanels', () => {
  it('keeps the shipped order', () => {
    const parsed = parseShellManifest(shellSource)
    if (!parsed.ok) {
      throw new Error(parsed.error)
    }
    const order = resolveShellPanels(parsed.value, BUILTINS)
    if (!order.ok) {
      throw new Error(order.error)
    }
    expect(order.value).toEqual(BUILTINS)
  })

  it('refuses a panel with no implementation', () => {
    const order = resolveShellPanels(
      { contract: 1, plugins: { shell: { panels: ['agents', 'ghost'] } } },
      BUILTINS,
    )
    expect(order.ok).toBe(false)
    if (!order.ok) {
      expect(order.error).toContain('ghost has no implementation')
    }
  })

  it('refuses the same panel contributed twice', () => {
    // V-1: one panel id, one owner. Two entries claiming it would silently move
    // the tab to whichever dock rendered last.
    const order = resolveShellPanels(
      {
        contract: 1,
        plugins: {
          shell: { panels: ['agents'] },
          other: { panels: ['agents'] },
        },
      },
      BUILTINS,
    )
    expect(order.ok).toBe(false)
    if (!order.ok) {
      expect(order.error).toContain('contributed twice')
    }
  })
})
