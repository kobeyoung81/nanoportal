import { describe, expect, it } from 'vitest'
import stylesheet from '../index.css?raw'

// The shell's stylesheet declares the cascade order before it imports anything,
// and that order is what keeps a plugin from restyling the shell.
//
// A plugin ships its own copy of the utility classes Tailwind emits for its
// sources, and Module Federation appends that copy to <head> after this file.
// In the same layer, a later file wins, and a media query adds no specificity —
// so a plugin's bare `.hidden` beat this sheet's `.sm\:block` and every
// `hidden sm:block` stayed hidden on a desktop. `plugin` is declared between
// `base` and `utilities` so the shell's variants win while a plugin can still
// emit classes this sheet never had.
describe('the shell owns the cascade order', () => {
  it('declares the plugin layer below the shell utilities', () => {
    const statement = /@layer\s+([a-z,\s-]+);/.exec(stylesheet)
    expect(statement, 'no @layer statement in index.css').not.toBeNull()
    const layers = statement![1].split(',').map((layer) => layer.trim())
    expect(layers).toContain('plugin')
    expect(layers).toContain('utilities')
    expect(layers.indexOf('plugin')).toBeLessThan(layers.indexOf('utilities'))
  })

  it('declares the order before the first import', () => {
    // `@layer <names>;` is the one at-rule allowed ahead of `@import`; putting
    // it after the import would let Tailwind establish the order first and the
    // plugin layer would land on top of the utilities.
    const statementAt = stylesheet.indexOf('@layer')
    const firstImportAt = stylesheet.indexOf('@import')
    expect(statementAt).toBeGreaterThanOrEqual(0)
    expect(firstImportAt).toBeGreaterThan(statementAt)
  })

  it('keeps the plugin copy below the shell without !important', () => {
    // `!important` beats layers, so a stylesheet leaning on it would silently
    // put a plugin back on top. The rule is the layer, not force.
    expect(stylesheet).not.toContain('!important')
  })
})
