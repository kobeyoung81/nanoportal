import { describe, expect, it } from 'vitest'
import pluginPage from './PluginPage.tsx?raw'
import app from '../App.tsx?raw'

// `/agent` is served by the workspace plugin alone: the shell keeps no second
// copy of the chat, so this checks the two things that make that safe — the route
// carries no fallback, and a route with neither a page nor a fallback reports
// itself instead of rendering nothing.
describe('plugin-only routes', () => {
  it('serves /agent without a shell fallback', () => {
    expect(app).toContain('<Route path="/agent" element={<PluginPage />} />')
    expect(app).not.toContain('<AgentPage />')
  })

  it('waits for the manifests before declaring a page missing', () => {
    expect(pluginPage).toContain('const { pages, loading } = usePluginPages()')
    expect(pluginPage).toContain('if (loading)')
  })

  it('renders an explicit unavailable state when there is no fallback', () => {
    expect(pluginPage).toContain('data-plugin-unavailable="1"')
    expect(pluginPage).toContain('pluginUnavailable.title')
    expect(pluginPage).toContain('pluginUnavailable.reload')
  })
})
