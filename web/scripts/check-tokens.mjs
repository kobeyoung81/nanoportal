// 主题两轴的边界检查：
//   1. 结构里不能出现颜色，配色里不能出现尺寸；
//   2. 生成的 CSS 必须与 tokens.json 一致（改了 JSON 忘了跑 sync 会在这里失败）；
//   3. 每个 legacy 别名都要能在两档配色里找到来源。
import fs from 'node:fs'
import path from 'node:path'
import { readTokens, render } from './sync-theme-tokens.mjs'

const SRC = path.resolve(process.cwd(), 'src/styles')
const tokens = readTokens()
const problems = []

const COLOR = /#|rgb\(|hsl\(|oklch\(|color-mix\(/
const SIZE = /\d(px|rem|em|%|vh|vw)/

for (const [id, s] of Object.entries(tokens.structure)) {
  for (const [key, value] of Object.entries(s)) {
    const text = typeof value === 'string' ? value : Object.values(value).join(' ')
    if (COLOR.test(text)) problems.push(`structure.${id}.${key} 含色值：${text}`)
  }
}

for (const [id, modes] of Object.entries(tokens.palette)) {
  for (const [mode, p] of Object.entries(modes)) {
    for (const [key, value] of Object.entries(p)) {
      if (SIZE.test(value)) problems.push(`palette.${id}.${mode}.${key} 含尺寸：${value}`)
      if (!/^(#[0-9a-f]{6}|rgb\(|rgba\()/i.test(value)) {
        problems.push(`palette.${id}.${mode}.${key} 不是 hex/rgb：${value}`)
      }
    }
    for (const [legacy, from] of Object.entries(tokens.legacy)) {
      if (p[from] == null) problems.push(`legacy ${legacy} 指向不存在的 ${from}`)
    }
  }
}

const expected = render(tokens)
for (const [file, want] of [
  ['tokens.structure.css', expected.structure],
  ['tokens.palette.css', expected.palette],
]) {
  const got = fs.readFileSync(path.join(SRC, file), 'utf8')
  if (got !== want) problems.push(`${file} 与 tokens.json 不一致 —— 跑 npm run sync:theme`)
}

if (problems.length) {
  console.error('theme token check FAILED')
  for (const p of problems) console.error(' - ' + p)
  process.exit(1)
}
console.log(`theme token check ok (${Object.keys(tokens.structure).length} structure × ${Object.keys(tokens.palette).length} palette)`)
