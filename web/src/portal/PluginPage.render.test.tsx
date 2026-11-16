// @vitest-environment jsdom
//
// The render-level regression for the two update loops that reached the browser
// as `Minified React error #185`. Source-level assertions could not catch either
// of them: both are properties of a real render pass —
//
//   1. a component created during render (a new type each time, so React remounts
//      the subtree, and Radix's mount-time setState drives the loop);
//   2. a context setter whose identity changes with the value it sets, which makes
//      every page's "publish my name" effect re-run on every render.
//
// This test renders the real PluginPage, the real breadcrumb provider and the real
// theme provider, mocks only the plugin registry (the remote loader needs a
// browser), and asserts that rendering settles: a loop shows up as an exploding
// render count today and as React's #185 tomorrow.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginPage } from './PluginPage'
import { CrumbLabelProvider } from '../components/breadcrumbs'
import { ThemeProvider } from '../lib/theme'
import { pageStats } from './testFixtures/fakePage'

// A panel another plugin contributes. The chat workbench (the workspace's page)
// renders these from its context, so the shell has to hand them over — the panel
// itself is never imported by the page.
const contributedPanel = {
  id: 'other.panel',
  title: 'Panel',
  icon: ({ className }: { className?: string }) => <span className={className} />,
  defaultSlot: 'right' as const,
  Component: () => <div data-testid="remote-panel" />,
}

// The page's own manifest also declares panels (the workspace's git panel); the
// shell must not hand those back — see the test below.
const ownPanel = { ...contributedPanel, id: 'fake.panel' }

vi.mock('./registry', async () => {
  const { FakePage } = await import('./testFixtures/fakePage')
  return {
    usePluginPages: () => ({
      pages: [{ id: 'fake', path: '/fake/:id', title: 'Fake', Component: FakePage }],
      loading: false,
      error: null,
    }),
    useRemotePanels: () => ({ panels: [contributedPanel, ownPanel], errors: [] }),
  }
})

let container: HTMLDivElement
let root: Root

beforeAll(() => {
  // React only wraps updates in act() when the environment says so.
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // jsdom has no matchMedia; the theme provider reads it once on mount.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
})

beforeEach(() => {
  pageStats.reset()
  localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderAt(path: string) {
  const fallback = <div data-testid="fallback">fallback</div>
  act(() => {
    root.render(
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <CrumbLabelProvider>
            <Routes>
              {/* The shell declares the pattern, so the page reads the parameters
                  from the route it was mounted on — not from a wildcard match. */}
              <Route path="/fake/:id" element={<PluginPage fallback={fallback} />} />
              <Route path="*" element={<PluginPage fallback={fallback} />} />
            </Routes>
          </CrumbLabelProvider>
        </MemoryRouter>
      </ThemeProvider>,
    )
  })
}

describe('PluginPage rendering', () => {
  it('mounts the plugin page with the route parameters', () => {
    renderAt('/fake/42')

    expect(container.querySelector('[data-testid="fake-page"]')?.textContent).toBe('42')
    expect(container.querySelector('[data-testid="fallback"]')).toBeNull()
    expect(pageStats.contexts.at(-1)?.params).toEqual({ id: '42' })
  })

  it('settles instead of looping when the page publishes its breadcrumb', async () => {
    renderAt('/fake/42')
    // Let the crumb effect, the provider update and the resulting re-render land.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    // One mount, at most a re-render or two from the crumb landing: a loop would
    // be in the hundreds here (or throw #185 outright).
    expect(pageStats.renders).toBeLessThanOrEqual(3)
  })

  it('hands the page a stable setCrumb across renders', async () => {
    renderAt('/fake/42')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(pageStats.crumbSetters.size).toBe(1)
  })

  it('hands the page the panels other plugins contribute', () => {
    // The workbench moved into the workspace plugin; without this list its
    // activity bar would silently lose every remote panel (the library and the
    // document panels disappeared exactly that way).
    renderAt('/fake/42')

    expect(pageStats.contexts.at(-1)?.remotePanels.map((panel) => panel.id)).toEqual(['other.panel'])
  })

  it('does not hand a page the panels of its own plugin', () => {
    // The shell resolves every manifest; the page already is one of those plugins,
    // and its workbench renders its own panels. Handing the manifest copy back made
    // the panel mount without the page — the recursion that crashed /agent.
    renderAt('/fake/42')
    const ids = pageStats.contexts.at(-1)?.remotePanels.map((panel) => panel.id) ?? []
    expect(ids).not.toContain('fake.panel')
  })

  it('falls back to the shell page when no plugin claims the path', () => {
    renderAt('/somewhere/else')

    expect(container.querySelector('[data-testid="fake-page"]')).toBeNull()
    expect(container.querySelector('[data-testid="fallback"]')?.textContent).toBe('fallback')
  })
})
