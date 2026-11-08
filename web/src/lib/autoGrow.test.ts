// The rule that keeps an auto-growing textarea from collapsing: a measurement
// taken while the element is not laid out must never become its height.
import { describe, expect, it } from 'vitest'
import { autoGrow } from './autoGrow'

const MAX = 160

describe('autoGrow', () => {
  it('grows to the measured content height', () => {
    expect(autoGrow({ laidOut: true, measured: 24 }, MAX)).toEqual({ height: 24, overflowY: 'hidden' })
  })

  it('caps at the maximum and only then scrolls', () => {
    expect(autoGrow({ laidOut: true, measured: 400 }, MAX)).toEqual({ height: MAX, overflowY: 'auto' })
  })

  it('keeps the overflow hidden exactly at the cap', () => {
    expect(autoGrow({ laidOut: true, measured: MAX }, MAX)).toEqual({ height: MAX, overflowY: 'hidden' })
  })

  it('drops the inline height when the element has no box', () => {
    // The workbench vault: display:none, so scrollHeight measures 0. Writing 0
    // in is what collapsed the git commit box to a sliver. The number is not
    // what decides it — the missing box is — so a plausible-looking measurement
    // from a hidden element is dropped just the same.
    expect(autoGrow({ laidOut: false, measured: 0 }, MAX)).toEqual({ height: null, overflowY: 'hidden' })
    expect(autoGrow({ laidOut: false, measured: 24 }, MAX)).toEqual({ height: null, overflowY: 'hidden' })
  })

  it('drops the inline height for a degenerate measurement', () => {
    expect(autoGrow({ laidOut: true, measured: 0 }, MAX)).toEqual({ height: null, overflowY: 'hidden' })
    expect(autoGrow({ laidOut: true, measured: -3 }, MAX)).toEqual({ height: null, overflowY: 'hidden' })
    expect(autoGrow({ laidOut: true, measured: Number.NaN }, MAX)).toEqual({ height: null, overflowY: 'hidden' })
    expect(autoGrow({ laidOut: true, measured: Number.POSITIVE_INFINITY }, MAX)).toEqual({
      height: null,
      overflowY: 'hidden',
    })
  })
})
