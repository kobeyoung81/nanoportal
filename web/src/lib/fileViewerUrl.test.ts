import { describe, expect, it } from 'vitest'

import { VIEWER_PATH, viewerHref } from './fileViewerUrl'

// The new-tab button hands this string to `window.open`, and the viewer page
// reads it back with useSearchParams. Anything that breaks the escaping breaks
// the round trip, so the awkward paths are the cases worth pinning.
describe('viewerHref', () => {
  it('points at the viewer route with the file it was given', () => {
    const href = viewerHref('agent-1', 'notes.md', 'preview')
    expect(href.startsWith(`${VIEWER_PATH}?`)).toBe(true)
    expect(href).toContain('agent=agent-1')
    expect(href).toContain('path=notes.md')
    expect(href).toContain('mode=preview')
  })

  it('escapes a path with spaces, a hash, an ampersand and CJK characters', () => {
    const path = '发布 计划#1 & 附录.md'
    const href = viewerHref('agent-1', path, 'source')
    // Nothing in the value may leak into the query syntax.
    expect(href).not.toContain('#')
    expect(href.split('?')[1].split('&')).toHaveLength(3)
    // And the page can read it back verbatim.
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1))
    expect(params.get('path')).toBe(path)
    expect(params.get('mode')).toBe('source')
  })

  it('escapes the agent id as well', () => {
    const href = viewerHref('a b/c', 'x.txt', 'preview')
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1))
    expect(params.get('agent')).toBe('a b/c')
  })
})
