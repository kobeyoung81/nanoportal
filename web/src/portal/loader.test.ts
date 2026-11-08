import { beforeEach, describe, expect, it, vi } from 'vitest'

// The loader is thin on purpose, but two behaviours are load-bearing: one load
// per (entry, expose, export) so two panels do not start two network loads, and
// a failed load must be retryable (a cached rejection would brick the panel's
// retry button for the rest of the page's life).

const loadRemote = vi.fn()
const registerRemotes = vi.fn()

vi.mock('@module-federation/runtime', () => ({
  loadRemote: (...args: unknown[]) => loadRemote(...args),
  registerRemotes: (...args: unknown[]) => registerRemotes(...args),
}))

const { loadPanelComponent, resetPanelLoaderCache, splitModule } = await import('./loader')

const spec = {
  entry: '/nanoartifacts/plugins/nanoartifacts/remoteEntry.js',
  module: 'nanoartifacts/panels',
  export: 'LibraryPanel',
}

describe('splitModule', () => {
  it('splits remote and expose', () => {
    expect(splitModule('nanoartifacts/panels')).toEqual({ remote: 'nanoartifacts', expose: 'panels' })
  })

  it('refuses a module without a remote', () => {
    expect(() => splitModule('panels')).toThrow()
    expect(() => splitModule('/panels')).toThrow()
  })
})

describe('loadPanelComponent', () => {
  beforeEach(() => {
    resetPanelLoaderCache()
    loadRemote.mockReset()
    registerRemotes.mockReset()
    loadRemote.mockResolvedValue({ LibraryPanel: () => null })
  })

  it('loads the exposed component once for both panels', async () => {
    const first = await loadPanelComponent(spec)
    const second = await loadPanelComponent({ ...spec, export: 'LibraryPanel' })
    expect(first).toBe(second)
    expect(loadRemote).toHaveBeenCalledTimes(1)
    expect(loadRemote).toHaveBeenCalledWith('nanoartifacts/panels')
    // The remote entry is re-registered before every load so a rebuilt remote is
    // picked up; that is a registration, not a network load.
    expect(registerRemotes).toHaveBeenCalledTimes(1)
  })

  it('keeps a separate entry per export', async () => {
    await loadPanelComponent(spec)
    loadRemote.mockResolvedValue({ DocumentPanel: () => null })
    await loadPanelComponent({ ...spec, export: 'DocumentPanel' })
    expect(loadRemote).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failure', async () => {
    loadRemote.mockRejectedValueOnce(new Error('404'))
    await expect(loadPanelComponent(spec)).rejects.toThrow('404')
    await expect(loadPanelComponent(spec)).resolves.toBeTruthy()
    expect(loadRemote).toHaveBeenCalledTimes(2)
  })

  it('refuses a module that does not export the panel', async () => {
    loadRemote.mockResolvedValue({ SomethingElse: 1 })
    await expect(loadPanelComponent(spec)).rejects.toThrow('does not export "LibraryPanel"')
  })
})
