import { describe, expect, it } from 'vitest'

import { MAX_PREVIEW_BYTES, SHEET_ROW_LIMIT, previewTooLarge, sheetWindow } from './binaryPreview'

describe('previewTooLarge', () => {
  it('refuses binary documents past the limit', () => {
    for (const kind of ['pdf', 'docx', 'pptx', 'xlsx'] as const) {
      expect(previewTooLarge(kind, MAX_PREVIEW_BYTES + 1)).toBe(true)
    }
  })

  it('accepts binary documents at or below the limit', () => {
    for (const kind of ['pdf', 'docx', 'pptx', 'xlsx'] as const) {
      expect(previewTooLarge(kind, MAX_PREVIEW_BYTES)).toBe(false)
      expect(previewTooLarge(kind, 1024)).toBe(false)
    }
  })

  it('applies to images (they are downloaded whole too)', () => {
    expect(previewTooLarge('image', MAX_PREVIEW_BYTES + 1)).toBe(true)
    expect(previewTooLarge('image', 2048)).toBe(false)
  })

  it('never refuses the text kinds, whose viewer has always read them whole', () => {
    for (const kind of ['text', 'markdown', 'html', 'nanowork'] as const) {
      expect(previewTooLarge(kind, 500 << 20)).toBe(false)
    }
  })

  it('does not refuse on a missing or nonsensical size', () => {
    expect(previewTooLarge('pdf', undefined)).toBe(false)
    expect(previewTooLarge('pdf', 0)).toBe(false)
    expect(previewTooLarge('pdf', Number.NaN)).toBe(false)
    expect(previewTooLarge(null, MAX_PREVIEW_BYTES * 10)).toBe(false)
  })
})

describe('sheetWindow', () => {
  it('keeps a short sheet as-is', () => {
    const rows = [[1], [2], [3]]
    expect(sheetWindow(rows)).toEqual({ rows, truncated: false })
  })

  it('trims a long sheet and says so', () => {
    const rows = Array.from({ length: SHEET_ROW_LIMIT + 4 }, (_, index) => [index])
    const window = sheetWindow(rows)
    expect(window.rows).toHaveLength(SHEET_ROW_LIMIT)
    expect(window.truncated).toBe(true)
    expect(window.rows[0]).toEqual([0])
  })

  it('honours an explicit smaller limit', () => {
    const window = sheetWindow(['a', 'b', 'c'], 2)
    expect(window.rows).toEqual(['a', 'b'])
    expect(window.truncated).toBe(true)
  })
})
