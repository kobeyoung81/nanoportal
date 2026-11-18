// 一次性维护脚本：把 index.css 里 @supports not (color: color-mix(...)) 回退块的
// rgb() 通道同步成当前 token。legacyColorFallbacks.test.ts 会校验这份一致性。
import fs from 'node:fs'

const PATH = new URL('../src/index.css', import.meta.url)
const css = fs.readFileSync(PATH, 'utf8')

const blockOf = (selector) => {
  const start = css.indexOf(`\n${selector} {`)
  return css.slice(start, css.indexOf('\n}', start))
}
const tokenMap = (selector) => {
  const out = {}
  for (const m of blockOf(selector).matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6});/g)) {
    const h = m[2].replace('#', '')
    out[m[1]] = [0, 2, 4].map((i) => String(parseInt(h.slice(i, i + 2), 16))).join(' ')
  }
  return out
}
const light = tokenMap(':root')
const dark = tokenMap('.dark')

const START = '@supports not (color: color-mix(in srgb, red, blue)) {'
const at = css.indexOf(START)
const end = css.indexOf('\n}', at)
let block = css.slice(at, end + 2)

const UTILS = ['bg', 'border', 'divide', 'ring', 'text', 'fill', 'stroke']

const channelsFor = (selector) => {
  let sel = selector
  const isDark = sel.startsWith('.dark ')
  if (isDark) sel = sel.slice('.dark '.length)
  sel = sel.replace(/^\./, '')
  // 类名里的变体冒号是转义的（`hover\:`），伪类冒号没有转义 —— 按未转义的冒号切掉伪类。
  const pseudo = sel.search(/(?<!\\):/)
  if (pseudo >= 0) sel = sel.slice(0, pseudo)
  const base = sel.replace(/\\:/g, ':').replace(/\\\//g, '/')
  const cls = base.slice(base.lastIndexOf(':') + 1)
  const slash = cls.lastIndexOf('/')
  if (slash < 0) return null
  const util = cls.slice(0, slash)
  const alpha = String(Number(cls.slice(slash + 1)) / 100)
  const name = UTILS.reduce((acc, u) => {
    if (acc != null) return acc
    return util.startsWith(`${u}-`) ? util.slice(u.length + 1) : null
  }, null)
  if (!name) return null
  const table = isDark ? dark : light
  if (!table[name]) return null
  return { channels: table[name], alpha }
}

let changed = 0
block = block.replace(/(\.[^{}]+?)\s*\{([^}]*)\}/g, (whole, selector, body) => {
  const info = channelsFor(selector.trim().replace(/\s+/g, ' '))
  if (!info) return whole
  if (!/rgb\(/.test(body)) return whole
  const next = body.replace(/rgb\([^)]*\)/g, `rgb(${info.channels} / ${info.alpha})`)
  if (next !== body) changed++
  return `${selector} {${next}}`
})

fs.writeFileSync(PATH, css.slice(0, at) + block + css.slice(end + 2))
console.log(`rewrote ${changed} fallback rules`)
