import { describe, expect, it } from 'vitest'

import source from './FileDialog.tsx?raw'

// The header order is the point of this change:
// 编辑（源代码）→ 重新加载 → 下载 → 全屏 → 在新标签页打开 → 关闭.
//
// Order cannot be observed without a DOM renderer, and this repository keeps its
// unit tests DOM-free, so the assertion reads the component source instead —
// the same technique `lib/branding.test.ts` uses for index.html.
describe('FileDialog header actions', () => {
  const markers = [
    "t('common.edit')",
    '<PreviewReloadButton',
    "t('files.download')",
    "t('files.viewFullscreen')",
    "t('files.openInNewTab')",
    "t('common.close')",
  ]

  it('offers the actions in the requested order', () => {
    const positions = markers.map((marker) => source.indexOf(marker))
    for (const [index, position] of positions.entries()) {
      expect(position, `${markers[index]} is missing from FileDialog`).toBeGreaterThan(-1)
    }
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
  })

  it('labels full screen with its own key, not the file panel’s one', () => {
    // `files.fullscreen` reads "全屏文件" and belongs to the file panel's
    // full-page view; reusing it here made the label mean the wrong thing.
    expect(source).not.toContain("t('files.fullscreen')")
  })

  it('gives the new-tab and full-screen buttons text, and leaves close icon-only', () => {
    expect(source).toContain("<span className=\"hidden sm:inline\">{t('files.openInNewTab')}</span>")
    expect(source).toContain("aria-label={t('common.close')}")
    expect(source).not.toContain("{t('common.close')}</span>")
  })
})
