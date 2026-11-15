import { describe, expect, it } from 'vitest'
import app from '../App.tsx?raw'

// The chat workbench is the workspace module's page now. The shell keeps its own
// screen as the fallback, so removing the plugin from the manifest degrades to the
// previous UI instead of a blank route.
describe('the /agent route', () => {
  it('is served by the plugin page with the shell screen as fallback', () => {
    expect(app).toContain('<Route path="/agent" element={<PluginPage fallback={<AgentPage />} />} />')
  })

  it('still imports the shell page it falls back to', () => {
    expect(app).toContain("import { AgentPage } from './pages/AgentPage'")
  })
})
