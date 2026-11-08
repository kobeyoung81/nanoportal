// The composer toolbar's fit ladder: when to step down, and when the trailing
// controls have left the composer.
import { describe, expect, it } from 'vitest'
import {
  COMPOSER_FIT_MAX_TIER,
  COMPOSER_FIT_TOLERANCE_PX,
  nextComposerTier,
  overflowsContentBox,
} from './composerFit'

describe('nextComposerTier', () => {
  it('holds the full layout while the row fits', () => {
    expect(nextComposerTier(0, false)).toBe(0)
  })

  it('steps down exactly one tier per overflowing pass', () => {
    // One step at a time: the row never jumps straight to the cheapest layout.
    expect(nextComposerTier(0, true)).toBe(1)
    expect(nextComposerTier(1, true)).toBe(2)
    expect(nextComposerTier(2, true)).toBe(3)
  })

  it('stops at the last tier instead of running past it', () => {
    // The cap is what keeps the tier tables in the markup in range.
    expect(nextComposerTier(COMPOSER_FIT_MAX_TIER, true)).toBe(COMPOSER_FIT_MAX_TIER)
  })

  it('never climbs back on its own', () => {
    // Only the resize observer restarts the ladder; a row that fits keeps the
    // tier it settled on.
    expect(nextComposerTier(2, false)).toBe(2)
  })

  it('does not go below the full layout', () => {
    // Guards a careless clamp, which would index the tier tables out of range.
    expect(nextComposerTier(-1, true)).toBe(0)
    expect(nextComposerTier(-1, false)).toBe(-1)
  })
})

describe('overflowsContentBox', () => {
  // A 100px-wide box with 8px of horizontal padding ends its content at 92.
  it('reports an element that passes the content box', () => {
    expect(overflowsContentBox(110, 100, 8)).toBe(true)
    expect(overflowsContentBox(93, 100, 8)).toBe(true)
  })

  it('reports an element that ends inside the content box', () => {
    expect(overflowsContentBox(92, 100, 8)).toBe(false)
    expect(overflowsContentBox(80, 100, 8)).toBe(false)
  })

  it('tolerates sub-pixel overhang', () => {
    // Rounding must not be mistaken for the send button leaving the box: on a
    // pane that fits, dropping a tier would drop the labels for nothing.
    expect(overflowsContentBox(92 + COMPOSER_FIT_TOLERANCE_PX / 2, 100, 8)).toBe(false)
    expect(overflowsContentBox(92 + COMPOSER_FIT_TOLERANCE_PX + 0.1, 100, 8)).toBe(true)
  })
})
