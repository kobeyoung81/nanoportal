// Three contracts the language files have to keep, none of which any test
// checked before: placeholders use i18next's default `{{name}}` syntax, both
// languages carry the same keys with the same placeholders in them, and every
// key the source asks for by name is actually defined.
//
// A single-brace placeholder is not interpolation. It renders literally, which
// is how "follow default ({value})" reached a user in the model picker.
//
// The third contract is what lets a `t('a.b.c')` typo reach a user as the raw
// key: the two parity checks below pass happily while both files are missing
// it. `agent.sessionSwitch.*` (three keys, shown after a compaction) and
// `common.remove` / `files.saved` / `files.up` were all missing that way.
import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'

/** A `{name}` that is not part of a `{{name}}`. */
const SINGLE_BRACE = /(?<!\{)\{[A-Za-z_][A-Za-z0-9_]*\}(?!\})/
const PLACEHOLDER = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g

function stringPaths(node: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (value: unknown, path: string) => {
    if (typeof value === 'string') {
      out.set(path, value)
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`))
      return
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        walk(child, path ? `${path}.${key}` : key)
      }
    }
  }
  walk(node, prefix)
  return out
}

const locales = {
  'zh-CN': stringPaths(zhCN),
  en: stringPaths(en),
}

function placeholdersOf(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1]).sort()
}

/** Loaded as text so the scan below needs no filesystem access of its own. */
const sources = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * A key the source spells out in full, as a direct argument of `t()` — both
 * `t('a.b')` and `i18n.t('a.b')` match.
 *
 * The guard is what keeps `format(...)`, and any other call whose name merely
 * ends in `t`, out of the match. Keys built at runtime (`t(prefix + name)` or a
 * template literal) are deliberately out of reach: only the ones written out
 * can be checked.
 */
const STATIC_KEY = /(?<![\w$])t\(\s*'([A-Za-z0-9_.-]+)'/g

function usedKeys(): Map<string, string> {
  const out = new Map<string, string>()
  for (const [path, text] of Object.entries(sources)) {
    if (path.endsWith('.test.ts') || path.endsWith('.test.tsx')) {
      continue
    }
    text.split('\n').forEach((line, index) => {
      for (const match of line.matchAll(STATIC_KEY)) {
        if (!out.has(match[1])) {
          out.set(match[1], `${path}:${index + 1}`)
        }
      }
    })
  }
  return out
}

describe('i18n language files', () => {
  it('defines every key the source asks for by name', () => {
    const used = usedKeys()
    // A scan that silently matched nothing would make the assertion below
    // vacuous, so the count is part of the contract too.
    expect(used.size).toBeGreaterThan(500)
    const missing: string[] = []
    for (const [key, where] of used) {
      if (!locales.en.has(key) && !locales['zh-CN'].has(key)) {
        missing.push(`${key} <- ${where}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('uses double-brace placeholders only', () => {
    const offenders: string[] = []
    for (const [locale, strings] of Object.entries(locales)) {
      for (const [path, text] of strings) {
        if (SINGLE_BRACE.test(text)) {
          offenders.push(`${locale}: ${path} = ${JSON.stringify(text)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps both languages on the same keys', () => {
    const [zh, enUS] = [locales['zh-CN'], locales.en]
    expect([...zh.keys()].filter((path) => !enUS.has(path))).toEqual([])
    expect([...enUS.keys()].filter((path) => !zh.has(path))).toEqual([])
  })

  it('keeps both languages on the same placeholders', () => {
    const [zh, enUS] = [locales['zh-CN'], locales.en]
    const mismatched: string[] = []
    for (const [path, text] of zh) {
      const other = enUS.get(path)
      if (other === undefined) {
        continue
      }
      const [a, b] = [placeholdersOf(text).join(','), placeholdersOf(other).join(',')]
      if (a !== b) {
        mismatched.push(`${path}: zh {${a}} vs en {${b}}`)
      }
    }
    expect(mismatched).toEqual([])
  })
})
