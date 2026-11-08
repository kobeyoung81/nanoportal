import { describe, expect, it } from 'vitest'
import { downsampleTo, floatToPcm16, levelOf } from './pcm'

function pcm16(samples: Float32Array): number[] {
  const bytes = floatToPcm16(samples)
  const view = new DataView(bytes.buffer)
  const out: number[] = []
  for (let i = 0; i < bytes.length; i += 2) {
    out.push(view.getInt16(i, true))
  }
  return out
}

describe('floatToPcm16', () => {
  it('writes little-endian signed 16-bit samples', () => {
    const bytes = floatToPcm16(new Float32Array([0]))
    expect(Array.from(bytes)).toEqual([0, 0])
    expect(bytes.length).toBe(2)
  })

  it('maps the extremes without wrapping around', () => {
    expect(pcm16(new Float32Array([1, -1]))).toEqual([0x7fff, -0x8000])
  })

  it('clamps out-of-range input', () => {
    expect(pcm16(new Float32Array([2, -2]))).toEqual([0x7fff, -0x8000])
  })

  it('rounds to the nearest code', () => {
    expect(pcm16(new Float32Array([0.5]))).toEqual([16384])
  })
})

describe('downsampleTo', () => {
  it('averages each output window when the ratio is an integer', () => {
    const input = new Float32Array([1, 3, 5, 7])
    expect(Array.from(downsampleTo(input, 48000, 24000))).toEqual([2, 6])
  })

  it('handles a non-integer ratio (44.1 kHz capture)', () => {
    // Six input samples to three output samples: windows [0,2), [2,4), [4,6).
    const input = new Float32Array([0, 1, 2, 3, 4, 5])
    expect(Array.from(downsampleTo(input, 44100, 22050))).toEqual([0.5, 2.5, 4.5])
  })

  it('copies the samples when no rate change is needed', () => {
    const input = new Float32Array([1, 2, 3])
    const out = downsampleTo(input, 24000, 24000)
    expect(Array.from(out)).toEqual([1, 2, 3])
    expect(out).not.toBe(input)
  })

  it('returns nothing for empty or impossible input', () => {
    expect(downsampleTo(new Float32Array(0), 48000, 24000).length).toBe(0)
    expect(downsampleTo(new Float32Array([1, 2]), 0, 24000).length).toBe(0)
    expect(downsampleTo(new Float32Array([1, 2]), 48000, 0).length).toBe(0)
  })
})

describe('levelOf', () => {
  it('reports silence as zero', () => {
    expect(levelOf(new Float32Array([0, 0, 0, 0]))).toBe(0)
  })

  it('saturates at one for loud input', () => {
    const loud = new Float32Array([1, -1, 1, -1])
    expect(levelOf(loud)).toBe(1)
  })

  it('reports a mid-range level for a quiet signal', () => {
    const level = levelOf(new Float32Array([0.1, -0.1, 0.1, -0.1]))
    expect(level).toBeGreaterThan(0)
    expect(level).toBeLessThan(1)
  })

  it('reports zero for an empty frame', () => {
    expect(levelOf(new Float32Array(0))).toBe(0)
  })
})
