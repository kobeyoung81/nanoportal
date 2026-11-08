// The product name is user-facing text in four files that no other test reads:
// the page title, the PWA manifest and the two language files. Renaming it by
// hand is exactly the kind of edit that leaves one place behind (an old name in
// the install prompt, say), so the old spelling is banned here instead.
//
// Both pages are imported as text: the repo has no `@types/node`, and the raw
// import is how the theme-token test already reads a non-module asset.
import { describe, expect, it } from 'vitest'
import html from '../../index.html?raw'
import manifest from '/manifest.webmanifest?raw'
import en from '../i18n/locales/en.json'
import zhCN from '../i18n/locales/zh-CN.json'

const BRAND = 'NanoSec'
const OLD_NAME = /myriadmind/i

function stringsOf(node: unknown, path = ''): Array<[string, string]> {
  if (typeof node === 'string') {
    return [[path, node]]
  }
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => stringsOf(item, `${path}[${index}]`))
  }
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, child]) => stringsOf(child, path ? `${path}.${key}` : key))
  }
  return []
}

describe('product branding', () => {
  it('names the browser tab after the product', () => {
    expect(html).toContain(`<title>${BRAND}</title>`)
  })

  it('installs under the product name', () => {
    const parsed = JSON.parse(manifest) as { name: string; short_name: string; description: string }
    expect(parsed.name).toBe(BRAND)
    expect(parsed.short_name).toBe(BRAND)
    expect(parsed.description).toContain(BRAND)
  })

  it('has no leftover old name in either language', () => {
    for (const [language, locale] of [
      ['zh-CN', zhCN],
      ['en', en],
    ] as const) {
      const leftovers = stringsOf(locale).filter(([, text]) => OLD_NAME.test(text)).map(([key]) => `${language}:${key}`)
      expect(leftovers).toEqual([])
    }
  })

  it('shows the product name in the admin tagline', () => {
    expect(zhCN.nav.adminTagline).toContain(BRAND)
    expect(en.nav.adminTagline).toContain(BRAND)
  })
})
