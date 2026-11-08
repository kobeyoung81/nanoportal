// Chrome < 111 (and Safari < 16.4 / Firefox < 113) has no `color-mix()`, which
// is how Tailwind emits every `colour/NN` opacity modifier: the solid colour
// first, the tinted `color-mix()` second. An engine that drops the second
// declaration paints the *fully opaque* colour, which is how the question card
// turned into a saturated blue block on a Chrome 103 browser. The @supports
// block in index.css restores the tints by hand; this test keeps that list
// honest: every modifier the sources use needs a rule, carrying the token's own
// colour and the modifier's alpha.
import { describe, expect, it } from 'vitest'
import css from '../index.css?raw'

const THEME_COLORS = [
  'primary-foreground',
  'muted-foreground',
  'primary',
  'secondary',
  'accent',
  'muted',
  'destructive',
  'danger',
  'success',
  'warning',
  'info',
  'background',
  'foreground',
  'card',
  'border',
  'ring',
  'input',
  'popover',
]

const UTILITIES = ['bg', 'border', 'divide', 'ring', 'text', 'fill', 'stroke']

// A class token such as `hover:bg-accent/60` or `text-muted-foreground/70`.
const TOKEN = new RegExp(
  `(?<![\\w-])((?:[a-z-]+:)*(?:${UTILITIES.join('|')})-(?:${THEME_COLORS.join('|')})/\\d+)(?![\\w-])`,
  'g',
)

const PSEUDO: Record<string, string> = {
  '': '',
  'hover:': ':hover',
  'active:': ':active',
  'focus-visible:': ':focus-visible',
  'disabled:': ':disabled',
}

const sources = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Every modifier the app actually uses, minus the test files themselves. */
function usedTokens(): string[] {
  const out = new Set<string>()
  for (const [path, text] of Object.entries(sources)) {
    if (path.endsWith('.test.ts') || path.endsWith('.test.tsx')) {
      continue
    }
    for (const match of text.matchAll(TOKEN)) {
      out.add(match[1])
    }
  }
  return [...out].sort()
}

/** The body of a top-level rule, located by its own line. */
function block(selector: string): string {
  const start = css.indexOf(`\n${selector} {`)
  if (start < 0) {
    throw new Error(`index.css has no "${selector} {" block`)
  }
  return css.slice(start, css.indexOf('\n}', start))
}

/** The hand-written fallbacks for engines without color-mix(). */
function legacyBlock(): string {
  const start = css.indexOf('@supports not (color: color-mix(in srgb, red, blue)) {')
  if (start < 0) {
    throw new Error('index.css has no @supports not (color: color-mix(...)) block')
  }
  return css.slice(start, css.indexOf('\n}', start))
}

function channels(hex: string): string {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => String(parseInt(h.slice(i, i + 2), 16))).join(' ')
}

/** `--token: #rrggbb` values of one theme block, as rgb channel triples. */
function theme(selector: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of block(selector).matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6});/g)) {
    out[match[1]] = channels(match[2])
  }
  return out
}

const light = theme(':root')
const dark = theme('.dark')

function escapeClass(cls: string): string {
  return cls.replace(/[:/]/g, (char) => `\\${char}`)
}

function selectorFor(cls: string): string {
  const cut = cls.lastIndexOf(':') + 1
  const variant = cls.slice(0, cut)
  const base = cls.slice(cut)
  const pseudo = PSEUDO[variant]
  if (pseudo === undefined) {
    throw new Error(`unknown variant "${variant}" in ${cls} — teach PSEUDO about it`)
  }
  // `divide-*` colours the children, not the element itself.
  const child = base.startsWith('divide-') ? ' > :not(:last-child)' : ''
  return `.${escapeClass(cls)}${pseudo}${child}`
}

function colorOf(cls: string): string {
  const base = cls.slice(cls.lastIndexOf(':') + 1)
  return base.slice(base.indexOf('-') + 1, base.lastIndexOf('/'))
}

function alphaOf(cls: string): string {
  return String(Number(cls.slice(cls.lastIndexOf('/') + 1)) / 100)
}

/** The declaration block of one rule in the hand-written list, or ''. */
function ruleFor(selector: string, body: string): string {
  const at = body.indexOf(`${selector} {`)
  if (at < 0) {
    return ''
  }
  return body.slice(at, body.indexOf('}', at))
}

describe('legacy colour fallbacks', () => {
  const body = legacyBlock()
  const tokens = usedTokens()

  it('finds the modifiers the sources use', () => {
    expect(tokens.length).toBeGreaterThan(20)
  })

  it.each(tokens)('%s has a fallback for both themes', (token) => {
    const selector = selectorFor(token)
    expect(ruleFor(selector, body), `add ${selector} to the @supports block in src/index.css`).not.toBe('')
    expect(
      ruleFor(`.dark ${selector}`, body),
      `add the .dark variant of ${selector} to the @supports block in src/index.css`,
    ).not.toBe('')
  })

  it.each(tokens)('%s uses its token colour and alpha', (token) => {
    const selector = selectorFor(token)
    const name = colorOf(token)
    const alpha = alphaOf(token)
    const lightRule = ruleFor(selector, body)
    const darkRule = ruleFor(`.dark ${selector}`, body)
    expect(lightRule, `no rule for ${selector}`).toContain(`rgb(${light[name]} / ${alpha})`)
    expect(darkRule, `no rule for .dark ${selector}`).toContain(`rgb(${dark[name]} / ${alpha})`)
  })
})
