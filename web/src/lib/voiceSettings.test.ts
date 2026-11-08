import { describe, expect, it } from 'vitest'
import {
  VOICE_KEYS,
  parseVoiceSettings,
  polishThinkingValue,
  settingsValues,
  type VoiceSettings,
} from './voiceSettings'

/** A complete form state, so each test only spells out what it cares about. */
function settings(overrides: Partial<VoiceSettings> = {}): VoiceSettings {
  return {
    enabled: true,
    shortcut: 'Alt+M',
    engine: 'local',
    providerId: '7',
    model: 'bilingual-zh-en',
    language: 'zh',
    prompt: '',
    maxSeconds: '120',
    commitIntervalMs: '0',
    audioRate: '24000',
    hotwords: '',
    batchEnabled: true,
    batchTrigger: 'always',
    batchProviderId: '9',
    batchModel: 'whisper-1',
    batchLanguage: 'zh',
    batchPrompt: '',
    polishEnabled: true,
    polishModelId: '3',
    polishPrompt: '只改标点',
    polishThinking: 'low',
    polishSkipAfterBatch: false,
    ...overrides,
  }
}

describe('parseVoiceSettings', () => {
  it('reads the shape the admin config route answers with', () => {
    const parsed = parseVoiceSettings({
      component_type: 'voice',
      config: {
        enabled: 'true',
        shortcut: 'Ctrl+Shift+M',
        'realtime.engine': 'remote',
        'realtime.providerId': '7',
        'realtime.model': 'gpt-4o-transcribe',
        'batch.enabled': 'true',
        'batch.trigger': 'manual',
        'batch.providerId': '9',
        'batch.model': 'whisper-1',
        'polish.thinking': 'high',
        'polish.skipAfterBatch': 'true',
      },
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.enabled).toBe(true)
    expect(parsed?.shortcut).toBe('Ctrl+Shift+M')
    expect(parsed?.engine).toBe('remote')
    expect(parsed?.providerId).toBe('7')
    expect(parsed?.batchEnabled).toBe(true)
    expect(parsed?.batchTrigger).toBe('manual')
    expect(parsed?.batchProviderId).toBe('9')
    expect(parsed?.batchModel).toBe('whisper-1')
    expect(parsed?.polishThinking).toBe('high')
    expect(parsed?.polishSkipAfterBatch).toBe(true)
  })

  it('reads the shape the bus answers with', () => {
    const parsed = parseVoiceSettings({
      items: [
        { key: VOICE_KEYS.enabled, value: 'true', value_type: 'bool', description: '' },
        { key: VOICE_KEYS.shortcut, value: 'Alt+J', value_type: 'string', description: '' },
        { key: VOICE_KEYS.providerId, value: '7', value_type: 'int', description: '' },
        { key: VOICE_KEYS.batchTrigger, value: 'empty', value_type: 'string', description: '' },
      ],
    })

    expect(parsed?.enabled).toBe(true)
    expect(parsed?.shortcut).toBe('Alt+J')
    expect(parsed?.providerId).toBe('7')
    expect(parsed?.batchTrigger).toBe('empty')
  })

  it('defaults numbers and switches that were never stored', () => {
    const parsed = parseVoiceSettings({ config: { enabled: 'false' } })

    expect(parsed).not.toBeNull()
    expect(parsed?.engine).toBe('local')
    expect(parsed?.shortcut).toBe('Alt+M')
    expect(parsed?.maxSeconds).toBe('120')
    expect(parsed?.commitIntervalMs).toBe('0')
    expect(parsed?.batchEnabled).toBe(false)
    expect(parsed?.batchTrigger).toBe('always')
    expect(parsed?.audioRate).toBe('24000')
    expect(parsed?.polishEnabled).toBe(true)
    expect(parsed?.polishSkipAfterBatch).toBe(false)
  })

  it('reports an unreadable payload instead of inventing defaults', () => {
    // Writing on top of invented defaults is what once blanked this
    // configuration, so "nothing recognisable" must stay distinguishable.
    expect(parseVoiceSettings({ component_type: 'voice', config: { 'agent.model': 'x' } })).toBeNull()
    expect(parseVoiceSettings({ items: [{ key: 'unrelated', value: '1' }] })).toBeNull()
    expect(parseVoiceSettings(null)).toBeNull()
  })

  it('keeps empty values that were stored on purpose', () => {
    const parsed = parseVoiceSettings({ config: { 'realtime.language': '', 'realtime.model': '', shortcut: '' } })

    expect(parsed?.language).toBe('')
    expect(parsed?.model).toBe('')
    // An operator who clears the shortcut means "the platform offers none"; the
    // built-in Alt+M must not come back on the next read.
    expect(parsed?.shortcut).toBe('')
  })

  // TestUnrecognizedEnumsFallBackToThePlatformDefault on the bus side: an
  // unknown trigger reads as "always" there, so the form must not show something
  // the platform will not do.
  it('maps an unknown batch trigger to always', () => {
    expect(parseVoiceSettings({ config: { 'batch.trigger': 'sometimes' } })?.batchTrigger).toBe('always')
  })
})

describe('polishThinkingValue', () => {
  // Off has to be said out loud: the bus only turns a reasoning model off when
  // the request carries reasoning_effort=none, so anything that is not a level
  // reads as "none" — including the empty value an unedited row holds.
  it('reads anything that is not a level as the explicit off', () => {
    expect(polishThinkingValue('')).toBe('none')
    expect(polishThinkingValue('  NONE ')).toBe('none')
    expect(polishThinkingValue('sometimes')).toBe('none')
    expect(polishThinkingValue('high')).toBe('high')
    expect(polishThinkingValue(' Medium ')).toBe('medium')
  })
})

describe('settingsValues', () => {
  it('writes every tier under its own key', () => {
    const values = settingsValues(settings())

    expect(values[VOICE_KEYS.engine]).toBe('local')
    expect(values[VOICE_KEYS.shortcut]).toBe('Alt+M')
    expect(values[VOICE_KEYS.providerId]).toBe('7')
    expect(values[VOICE_KEYS.batchEnabled]).toBe('true')
    expect(values[VOICE_KEYS.batchTrigger]).toBe('always')
    expect(values[VOICE_KEYS.batchModel]).toBe('whisper-1')
    expect(values[VOICE_KEYS.polishSkipAfterBatch]).toBe('false')
    // The old names must be gone: the bus reads realtime.* now, so a save that
    // still wrote asr.* would silently do nothing.
    expect(Object.keys(values).some((key) => key.startsWith('asr.'))).toBe(false)
    expect(Object.keys(values)).toHaveLength(Object.keys(VOICE_KEYS).length)
  })

  it('trims text but not identifiers', () => {
    const values = settingsValues(settings({ model: ' m ', prompt: ' p ', batchModel: ' w ', providerId: ' 7 ' }))

    expect(values[VOICE_KEYS.model]).toBe('m')
    expect(values[VOICE_KEYS.prompt]).toBe('p')
    expect(values[VOICE_KEYS.batchModel]).toBe('w')
    expect(values[VOICE_KEYS.providerId]).toBe(' 7 ')
  })

  it('keeps a hotword list line by line', () => {
    const values = settingsValues(settings({ hotwords: 'nanoportal\nnanobus\n' }))

    expect(values[VOICE_KEYS.hotwords]).toBe('nanoportal\nnanobus')
  })

  it('writes the capture rate for a local model', () => {
    const values = settingsValues(settings({ audioRate: '16000' }))

    expect(values[VOICE_KEYS.audioRate]).toBe('16000')
  })

  it('writes the thinking effort under its own key', () => {
    const values = settingsValues(settings({ polishThinking: 'medium' }))

    expect(values[VOICE_KEYS.polishThinking]).toBe('medium')
  })

  it('upgrades an empty thinking effort to the explicit off on save', () => {
    // A row written before off was expressed explicitly holds "". Saving the
    // form has to turn it into a value the bus can act on.
    const values = settingsValues(settings({ polishThinking: '' }))

    expect(values[VOICE_KEYS.polishThinking]).toBe('none')
  })
})
