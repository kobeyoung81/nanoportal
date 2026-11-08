// The context ring's threshold marker must show where the agent's gate actually
// fires, not a percentage this client picked. The live platform ran a 1M-token
// window with the trigger at 85 % while the ring drew 75 %, so the ring sat past
// its own marker with no compaction in sight.
import { describe, expect, it } from 'vitest'
import { compactThresholdPct } from './contextRing'

describe('compactThresholdPct', () => {
  it('uses the threshold the agent reports', () => {
    // 822147 of a 1_000_000 window = 82 %, not the old hard-coded 75 %.
    const pct = compactThresholdPct({ threshold: 822147, budget: 967232, limit: 1000000 })
    expect(pct).toBeCloseTo(82.2147, 3)
  })

  it('falls back to 75 % of the budget for a client without a reported threshold', () => {
    expect(compactThresholdPct({ budget: 800, limit: 1000 })).toBeCloseTo(60, 6)
  })

  it('has no marker when neither threshold nor budget is known', () => {
    expect(compactThresholdPct({ limit: 1000 })).toBeUndefined()
  })

  it('has no marker without a usable limit', () => {
    expect(compactThresholdPct({ threshold: 100, limit: 0 })).toBeUndefined()
    expect(compactThresholdPct({ threshold: 100 })).toBeUndefined()
  })

  it('clamps a threshold above the window instead of overshooting the ring', () => {
    expect(compactThresholdPct({ threshold: 1200, limit: 1000 })).toBe(100)
  })
})
