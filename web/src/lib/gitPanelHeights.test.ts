// The caps follow the window, which is the point of passing the height in: a
// rotated phone must not keep the bounds of the taller viewport.
import { describe, expect, it } from 'vitest'
import { CHANGE_HEIGHT_MIN, DOCK_HEIGHT_MIN, changeHeightMax, dockHeightMax } from './gitPanelHeights'

describe('dockHeightMax', () => {
  it('takes 70% of the view', () => {
    expect(dockHeightMax(800)).toBe(560)
  })

  it('never drops below the floor a dock still needs', () => {
    expect(dockHeightMax(100)).toBe(DOCK_HEIGHT_MIN + 40)
  })
})

describe('changeHeightMax', () => {
  it('takes 60% of the view', () => {
    expect(changeHeightMax(800)).toBe(480)
  })

  it('never drops below the floor a change list still needs', () => {
    expect(changeHeightMax(100)).toBe(CHANGE_HEIGHT_MIN + 40)
  })
})
