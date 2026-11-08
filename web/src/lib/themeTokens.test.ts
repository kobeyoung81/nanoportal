// Theme tokens the transcript's user bubble reads through Tailwind utilities
// (bg-user-message, text-user-message-foreground, border-user-message-border).
// A token defined in only one theme fails silently — the other theme falls back
// to the light tint or to nothing — and there is no DOM test in this repo to
// catch it, so the two blocks in index.css are checked directly.
import { describe, expect, it } from 'vitest'
import css from '../index.css?raw'

// block returns the body of a top-level rule, located by its own line so a mention
// inside another rule (the @custom-variant dark line, the @theme mappings) can
// never stand in for the definition.
function block(selector: string): string {
  const start = css.indexOf(`\n${selector} {`)
  if (start < 0) {
    throw new Error(`index.css has no "${selector} {" block`)
  }
  const end = css.indexOf('\n}', start)
  return css.slice(start, end)
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
    const theme = block('@theme inline')
    expect(theme).toContain('--color-user-message: var(--user-message-bg)')
    expect(theme).toContain('--color-user-message-foreground: var(--user-message-fg)')
    expect(theme).toContain('--color-user-message-border: var(--user-message-border)')
  })
})
