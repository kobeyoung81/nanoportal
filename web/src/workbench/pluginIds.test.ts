import { describe, expect, it } from 'vitest'
import { canonicalPanelId } from './pluginIds'

describe('canonicalPanelId', () => {
  it('maps the renamed agent config panel onto its new id', () => {
    // Without this the stored layout keeps a tag no plugin declares and the
    // panel disappears from every browser that already had it open.
    expect(canonicalPanelId('agent-config')).toBe('user-config')
  })

  it('maps the git browser onto the workspace plugin that owns it now', () => {
    expect(canonicalPanelId('git-browser')).toBe('workspace.git')
  })

  it('leaves every other id alone', () => {
    for (const id of ['agents', 'chat', 'files', 'terminal', 'user-config']) {
      expect(canonicalPanelId(id)).toBe(id)
    }
  })
})
