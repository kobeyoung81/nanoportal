// Theme tokens the transcript's user bubble reads through Tailwind utilities
// (bg-user-message, text-user-message-foreground, border-user-message-border).
// A token defined in only one theme fails silently — the other theme falls back
// to the light tint or to nothing — and there is no DOM test in this repo to
// catch it, so the two blocks in index.css are checked directly.
import { describe, expect, it } from 'vitest'
import css from '../index.css?raw'
import palette from '../styles/tokens.palette.css?raw'

// 主题值现在由 scripts/sync-theme-tokens.mjs 生成到 tokens.palette.css；
// index.css 只保留 @theme 映射与基础样式。
const source = palette.replace(/\/\*[\s\S]*?\*\//g, '')
const rules = [...(`\n${source}`).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1].split(',').map((x) => x.trim()).filter(Boolean),
  body: m[2],
}))

// block returns the body of the rule whose selector list contains `selector`,
// so a mention inside another rule can never stand in for the definition.
function block(selector: string): string {
  const rule = rules.find((r) => r.selectors.includes(selector))
  if (!rule) {
    throw new Error(`tokens.palette.css has no "${selector}" rule`)
  }
  return rule.body
}

describe('user message theme tokens', () => {
  const tokens = ['--user-message-bg', '--user-message-fg', '--user-message-border']

  it.each(tokens)('defines %s for the light theme', (token) => {
    expect(block(':root')).toContain(token)
  })

  it.each(tokens)('defines %s for the dark theme', (token) => {
    expect(block('.dark')).toContain(token)
  })

  it('exposes all three as Tailwind colours', () => {
    const theme = css.slice(css.indexOf('@theme inline'), css.indexOf('\n}', css.indexOf('@theme inline')))
    expect(theme).toContain('--color-user-message: var(--user-message-bg)')
    expect(theme).toContain('--color-user-message-foreground: var(--user-message-fg)')
    expect(theme).toContain('--color-user-message-border: var(--user-message-border)')
  })
})
