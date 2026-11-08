import { describe, expect, it } from 'vitest'

import { docxDocumentHtml } from './docxHtml'

describe('docxDocumentHtml', () => {
  it('wraps the rendered body and its stylesheet in one document', () => {
    const html = docxDocumentHtml('<style>.docx{color:red}</style>', '<div class="docx">正文</div>')
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('.docx{color:red}')
    expect(html).toContain('<div class="docx">正文</div>')
  })

  it('forbids script inside the serialized document', () => {
    const html = docxDocumentHtml('', '<div>x</div>')
    expect(html).toContain("script-src 'none'")
  })

  it('puts the substitute font faces inside a style element', () => {
    const rules = '@font-face{font-family:"Calibri";src:local("Calibri")}'
    const html = docxDocumentHtml('', '<div>x</div>', rules)
    // Not "somewhere before <body>": character data in <head> is moved into the
    // body by the HTML parser and painted as text above the document.
    expect(html).toContain(`<style>${rules}</style>`)
  })

  it('leaves no character data loose in the head', () => {
    const html = docxDocumentHtml('<style>.docx{color:red}</style>', '<div>x</div>', '@font-face{font-family:"Calibri"}')
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'))
    const stray = head
      .replace(/<style>[\s\S]*?<\/style>/g, '')
      .replace(/<[^>]*>/g, '')
      .trim()
    expect(stray).toBe('')
  })

  it('adds no empty style element when there are no fonts', () => {
    expect(docxDocumentHtml('', '<div>x</div>')).not.toContain('<style></style>')
  })
})
