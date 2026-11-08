import { describe, expect, it } from 'vitest'
import { paneLayerAriaHidden, paneLayerClass } from './paneVisibility'

const tokens = (value: string) => value.split(/\s+/).filter(Boolean)

describe('paneLayerClass', () => {
  it('keeps the layout box: no display:none for a hidden pane', () => {
    // The whole point of the change: a hidden pane still has a box, otherwise
    // the virtualised transcript unmounts and a tab switch paints an empty area.
    for (const active of [true, false]) {
      expect(tokens(paneLayerClass(active))).not.toContain('hidden')
    }
  })

  it('gives both states the same geometry, so a switch cannot reflow', () => {
    for (const token of ['absolute', 'inset-0', 'flex', 'min-h-0', 'flex-col']) {
      expect(tokens(paneLayerClass(true))).toContain(token)
      expect(tokens(paneLayerClass(false))).toContain(token)
    }
  })

  it('hides an inactive pane without letting it take input', () => {
    expect(tokens(paneLayerClass(false))).toContain('invisible')
    expect(tokens(paneLayerClass(false))).toContain('pointer-events-none')
    expect(tokens(paneLayerClass(true))).not.toContain('invisible')
  })
})

describe('paneLayerAriaHidden', () => {
  it('hides off-screen panes from assistive technology', () => {
    expect(paneLayerAriaHidden(true)).toBe(false)
    expect(paneLayerAriaHidden(false)).toBe(true)
  })
})
