import { describe, expect, it } from 'vitest'

import {
  DOCX_EXTENSIONS,
  NANOWORK_EXTENSIONS,
  PPTX_EXTENSIONS,
  XLSX_EXTENSIONS,
  canOpenFile,
  classifyFileType,
} from './fileTypes'

// The file viewer picks its renderer from the extension alone, so this mapping
// is the whole dispatch table for "can the portal open this file".
describe('classifyFileType', () => {
  it('routes NanoWork artifacts to the sandboxed HTML viewer', () => {
    for (const ext of NANOWORK_EXTENSIONS) {
      expect(classifyFileType(`report.${ext}`)).toBe('nanowork')
    }
  })

  it('routes ordinary web pages to the rendered viewer, not the textarea', () => {
    expect(classifyFileType('page.html')).toBe('html')
    expect(classifyFileType('page.htm')).toBe('html')
    expect(classifyFileType('INDEX.HTML')).toBe('html')
    // The extension used to sit in the text list; keep it out of there.
    expect(classifyFileType('page.html')).not.toBe('text')
  })

  it('does not steal extensions from the existing viewers', () => {
    expect(classifyFileType('notes.md')).toBe('markdown')
    expect(classifyFileType('notes.markdown')).toBe('markdown')
    expect(classifyFileType('app.log')).toBe('text')
    expect(classifyFileType('config.yaml')).toBe('text')
    expect(classifyFileType('diagram.svg')).toBe('image')
  })

  it('routes pdf and OOXML documents to their own renderers', () => {
    expect(classifyFileType('manual.pdf')).toBe('pdf')
    for (const ext of DOCX_EXTENSIONS) {
      expect(classifyFileType(`memo.${ext}`)).toBe('docx')
    }
    for (const ext of PPTX_EXTENSIONS) {
      expect(classifyFileType(`deck.${ext}`)).toBe('pptx')
    }
    for (const ext of XLSX_EXTENSIONS) {
      expect(classifyFileType(`sheet.${ext}`)).toBe('xlsx')
    }
  })

  it('is case insensitive and works with dotted names', () => {
    expect(classifyFileType('Q4 发布汇报.NPPT')).toBe('nanowork')
    expect(classifyFileType('arch.v2.npro')).toBe('nanowork')
    expect(classifyFileType('ANNUAL-REPORT.PDF')).toBe('pdf')
    expect(classifyFileType('Budget 2026.XLSX')).toBe('xlsx')
  })

  it('returns null for unsupported and extension-less names', () => {
    expect(classifyFileType('archive.zip')).toBeNull()
    expect(classifyFileType('Makefile')).toBeNull()
    expect(classifyFileType('')).toBeNull()
  })

  it('leaves the legacy binary Office formats to the download path', () => {
    // OLE2 compound documents: none of the browser parsers read them, so they
    // must not be advertised as openable.
    for (const name of ['old.doc', 'old.xls', 'old.ppt', 'macro.xlsm', 'binary.xlsb', 'open.ods']) {
      expect(classifyFileType(name)).toBeNull()
    }
  })
})

describe('canOpenFile', () => {
  it('opens NanoWork artifacts (they used to fall back to download)', () => {
    for (const ext of NANOWORK_EXTENSIONS) {
      expect(canOpenFile(`report.${ext}`)).toBe(true)
    }
  })

  it('opens ordinary web pages', () => {
    expect(canOpenFile('page.html')).toBe(true)
    expect(canOpenFile('page.htm')).toBe(true)
  })

  it('opens the binary document formats it has a renderer for', () => {
    expect(canOpenFile('manual.pdf')).toBe(true)
    expect(canOpenFile('memo.docx')).toBe(true)
    expect(canOpenFile('deck.pptx')).toBe(true)
    expect(canOpenFile('sheet.xlsx')).toBe(true)
  })

  it('still refuses unsupported files', () => {
    expect(canOpenFile('archive.zip')).toBe(false)
    expect(canOpenFile('old.doc')).toBe(false)
    expect(canOpenFile('old.xls')).toBe(false)
    expect(canOpenFile('old.ppt')).toBe(false)
  })
})
