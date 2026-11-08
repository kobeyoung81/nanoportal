// The language picker's data: every tag the bus accepts has a label, the labels
// are written in their own language, and an unknown tag is shown as written
// instead of disappearing.
import { describe, expect, it } from 'vitest'
import { LANGUAGES, languageLabel } from './languageOptions'

describe('languageLabel', () => {
  it('labels every offered language in its own script', () => {
    expect(languageLabel('zh')).toBe('简体中文')
    expect(languageLabel('en')).toBe('English')
    expect(languageLabel('ja')).toBe('日本語')
    expect(languageLabel('ko')).toBe('한국어')
  })

  it('shows an unknown tag as written', () => {
    expect(languageLabel('pt-BR')).toBe('pt-BR')
  })

  it('has no duplicate tags', () => {
    const tags = LANGUAGES.map((language) => language.tag)
    expect(new Set(tags).size).toBe(tags.length)
  })
})
