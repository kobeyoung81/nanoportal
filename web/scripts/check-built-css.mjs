// 构建产物门禁：Chrome 109 不认 oklch()/color-mix()。
// - oklch/oklab 一律不允许出现；
// - color-mix() 只允许出现在 @supports 条件或其块内（Tailwind 生成的透明度修饰符就是这样）。
// 用法：npm run build && node scripts/check-built-css.mjs
import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'

const dir = path.resolve(process.cwd(), 'dist/assets')
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.css'))
if (files.length === 0) {
  console.error('check-built-css: no CSS in dist/assets — run `npm run build` first')
  process.exit(1)
}

let failed = false
for (const file of files) {
  const css = fs.readFileSync(path.join(dir, file), 'utf8')
  if (/\boklch\(|\boklab\(/.test(css)) {
    console.error(`${file}: contains oklch()/oklab() — Chrome 109 cannot parse it`)
    failed = true
  }
  const root = postcss.parse(css)
  root.walkDecls((decl) => {
    if (!decl.value.includes('color-mix(')) return
    for (let node = decl.parent; node; node = node.parent) {
      if (node.type === 'atrule' && node.name === 'supports') return
    }
    console.error(`${file}:${decl.source?.start?.line}: color-mix() outside @supports (${decl.prop})`)
    failed = true
  })
}

if (failed) {
  console.error('check-built-css: FAILED')
  process.exit(1)
}
console.log(`check-built-css: ok (${files.length} file(s))`)
