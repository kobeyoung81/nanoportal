// The option list behind the composer's model picker. The cases here are the
// ones the old list got wrong: "Basic" appearing twice (the follow-default entry
// borrowed the model's name), and an override pointing at a model the mode no
// longer allows leaving the trigger without a label.
import { describe, expect, it } from 'vitest'
import {
  FOLLOW_DEFAULT_VALUE,
  defaultBindingOf,
  modelSelectLabel,
  modelSelectOptions,
} from './modelOptions'
import type { TypeModelBinding } from './agentTypes'

const binding = (modelID: number, opts: { isDefault?: boolean; locked?: boolean } = {}): TypeModelBinding => ({
  model_id: modelID,
  is_default: opts.isDefault ?? false,
  locked: opts.locked ?? false,
})

const names = { 1: 'Free', 2: 'Basic', 3: 'Pro' }

// The component passes the real i18n wording; the shape is what matters here.
const labels = { followDefault: (name: string) => `follow default (${name})`, fallback: 'default model' }

describe('modelSelectOptions', () => {
  it('lists the follow-default entry first, then each allowed model once', () => {
    const options = modelSelectOptions([binding(1), binding(2, { isDefault: true }), binding(3)], names, undefined, labels)

    expect(options.map((o) => o.value)).toEqual([FOLLOW_DEFAULT_VALUE, '1', '2', '3'])
    expect(options.map((o) => o.modelName)).toEqual(['Basic', 'Free', 'Basic', 'Pro'])
    expect(options[0].followDefault).toBe(true)
    expect(options.slice(1).every((o) => !o.followDefault)).toBe(true)

    // The one thing the old list got wrong: the entry that means "no override"
    // must not render as the model's name.
    expect(options[0].label).toBe('follow default (Basic)')
    expect(options.map((o) => o.label)).toEqual(['follow default (Basic)', 'Free', 'Basic', 'Pro'])
    expect(options.filter((o) => o.label === 'Basic')).toHaveLength(1)
  })

  it('keeps only the first entry of a model the API listed twice', () => {
    const options = modelSelectOptions([binding(2, { isDefault: true }), binding(2), binding(3)], names)

    expect(options.filter((o) => o.value === '2')).toHaveLength(1)
    expect(options.map((o) => o.value)).toEqual([FOLLOW_DEFAULT_VALUE, '2', '3'])
  })

  it('leaves the follow-default name empty when the type names no default', () => {
    const options = modelSelectOptions([binding(1)], names, undefined, labels)

    expect(options[0].modelName).toBe('')
    expect(options[0].label).toBe('default model')
    expect(defaultBindingOf([binding(1)])).toBeUndefined()
  })

  it('falls back to the model id when the catalog has no name', () => {
    const options = modelSelectOptions([binding(9)], names)

    expect(options[1].modelName).toBe('#9')
  })

  it('lists an override the mode no longer allows, so the trigger has a label', () => {
    const options = modelSelectOptions([binding(1)], names, 42)

    expect(options.map((o) => o.value)).toEqual([FOLLOW_DEFAULT_VALUE, '1', '42'])
    expect(options[2]).toMatchObject({ modelName: '#42', disabled: true })
    // A stored model that is still allowed is not duplicated.
    const allowed = modelSelectOptions([binding(1), binding(3)], names, 3)
    expect(allowed.filter((o) => o.value === '3')).toHaveLength(1)
  })

  it('disables a locked model and keeps it listed', () => {
    const options = modelSelectOptions([binding(3, { locked: true })], names)

    expect(options[1]).toMatchObject({ value: '3', modelName: 'Pro', disabled: true })
  })
})

describe('modelSelectLabel', () => {
  const options = modelSelectOptions([binding(1), binding(2, { isDefault: true }), binding(3)], names, undefined, labels)

  it('labels an unset override with the default it follows', () => {
    expect(modelSelectLabel(undefined, options, labels)).toEqual({ label: 'follow default (Basic)', followDefault: true })
  })

  it('labels a set override with its model name', () => {
    expect(modelSelectLabel(3, options)).toEqual({ label: 'Pro', followDefault: false })
  })

  it('still labels an override the mode no longer allows', () => {
    expect(modelSelectLabel(42, options)).toEqual({ label: '#42', followDefault: false })
  })
})
