import { describe, expect, it } from 'vitest'
import { voiceStageUi, wantsBatch, wantsPolish, type StageOptions } from './stageUi'

function options(overrides: Partial<StageOptions> = {}): StageOptions {
  return { batchEnabled: false, batchTrigger: 'always', polishEnabled: false, ...overrides }
}

describe('voiceStageUi', () => {
  it('marks nothing while the user is still talking', () => {
    for (const phase of ['connecting', 'recording', 'reconnecting'] as const) {
      const ui = voiceStageUi(phase, options({ batchEnabled: true, polishEnabled: true }))
      expect(ui, phase).toEqual({ underlined: true, mark: null, cancelable: true })
    }
  })

  it('drops the underline and the cancel affordance when idle', () => {
    expect(voiceStageUi('idle', options())).toEqual({ underlined: false, mark: null, cancelable: false })
  })

  it('shows the batch marker once the take ends, when the pass always runs', () => {
    const ui = voiceStageUi('finalizing', options({ batchEnabled: true, batchTrigger: 'always' }))
    expect(ui).toEqual({ underlined: true, mark: 'batch', cancelable: true })
  })

  it('shows the polish brush instead when there is no batch tier', () => {
    const ui = voiceStageUi('finalizing', options({ polishEnabled: true }))
    expect(ui.mark).toBe('polish')
  })

  it('does not promise a batch pass that will not run', () => {
    for (const trigger of ['manual', 'empty'] as const) {
      const ui = voiceStageUi('finalizing', options({ batchEnabled: true, batchTrigger: trigger }))
      expect(ui.mark, trigger).toBe(null)
    }
  })

  it('keeps the text underlined while the batch pass runs', () => {
    const ui = voiceStageUi('refining', options({ batchEnabled: true }))
    expect(ui).toEqual({ underlined: true, mark: 'batch', cancelable: true })
  })

  it('offers the ✕ in every phase of a take', () => {
    // A dictation must always be abortable, which is what the recording strip's
    // ✕ and Esc both do.
    for (const phase of ['connecting', 'recording', 'reconnecting', 'finalizing', 'refining', 'polishing'] as const) {
      expect(voiceStageUi(phase, options({ batchEnabled: true, polishEnabled: true })).cancelable, phase).toBe(true)
    }
  })
})

describe('wantsPolish', () => {
  it('leaves a fragment too short to rewrite alone', () => {
    for (const text of ['', '   ', '好', '好的', '嗯嗯。']) {
      expect(wantsPolish(text), text).toBe(false)
    }
  })

  it('rewrites a transcript that has something to fix', () => {
    expect(wantsPolish('我们走吧')).toBe(true)
    expect(wantsPolish(' 我们走吧 ')).toBe(true)
  })
})

describe('wantsBatch', () => {
  it('always runs when the platform says so', () => {
    expect(wantsBatch('always', '今天天气很好', 10000)).toBe(true)
    expect(wantsBatch('always', '', 200)).toBe(true)
  })

  it('never runs on its own in manual mode', () => {
    expect(wantsBatch('manual', '', 20000)).toBe(false)
    expect(wantsBatch('manual', '今天', 20000)).toBe(false)
  })

  it('rescues an empty transcript', () => {
    expect(wantsBatch('empty', '', 1000)).toBe(true)
    expect(wantsBatch('empty', '   ', 30000)).toBe(true)
  })

  it('leaves a plausible transcript alone', () => {
    // Eight seconds of speech that produced twelve characters is about right.
    expect(wantsBatch('empty', '今天天气很好我们去散步吧', 8000)).toBe(false)
  })

  it('rescues a transcript that is far too short for how long the user spoke', () => {
    expect(wantsBatch('empty', '今天', 20000)).toBe(true)
  })

  it('does not second-guess a very short take', () => {
    // A two-second press is expected to produce a word or two.
    expect(wantsBatch('empty', '今天', 1500)).toBe(false)
  })
})
