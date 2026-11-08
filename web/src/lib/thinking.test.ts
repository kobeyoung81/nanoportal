import { describe, expect, it } from 'vitest'
import {
  THINKING_LEVELS,
  effectiveModelID,
  modelThinkingLevel,
  normalizeThinkingLevel,
  resolveThinking,
} from './thinking'

describe('normalizeThinkingLevel', () => {
  it('accepts every stored spelling of the four levels', () => {
    expect(THINKING_LEVELS.map((l) => normalizeThinkingLevel(l))).toEqual([...THINKING_LEVELS])
  })

  it('treats none as off, the spelling the runtime uses', () => {
    expect(normalizeThinkingLevel('none')).toBe('off')
  })

  it('reports "no choice" for empty and unrecognized values', () => {
    // A typo must not be shown as if it were in effect: it falls back instead.
    for (const raw of [undefined, null, '', 'banana', 'HIGH', 'minimal']) {
      expect(normalizeThinkingLevel(raw)).toBe('')
    }
  })
})

describe('modelThinkingLevel', () => {
  it('is off for a model the catalog switched off, whatever its effort says', () => {
    expect(modelThinkingLevel({ thinking_enabled: false, thinking_effort: 'high' })).toBe('off')
  })

  it('is the model effort, defaulting to medium', () => {
    expect(modelThinkingLevel({ thinking_enabled: true, thinking_effort: 'low' })).toBe('low')
    expect(modelThinkingLevel({ thinking_enabled: true, thinking_effort: '' })).toBe('medium')
    expect(modelThinkingLevel(undefined)).toBe('medium')
  })
})

describe('effectiveModelID', () => {
  const bindings = [
    { model_id: 1, is_default: true, locked: false },
    { model_id: 2, is_default: false, locked: false },
  ]

  it('prefers a locked default over the stored override', () => {
    expect(effectiveModelID([{ model_id: 1, is_default: true, locked: true }, bindings[1]], 2)).toBe(1)
  })

  it('uses the override when the mode still allows it', () => {
    expect(effectiveModelID(bindings, 2)).toBe(2)
  })

  it('falls back to the default when the override is gone, and keeps the override with no bindings', () => {
    expect(effectiveModelID(bindings, 9)).toBe(1)
    expect(effectiveModelID([], 9)).toBe(9)
  })
})

describe('resolveThinking', () => {
  const enabled = { thinking_enabled: true, thinking_effort: 'medium' }
  const disabled = { thinking_enabled: false }

  it('lets the user choice beat everything', () => {
    expect(resolveThinking({ override: 'high', typeDefault: 'low', model: disabled })).toEqual({
      level: 'high',
      source: 'user',
    })
  })

  it('lets the model capability beat the platform default', () => {
    expect(resolveThinking({ override: '', typeDefault: 'high', model: disabled })).toEqual({
      level: 'off',
      source: 'model',
    })
  })

  it('applies the platform default over the model entry', () => {
    expect(resolveThinking({ typeDefault: 'low', model: enabled })).toEqual({ level: 'low', source: 'platform' })
  })

  it('follows the model entry when nothing else is set', () => {
    expect(resolveThinking({ model: enabled })).toEqual({ level: 'medium', source: 'model' })
    expect(resolveThinking({ model: { thinking_enabled: true, thinking_effort: 'high' } })).toEqual({
      level: 'high',
      source: 'model',
    })
  })

  it('ignores an unrecognized stored value instead of showing it', () => {
    expect(resolveThinking({ override: 'banana', typeDefault: 'low', model: enabled })).toEqual({
      level: 'low',
      source: 'platform',
    })
  })
})
