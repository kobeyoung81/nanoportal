import { describe, expect, it } from 'vitest'

import { canEditSource, previewTarget, showsSourceToggle } from './fileViewer'

// The dialog body is exactly one renderer. This is that decision, kept out of
// the component so it can be pinned without a DOM.
describe('previewTarget', () => {
  it('renders HTML as a document in preview mode and as source otherwise', () => {
    expect(previewTarget('html', 'preview')).toBe('sandboxed-html')
    expect(previewTarget('html', 'source')).toBe('source')
  })

  it('renders NanoWork artifacts in both modes (they have no source view)', () => {
    expect(previewTarget('nanowork', 'preview')).toBe('sandboxed-html')
    expect(previewTarget('nanowork', 'source')).toBe('sandboxed-html')
  })

  it('renders markdown as a document in preview mode', () => {
    expect(previewTarget('markdown', 'preview')).toBe('markdown')
    expect(previewTarget('markdown', 'source')).toBe('source')
  })

  it('shows plain text as source in both modes', () => {
    expect(previewTarget('text', 'preview')).toBe('source')
    expect(previewTarget('text', 'source')).toBe('source')
  })

  it('sends images to the image renderer', () => {
    expect(previewTarget('image', 'preview')).toBe('image')
    expect(previewTarget('image', 'source')).toBe('image')
  })

  it('sends each binary document to its own renderer', () => {
    expect(previewTarget('pdf', 'preview')).toBe('pdf')
    expect(previewTarget('docx', 'preview')).toBe('docx')
    expect(previewTarget('pptx', 'preview')).toBe('pptx')
    expect(previewTarget('xlsx', 'preview')).toBe('xlsx')
    // Binary formats have no source view; the mode must not change the renderer.
    expect(previewTarget('pdf', 'source')).toBe('pdf')
    expect(previewTarget('docx', 'source')).toBe('docx')
    expect(previewTarget('pptx', 'source')).toBe('pptx')
    expect(previewTarget('xlsx', 'source')).toBe('xlsx')
  })

  it('renders nothing for unknown files', () => {
    expect(previewTarget(null, 'preview')).toBe('none')
    expect(previewTarget(null, 'source')).toBe('none')
  })
})

describe('canEditSource', () => {
  it('is false without upload rights even for editable kinds', () => {
    for (const kind of ['text', 'markdown', 'html'] as const) {
      expect(canEditSource(kind, false)).toBe(false)
    }
  })

  it('follows the same kinds as the text editor', () => {
    expect(canEditSource('text', true)).toBe(true)
    expect(canEditSource('markdown', true)).toBe(true)
    expect(canEditSource('html', true)).toBe(true)
    expect(canEditSource('image', true)).toBe(false)
    expect(canEditSource('nanowork', true)).toBe(false)
    expect(canEditSource('pdf', true)).toBe(false)
    expect(canEditSource('docx', true)).toBe(false)
    expect(canEditSource('pptx', true)).toBe(false)
    expect(canEditSource('xlsx', true)).toBe(false)
    expect(canEditSource(null, true)).toBe(false)
  })
})

describe('showsSourceToggle', () => {
  it('always offers the source of an HTML page, even read-only', () => {
    expect(showsSourceToggle('html', true)).toBe(true)
    expect(showsSourceToggle('html', false)).toBe(true)
  })

  it('keeps the existing "only when editable" rule for text and markdown', () => {
    expect(showsSourceToggle('text', true)).toBe(true)
    expect(showsSourceToggle('markdown', true)).toBe(true)
    expect(showsSourceToggle('text', false)).toBe(false)
    expect(showsSourceToggle('markdown', false)).toBe(false)
  })

  it('offers nothing for images, binary documents, NanoWork artifacts or unknown files', () => {
    for (const kind of ['image', 'nanowork', 'pdf', 'docx', 'pptx', 'xlsx', null] as const) {
      expect(showsSourceToggle(kind, true)).toBe(false)
    }
  })
})
