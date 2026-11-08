import { describe, expect, it } from 'vitest'

import { cellKey, mergeLayout } from './sheetLayout'

describe('mergeLayout', () => {
  it('turns a merged block into one anchor and hides the rest', () => {
    const layout = mergeLayout([{ s: { r: 0, c: 0 }, e: { r: 1, c: 1 } }], 5)
    expect(layout.spans.get(cellKey(0, 0))).toEqual({ rowSpan: 2, colSpan: 2 })
    expect(layout.covered.has(cellKey(0, 1))).toBe(true)
    expect(layout.covered.has(cellKey(1, 0))).toBe(true)
    expect(layout.covered.has(cellKey(1, 1))).toBe(true)
    expect(layout.covered.has(cellKey(0, 0))).toBe(false)
  })

  it('clips a merge that crosses the rendered row limit', () => {
    const layout = mergeLayout([{ s: { r: 1, c: 0 }, e: { r: 5, c: 2 } }], 3)
    // Rows 1..2 survive; the anchor keeps its three columns but only two rows.
    expect(layout.spans.get(cellKey(1, 0))).toEqual({ rowSpan: 2, colSpan: 3 })
    expect(layout.covered.has(cellKey(2, 2))).toBe(true)
    expect(layout.covered.has(cellKey(3, 0))).toBe(false)
  })

  it('ignores merges that start past the rendered rows', () => {
    const layout = mergeLayout([{ s: { r: 4, c: 0 }, e: { r: 6, c: 1 } }], 3)
    expect(layout.spans.size).toBe(0)
    expect(layout.covered.size).toBe(0)
  })

  it('keeps a single-cell merge as a plain cell', () => {
    const layout = mergeLayout([{ s: { r: 0, c: 3 }, e: { r: 0, c: 3 } }], 2)
    expect(layout.spans.get(cellKey(0, 3))).toEqual({ rowSpan: 1, colSpan: 1 })
    expect(layout.covered.size).toBe(0)
  })
})
