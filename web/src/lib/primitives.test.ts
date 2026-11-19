// 结构原语必须留在 @layer components 里。
//
// 它们是"默认值"，调用方用工具类覆盖正是常规写法（`<Card className="rounded-none">`
// 把卡片抹平成贴边容器）。一旦原语落到层外，它会压过 @layer utilities，
// 于是全屏工作台、全屏对话框、composer 的文本域都会多出圆角和 1px 边框。
import { describe, expect, it } from 'vitest'
import css from '../styles/primitives.css?raw'

const body = css.replace(/\/\*[\s\S]*?\*\//g, '').trim()

describe('structure primitives', () => {
  it('wraps every rule in @layer components', () => {
    expect(body.startsWith('@layer components {')).toBe(true)
    expect(body.endsWith('}')).toBe(true)
    // 层外不应再有任何顶层规则：文件里所有 `{` 都必须在这个块之内。
    let depth = 0
    let closedAt = -1
    for (let i = 0; i < body.length; i++) {
      if (body[i] === '{') depth++
      if (body[i] === '}') {
        depth--
        if (depth === 0 && closedAt < 0) closedAt = i
      }
    }
    expect(closedAt).toBe(body.length - 1)
    expect(depth).toBe(0)
  })

  it('keeps the eight primitives and the rail', () => {
    for (const name of [
      '.ui-surface',
      '.ui-panel',
      '.ui-toolbar',
      '.ui-control',
      '.ui-field',
      '.ui-row',
      '.ui-label',
      '.ui-rail',
      '.rail-active',
    ]) {
      expect(body).toContain(name)
    }
  })
})
