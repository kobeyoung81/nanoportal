// 源码里引用的 CSS 变量必须真的存在。
//
// 主题重构把 token 从 `--popover` 改名成 `--c-popover-surface`，四处调用点
// 还写着 `var(--c-popover)`：属性在计算值阶段变成 unset，于是弹层整块透明，
// 标题栏上的按钮失去底色。构建、lint、类型检查都不会报错 —— 只有这条能拦住。
import { describe, expect, it } from 'vitest'

const sources = import.meta.glob('../**/*.{ts,tsx,css}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const tokens = import.meta.glob('../styles/tokens.*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** `--c-*` / `--ui-*` definitions from the generated token files. */
function defined(): Set<string> {
  const out = new Set<string>()
  for (const [path, text] of Object.entries(tokens)) {
    if (!path.includes('tokens.structure') && !path.includes('tokens.palette')) continue
    for (const match of text.matchAll(/(--(?:c|ui)-[a-z0-9-]+)\s*:/g)) out.add(match[1])
  }
  return out
}

/** Every `var(--c-*)` / `var(--ui-*)` reference with the file and line it sits on. */
function referenced(): { name: string; where: string }[] {
  const out: { name: string; where: string }[] = []
  for (const [path, text] of Object.entries(sources)) {
    if (path.includes('.test.')) continue
    if (path.includes('styles/tokens.')) continue // 定义本身
    const lines = text.split('\n')
    lines.forEach((line, index) => {
      for (const match of line.matchAll(/var\((--(?:c|ui)-[a-z0-9-]+)/g)) {
        out.push({ name: match[1], where: `${path.replace('../', '')}:${index + 1}` })
      }
    })
  }
  return out
}

describe('theme variables', () => {
  it('resolves every var(--c-*) and var(--ui-*) used in the app', () => {
    const have = defined()
    expect(have.size).toBeGreaterThan(30)
    const missing = referenced().filter((ref) => !have.has(ref.name))
    expect(
      missing,
      `undefined theme variables:\n${missing.map((m) => `  ${m.name} used at ${m.where}`).join('\n')}`,
    ).toEqual([])
  })
})
