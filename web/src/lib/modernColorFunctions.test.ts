// Chrome 109 兜底：现代颜色函数只能出现在 @supports 条件里，不能出现在声明里。
// 背景见 docs/LEGACY_BROWSER_COMPATIBILITY.md。
import { describe, expect, it } from 'vitest'
import css from '../index.css?raw'

/** 注释里会提到 color-mix()，先去掉，避免误判。 */
const source = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** 每一处 color-mix( 都必须出现在 @supports 的条件行上。 */
function declarationsUsingColorMix(input: string): string[] {
  return input
    .split('\n')
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line.includes('color-mix(') && !line.startsWith('@supports'))
    .map(({ line, number }) => `${number}: ${line.slice(0, 80)}`)
}

describe('modern colour functions', () => {
  it('does not use oklch()/oklab() in styles', () => {
    expect(source).not.toMatch(/\boklch\(/)
    expect(source).not.toMatch(/\boklab\(/)
  })

  it('only mentions color-mix() in an @supports guard', () => {
    const offenders = declarationsUsingColorMix(source)
    expect(
      offenders,
      'color-mix() only works in Chrome 111+; keep it inside an @supports condition, ' +
        'and express the actual value as hex or rgb(R G B / A)',
    ).toEqual([])
  })

  it('keeps a legacy fallback block', () => {
    expect(source).toContain('@supports not (color: color-mix(in srgb, red, blue))')
  })
})
