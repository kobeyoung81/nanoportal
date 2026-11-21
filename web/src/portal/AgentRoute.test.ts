import { describe, expect, it } from 'vitest'
import app from '../App.tsx?raw'

// The chat workbench is the workspace module's page, and it is the only copy:
// keeping a second implementation in the shell meant every fix had to be made
// twice, and the copy had already drifted (it was missing the git panel and the
// connect-in-progress close fix). Without the plugin the route reports itself
// unavailable instead of quietly rendering an old screen.
describe('the /agent route', () => {
  it('is served by the plugin page alone', () => {
    expect(app).toContain('<Route path="/agent" element={<PluginPage />} />')
  })

  it('has no shell chat page to fall back to', () => {
    expect(app).not.toContain("import { AgentPage } from './pages/AgentPage'")
    expect(app).not.toContain('<AgentPage />')
  })

  it('renders the workbench with its own plugin, not a shell-owned copy', () => {
    expect(app).toContain('path="/agent"')
  })
})
