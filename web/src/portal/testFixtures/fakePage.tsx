// A page for the render test.
//
// It is deliberately a module-scope component (see the rule in ARCHITECTURE): a
// component created during render is a new type every render, and React remounts
// its subtree — which is how the two update loops started.

import { useEffect } from 'react'
import type { PageContext } from '../contract'

export const pageStats = {
  renders: 0,
  crumbSetters: new Set<(label: string | null, title?: string) => void>(),
  contexts: [] as PageContext[],
  reset() {
    pageStats.renders = 0
    pageStats.crumbSetters.clear()
    pageStats.contexts.length = 0
  },
}

// A render loop blocks the event loop, so a test timeout can never fire; stop it
// here where the failure is legible instead of hanging the run.
const RENDER_LIMIT = 50

export function FakePage({ ctx }: { ctx: PageContext }) {
  pageStats.renders++
  if (pageStats.renders > RENDER_LIMIT) {
    throw new Error(`render loop: the page has rendered ${pageStats.renders} times`)
  }
  pageStats.contexts.push(ctx)
  pageStats.crumbSetters.add(ctx.setCrumb)
  // The pattern every real page uses: publish the resolved name to the shell.
  useEffect(() => {
    ctx.setCrumb('Fake record', 'The fake one')
  }, [ctx.setCrumb])
  return <div data-testid="fake-page">{ctx.params.id}</div>
}
