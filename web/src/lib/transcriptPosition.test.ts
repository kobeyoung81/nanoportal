import { describe, expect, it } from 'vitest'
import {
  BOTTOM_POSITION,
  TRANSCRIPT_BOTTOM_THRESHOLD_PX,
  anchorFromRects,
  positionAfterScroll,
  restoreTarget,
} from './transcriptPosition'

describe('anchorFromRects', () => {
  it('takes the topmost row that is still partly visible', () => {
    const anchor = anchorFromRects([
      { key: 'gone', top: -300, bottom: -80 },
      { key: 'half', top: -24, bottom: 40 },
      { key: 'next', top: 40, bottom: 120 },
    ])
    expect(anchor).toEqual({ mode: 'anchor', key: 'half', offset: 24 })
  })

  it('has no anchor when everything is scrolled past', () => {
    expect(anchorFromRects([{ key: 'gone', top: -40, bottom: -1 }])).toBeNull()
  })
})

describe('positionAfterScroll', () => {
  it('stays on the newest row while the viewport is close to it', () => {
    const anchor = { mode: 'anchor' as const, key: 'row', offset: 10 }
    expect(positionAfterScroll(TRANSCRIPT_BOTTOM_THRESHOLD_PX, anchor)).toEqual(BOTTOM_POSITION)
    expect(positionAfterScroll(0, anchor)).toEqual(BOTTOM_POSITION)
  })

  it('remembers the row being read once the reader scrolls away', () => {
    const anchor = { mode: 'anchor' as const, key: 'row', offset: 10 }
    expect(positionAfterScroll(400, anchor)).toEqual(anchor)
  })

  it('stays on the newest row when no row could be read', () => {
    expect(positionAfterScroll(400, null)).toEqual(BOTTOM_POSITION)
  })
})

describe('restoreTarget', () => {
  it('anchors to the remembered row, keeping the offset into it', () => {
    expect(restoreTarget({ mode: 'anchor', key: 'row', offset: 24 }, () => 100042)).toEqual({
      index: 100042,
      align: 'start',
      offset: 24,
    })
  })

  it('falls back to the newest row when the remembered row is gone', () => {
    expect(restoreTarget({ mode: 'anchor', key: 'row', offset: 24 }, () => null)).toEqual({
      index: 'LAST',
      align: 'end',
      offset: 0,
    })
  })

  it('follows the newest row for the bottom position', () => {
    expect(restoreTarget(BOTTOM_POSITION, () => 1)).toEqual({ index: 'LAST', align: 'end', offset: 0 })
  })
})
