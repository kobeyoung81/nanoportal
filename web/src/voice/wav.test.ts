import { describe, expect, it } from 'vitest'
import { framesToWav, resamplePcm16, wavFromPcm16 } from './wav'

function pcm16(samples: number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(samples.length * 2)
  const view = new DataView(out.buffer)
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true))
  return out
}

async function bytesOf(blob: Blob): Promise<DataView> {
  return new DataView(await blob.arrayBuffer())
}

describe('wavFromPcm16', () => {
  it('writes a mono 16-bit header around the samples', async () => {
    const pcm = pcm16([0, 100, -100])
    const view = await bytesOf(wavFromPcm16(pcm, 16000))
    const text = (offset: number, length: number) =>
      Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join('')

    expect(text(0, 4)).toBe('RIFF')
    expect(text(8, 4)).toBe('WAVE')
    expect(text(12, 4)).toBe('fmt ')
    // The declared sizes are what a reader trusts, so they must match the payload.
    expect(view.getUint32(4, true)).toBe(36 + pcm.length)
    expect(view.getUint32(40, true)).toBe(pcm.length)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(34, true)).toBe(16)
  })
})

describe('resamplePcm16', () => {
  it('halves 24 kHz into 16 kHz', () => {
    const resampled = resamplePcm16(pcm16(new Array(2400).fill(1000)), 24000, 16000)
    expect(resampled.length).toBe(1600 * 2)
    expect(new DataView(resampled.buffer).getInt16(0, true)).toBe(1000)
  })

  it('leaves a matching rate alone', () => {
    const pcm = pcm16([1, 2, 3])
    expect(resamplePcm16(pcm, 16000, 16000)).toBe(pcm)
  })

  it('averages the window instead of dropping samples', () => {
    // A step from 0 to 300: the second output sample covers input 1..2, whose
    // mean is 150 — the low-pass that keeps the downsample from aliasing.
    const resampled = resamplePcm16(pcm16([0, 0, 300, 300, 300, 300]), 24000, 16000)
    const view = new DataView(resampled.buffer)
    expect(view.getInt16(0, true)).toBe(0)
    expect(view.getInt16(2, true)).toBe(150)
  })

  it('returns nothing for a rate that cannot be divided', () => {
    expect(resamplePcm16(pcm16([1]), 0, 16000).length).toBe(0)
    expect(resamplePcm16(pcm16([]), 24000, 16000).length).toBe(0)
  })
})

describe('framesToWav', () => {
  it('joins the buffered frames and labels the result as 16 kHz audio', async () => {
    const blob = framesToWav([pcm16([0, 10]), pcm16([20, 30])], 24000, 16000)
    expect(blob.type).toBe('audio/wav')
    const view = await bytesOf(blob)
    expect(view.getUint32(24, true)).toBe(16000)
    // Two frames of two samples each at 24 kHz resample to two samples at 16 kHz
    // (floor(4 × 16000 / 24000)).
    expect(view.byteLength).toBe(44 + 2 * 2)
  })
})
