import { describe, expect, it } from 'vitest'
import workbench from '../workbench/Workbench.tsx?raw'
import agentPage from '../pages/AgentPage.tsx?raw'
import registry from './registry.tsx?raw'
import app from '../App.tsx?raw'

// Source-level wiring. The panel contract is spread over three files that no
// single unit test can see at once: the workbench decides whether to pass the
// context, the agent page merges the registry into the plugin list, and the
// registry builds a remote panel. A refactor that drops one of those links
// compiles and renders — it just leaves every remote panel blank.

describe('panel context wiring', () => {
  it('passes the context only to panels that asked for it', () => {
    expect(workbench).toContain('p.ctxAware')
    expect(workbench).toContain('<p.Component')
    expect(workbench).toContain('ctx={')
  })

  it('routes openPanel through the workbench implementation', () => {
    // Panels mount before the workbench's callbacks exist and must not capture
    // the first render's closure.
    expect(workbench).toContain('openPanelRef.current?.(panelId)')
    expect(workbench).toContain('openPanelRef.current = openPanel')
  })

  it('prefers a literal title over an i18n key', () => {
    expect(workbench).toContain('p.title ?? (p.titleKey ? t(p.titleKey) : p.id)')
  })

  it('builds the panel list from the registry, not a hardcoded array', () => {
    expect(agentPage).toContain('usePlugins(PANEL_MODULES)')
    expect(agentPage).toContain('panelContext={panelContext}')
    expect(agentPage).not.toContain('PANEL_PLUGINS')
  })

  it('builds a remote panel through the adapter that guarantees a context', () => {
    expect(registry).toContain('ctxAdapter(')
    expect(registry).toContain('makeRemotePanel(')
  })
})

describe('page wiring', () => {
  it('mounts a plugin page through the shell, with its own page as the fallback', () => {
    // The route has to stay declarative: the shell keeps its built-in page for
    // the case where no plugin claims the path (or one is removed later).
    expect(app).toContain('PluginPage fallback={<ArtifactsPage />}')
    expect(app).toContain('fallback={<ArtifactsPage />}')
  })

  it('resolves pages from the same manifests as panels', () => {
    expect(registry).toContain('export function usePluginPages')
    expect(registry).toContain('makeRemotePage(')
  })
})
