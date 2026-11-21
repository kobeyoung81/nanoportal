import { describe, expect, it } from 'vitest'

import dialogSource from './FileDialog.tsx?raw'
import bodySource from './FilePreviewBody.tsx?raw'
import buttonSource from './PreviewReloadButton.tsx?raw'

// Reload is wired in several places that have to stay in step, and none of them is
// observable without a DOM: the headers and the error boundary that must forget a
// previous failure. These assertions read the sources, the same way
// `FileDialog.test.ts` pins the header order. The standalone viewer moved to the
// workspace module with the /files/view page; its half of the wiring is pinned
// there (`nanoworkspace/ui/src/pages/FileViewerPage.test.ts`).
describe('preview reload', () => {
  it('is wired in the dialog', () => {
    // The label lives in the shared button, so the dialog only mounts it.
    expect(dialogSource).toContain('<PreviewReloadButton')
    expect(dialogSource).toContain('setReloadKey(')
  })

  it('resets the error boundary so a reload can recover from a failed render', () => {
    // `name:target` alone is stable across reloads: the boundary would keep
    // showing the old failure and the button would look dead.
    expect(bodySource).toContain('resetKey={`${name}:${target}:${reloadKey}`}')
  })

  it('spins while loading and keeps a text label on wide screens', () => {
    expect(buttonSource).toContain("loading && 'animate-spin'")
    expect(buttonSource).toContain('hidden sm:inline')
    expect(buttonSource).toContain('disabled={loading}')
  })
})
