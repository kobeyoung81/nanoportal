import { describe, expect, it } from 'vitest'

import { OFFICE_FONT_ALIASES, officeFontCss } from './previewFonts'

// The substitution only helps when the real font wins: `local(...)` must come
// before the bundled file, or a machine with Office would be overridden by the
// stand-in and end up *less* faithful than before.
describe('officeFontCss', () => {
  it('tries the installed font before the bundled stand-in', () => {
    for (const rule of officeFontCss().split('@font-face').filter(Boolean)) {
      const localAt = rule.indexOf('local(')
      const urlAt = rule.indexOf('url(')
      expect(localAt).toBeGreaterThan(-1)
      expect(urlAt).toBeGreaterThan(localAt)
    }
  })

  it('covers the fonts Office documents ask for', () => {
    const families = new Set(OFFICE_FONT_ALIASES.map((alias) => alias.family))
    for (const family of ['Calibri', 'Cambria', 'Arial', 'Times New Roman', 'Courier New']) {
      expect(families.has(family), family).toBe(true)
    }
  })

  it('ships a regular and a bold file for each family, on the public font path', () => {
    const css = officeFontCss()
    for (const alias of OFFICE_FONT_ALIASES) {
      expect(alias.file).toMatch(/^[a-z0-9-]+-latin-(400|700)-normal\.woff2$/)
      expect(css).toContain(`url(/fonts/${alias.file}) format("woff2")`)
    }
    const weights = new Set(OFFICE_FONT_ALIASES.filter((a) => a.family === 'Calibri').map((a) => a.weight))
    expect([...weights].sort()).toEqual([400, 700])
  })

  it('quotes names so a stray quote cannot break out of the rule', () => {
    const css = officeFontCss(
      [{ family: 'Weird"Name', local: ['Also"Weird'], file: 'carlito-latin-400-normal.woff2', weight: 400 }],
      '/fonts/',
    )
    expect(css).toContain('font-family:"Weird\\"Name"')
    expect(css).toContain('local("Also\\"Weird")')
    expect(css.match(/@font-face/g)).toHaveLength(1)
  })
})
