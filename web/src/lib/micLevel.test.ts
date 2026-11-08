import { describe, expect, it } from 'vitest'
import { FLOOR_DB, clipping, formatDb, levelPercent, peakDb, rmsDb } from './micLevel'

function samples(values: number[]): Float32Array {
  return Float32Array.from(values)
}

describe('peakDb', () => {
  it('reports 0 dBFS for a full-scale sample', () => {
    expect(peakDb(samples([0.5, -1, 0.25]))).toBeCloseTo(0, 5)
  })

  it('reports the halved amplitude as about -6 dB', () => {
    expect(peakDb(samples([0.5, 0.1]))).toBeCloseTo(-6.02, 1)
  })

  it('treats silence as -Infinity rather than a number', () => {
    expect(peakDb(samples([0, 0, 0]))).toBe(Number.NEGATIVE_INFINITY)
    expect(peakDb(samples([]))).toBe(Number.NEGATIVE_INFINITY)
  })
})

describe('rmsDb', () => {
  it('sits below the peak of a signal with quiet parts', () => {
    // Amplitude RMS of [1,0,0,0] is 0.5, i.e. -6 dB; power averaging would be -12.
    const rms = rmsDb(samples([1, 0, 0, 0]))
    expect(rms).toBeCloseTo(-6.02, 1)
    expect(rms).toBeLessThan(peakDb(samples([1, 0, 0, 0])))
  })

  it('reports silence for an empty frame', () => {
    expect(rmsDb(samples([]))).toBe(Number.NEGATIVE_INFINITY)
  })
})

describe('clipping', () => {
  // The threshold is spelled out here rather than read from the module: a test
  // that imports the constant moves with it, and would still pass if the constant
  // were raised past the point of ever flagging anything.
  it('flags a sample at the 16-bit ceiling', () => {
    expect(clipping(samples([0.1, 0.98]))).toBe(true)
  })

  it('leaves a sample just below the ceiling alone', () => {
    expect(clipping(samples([0.97]))).toBe(false)
  })

  it('leaves a loud but unclipped frame alone', () => {
    expect(clipping(samples([0.9, -0.9]))).toBe(false)
  })

  it('honours a caller-supplied threshold', () => {
    expect(clipping(samples([0.5]), 0.4)).toBe(true)
    expect(clipping(samples([0.5]), 0.6)).toBe(false)
  })
})

describe('levelPercent', () => {
  it('spans the meter from the floor to full scale', () => {
    expect(levelPercent(0)).toBe(100)
    expect(levelPercent(FLOOR_DB)).toBe(0)
    expect(levelPercent(-30)).toBeCloseTo(50, 5)
  })

  it('keeps out-of-range values inside the bar', () => {
    expect(levelPercent(-200)).toBe(0)
    expect(levelPercent(12)).toBe(100)
    expect(levelPercent(Number.NEGATIVE_INFINITY)).toBe(0)
  })
})

describe('formatDb', () => {
  it('prints one decimal place', () => {
    expect(formatDb(-12.34)).toBe('-12.3 dB')
  })

  it('prints silence as -∞', () => {
    expect(formatDb(Number.NEGATIVE_INFINITY)).toBe('−∞')
  })
})
