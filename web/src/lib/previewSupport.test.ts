import { describe, expect, it } from 'vitest'

import { missingPreviewApis, type SupportEnv } from './previewSupport'

// A modern engine: everything present.
const full: SupportEnv = {
  worker: true,
  resizeObserver: true,
  intersectionObserver: true,
  canvasRoundRect: true,
  structuredClone: true,
  fontFace: true,
}

// Chrome 103 is the floor this portal supports. It has workers, ResizeObserver
// and FontFace, but no roundRect (99+) — and older engines may miss more.
const chrome103: SupportEnv = { ...full, canvasRoundRect: false, structuredClone: false }

describe('missingPreviewApis', () => {
  it('asks nothing of a capable browser', () => {
    for (const kind of ['pdf', 'docx', 'pptx', 'xlsx'] as const) {
      expect(missingPreviewApis(kind, full)).toEqual([])
    }
  })

  it('names what an old engine lacks for pptx', () => {
    expect(missingPreviewApis('pptx', chrome103)).toEqual([
      'CanvasRenderingContext2D.roundRect',
      'structuredClone',
    ])
  })

  it('keeps docx and xlsx free of hard requirements', () => {
    const bare: SupportEnv = {
      worker: false,
      resizeObserver: false,
      intersectionObserver: false,
      canvasRoundRect: false,
      structuredClone: false,
      fontFace: false,
    }
    expect(missingPreviewApis('docx', bare)).toEqual([])
    expect(missingPreviewApis('xlsx', bare)).toEqual([])
    // pdf needs a worker for pdf.js's parser.
    expect(missingPreviewApis('pdf', bare)).toEqual(['Worker'])
  })

  it('reports every missing pptx dependency at once', () => {
    const bare: SupportEnv = {
      worker: false,
      resizeObserver: false,
      intersectionObserver: false,
      canvasRoundRect: false,
      structuredClone: false,
      fontFace: false,
    }
    expect(missingPreviewApis('pptx', bare)).toHaveLength(5)
  })
})
