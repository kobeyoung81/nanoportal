// isLaidOut is the question both the shortcut listener and the auto-growing
// inputs ask before they trust anything the DOM tells them: hidden panels stay
// mounted inside a display:none vault, where every measurement is degenerate.
import { describe, expect, it } from 'vitest'
import { isLaidOut } from './domLayout'

describe('isLaidOut', () => {
  const laidOut = { offsetParent: {}, getClientRects: () => ({ length: 1 }) }
  const inHiddenParent = { offsetParent: null, getClientRects: () => ({ length: 1 }) }
  const notRendered = { offsetParent: null, getClientRects: () => ({ length: 0 }) }

  it('accepts an element the browser has laid out', () => {
    expect(isLaidOut(laidOut)).toBe(true)
    expect(isLaidOut(inHiddenParent)).toBe(true)
  })

  it('rejects an element without a box, or without an element', () => {
    // The workbench keeps hidden panels mounted in a display:none vault; their
    // offsetParent is null, which is what this rules out.
    expect(isLaidOut(notRendered)).toBe(false)
    expect(isLaidOut(null)).toBe(false)
    expect(isLaidOut(undefined)).toBe(false)
  })
})
