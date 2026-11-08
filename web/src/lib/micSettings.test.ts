import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MIC_SETTINGS,
  MAX_GAIN,
  MIN_GAIN,
  clampGain,
  parseMicSettings,
} from './micSettings'

describe('clampGain', () => {
  it('keeps a usable gain as it is', () => {
    expect(clampGain(1)).toBe(1)
    expect(clampGain(2.5)).toBe(2.5)
  })

  it('holds the ends', () => {
    expect(clampGain(0)).toBe(MIN_GAIN)
    expect(clampGain(100)).toBe(MAX_GAIN)
  })

  // A gain that came back as NaN (a hand-edited value, a broken write) must not
  // travel into the audio graph, where it would silence the microphone.
  it('falls back when the value is not a number', () => {
    expect(clampGain(Number.NaN)).toBe(DEFAULT_MIC_SETTINGS.gain)
    expect(clampGain(Number.POSITIVE_INFINITY)).toBe(MAX_GAIN)
  })
})

describe('parseMicSettings', () => {
  it('reads a complete value', () => {
    const parsed = parseMicSettings({
      gain: 4,
      autoGainControl: false,
      noiseSuppression: false,
      echoCancellation: true,
    })

    expect(parsed).toEqual({
      gain: 4,
      autoGainControl: false,
      noiseSuppression: false,
      echoCancellation: true,
    })
  })

  it('defaults every missing field', () => {
    expect(parseMicSettings({})).toEqual(DEFAULT_MIC_SETTINGS)
    expect(parseMicSettings({ gain: 2 })).toEqual({ ...DEFAULT_MIC_SETTINGS, gain: 2 })
  })

  it('survives values that are not an object at all', () => {
    for (const value of [null, undefined, 3, 'loud', []]) {
      expect(parseMicSettings(value)).toEqual(DEFAULT_MIC_SETTINGS)
    }
  })

  it('clamps a stored gain that is out of range', () => {
    expect(parseMicSettings({ gain: 99 }).gain).toBe(MAX_GAIN)
    expect(parseMicSettings({ gain: -2 }).gain).toBe(MIN_GAIN)
    expect(parseMicSettings({ gain: 'nonsense' }).gain).toBe(1)
  })
})
