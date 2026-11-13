import { describe, expect, it } from 'vitest'
import { localizedTitle, panelIDOf, parseRemoteManifest } from './remote'

const valid = {
  contract: 1,
  plugin: 'nanoartifacts',
  entry: '/nanoartifacts/plugins/nanoartifacts/remoteEntry.js',
  panels: [
    {
      id: 'library',
      title: { 'zh-CN': '作品库', en: 'Library' },
      icon: 'layers',
      slot: 'right',
      mount: { kind: 'module', module: 'nanoartifacts/panels', export: 'LibraryPanel' },
    },
    {
      id: 'document',
      title: { 'zh-CN': '文档', en: 'Document' },
      icon: 'file-text',
      slot: 'center',
      mount: { kind: 'module', module: 'nanoartifacts/panels', export: 'DocumentPanel' },
    },
  ],
}

describe('parseRemoteManifest', () => {
  it('accepts a well-formed manifest and names its panels', () => {
    const parsed = parseRemoteManifest(valid, 'nanoartifacts')
    if (!parsed.ok) {
      throw new Error(parsed.error)
    }
    expect(parsed.value.entry).toBe('/nanoartifacts/plugins/nanoartifacts/remoteEntry.js')
    expect(parsed.value.panels.map((panel) => panel.id)).toEqual(['library', 'document'])
    expect(parsed.value.panels[1].slot).toBe('center')
  })

  it('refuses a contract the shell does not speak, naming both versions', () => {
    // V-3: the shell must refuse rather than half-load, and the message has to
    // say who asked for what — a bare "invalid manifest" costs an afternoon.
    const parsed = parseRemoteManifest({ ...valid, contract: 2 }, 'nanoartifacts')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error).toContain('contract 2')
      expect(parsed.error).toContain('speaks 1')
    }
  })

  it('refuses a duplicate panel id', () => {
    const parsed = parseRemoteManifest(
      { ...valid, panels: [valid.panels[0], { ...valid.panels[1], id: 'library' }] },
      'nanoartifacts',
    )
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error).toContain('duplicate panel id library')
    }
  })

  it('refuses a manifest registered under a different plugin id', () => {
    const parsed = parseRemoteManifest(valid, 'other')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error).toContain('names plugin nanoartifacts')
    }
  })

  it('refuses an entry that is not a same-origin path', () => {
    const parsed = parseRemoteManifest({ ...valid, entry: 'https://example.com/remoteEntry.js' }, 'nanoartifacts')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error).toContain('same-origin path')
    }
  })

  it('refuses an unknown icon', () => {
    const parsed = parseRemoteManifest(
      { ...valid, panels: [{ ...valid.panels[0], icon: 'sparkles' }] },
      'nanoartifacts',
    )
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error).toContain('icon must be one of')
    }
  })

  it('refuses an unknown dock', () => {
    const parsed = parseRemoteManifest(
      { ...valid, panels: [{ ...valid.panels[0], slot: 'sidebar' }] },
      'nanoartifacts',
    )
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error).toContain('slot must be one of')
    }
  })

  it('refuses a module mount without a remote prefix', () => {
    const parsed = parseRemoteManifest(
      { ...valid, panels: [{ ...valid.panels[0], mount: { kind: 'module', module: 'panels', export: 'X' } }] },
      'nanoartifacts',
    )
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error).toContain('<remote>/<expose>')
    }
  })

  it('accepts a frame mount only for a same-origin url', () => {
    const ok = parseRemoteManifest(
      { ...valid, panels: [{ ...valid.panels[0], mount: { kind: 'frame', url: '/legacy/app' } }] },
      'nanoartifacts',
    )
    expect(ok.ok).toBe(true)
    const bad = parseRemoteManifest(
      { ...valid, panels: [{ ...valid.panels[0], mount: { kind: 'frame', url: 'https://x.example/app' } }] },
      'nanoartifacts',
    )
    expect(bad.ok).toBe(false)
  })

  it('refuses an empty panel list', () => {
    expect(parseRemoteManifest({ ...valid, panels: [] }, 'nanoartifacts').ok).toBe(false)
  })
})

describe('localizedTitle', () => {
  it('matches by language prefix', () => {
    expect(localizedTitle({ 'zh-CN': '作品库', en: 'Library' }, 'zh-CN')).toBe('作品库')
    expect(localizedTitle({ 'zh-CN': '作品库', en: 'Library' }, 'zh-TW')).toBe('作品库')
    expect(localizedTitle({ 'zh-CN': '作品库', en: 'Library' }, 'en-US')).toBe('Library')
  })

  it('falls back to the first string rather than an empty tab', () => {
    expect(localizedTitle({ de: 'Bibliothek' }, 'en')).toBe('Bibliothek')
  })
})

describe('panelIDOf', () => {
  it('namespaces a panel under its plugin', () => {
    expect(panelIDOf('nanoartifacts', 'library')).toBe('nanoartifacts.library')
  })
})

describe('pages', () => {
  const withPages = {
    ...valid,
    pages: [
      {
        id: 'library',
        path: '/artifacts',
        title: { 'zh-CN': '作品库', en: 'Library' },
        mount: { kind: 'module', module: 'nanoartifacts/page', export: 'LibraryPage' },
      },
    ],
  }

  it('reads a page contribution', () => {
    const parsed = parseRemoteManifest(withPages, 'nanoartifacts')
    if (!parsed.ok) {
      throw new Error(parsed.error)
    }
    expect(parsed.value.pages?.map((page) => page.path)).toEqual(['/artifacts'])
    expect(parsed.value.pages?.[0].mount).toEqual({
      kind: 'module',
      module: 'nanoartifacts/page',
      export: 'LibraryPage',
    })
  })

  it('accepts a manifest without pages', () => {
    const parsed = parseRemoteManifest(valid, 'nanoartifacts')
    if (!parsed.ok) {
      throw new Error(parsed.error)
    }
    expect(parsed.value.pages ?? []).toEqual([])
  })

  it('refuses a relative route: the shell mounts pages by absolute path', () => {
    const parsed = parseRemoteManifest(
      { ...withPages, pages: [{ ...withPages.pages[0], path: 'artifacts' }] },
      'nanoartifacts',
    )
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error).toContain('absolute route')
    }
  })

  it('refuses two pages on the same route', () => {
    const page = withPages.pages[0]
    const parsed = parseRemoteManifest({ ...withPages, pages: [page, { ...page, id: 'other' }] }, 'nanoartifacts')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error).toContain('duplicate page path')
    }
  })
})
