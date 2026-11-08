// The git browser opens where the user was, or at the agent's home — never at a
// directory that agent does not have. These are the rules behind that choice,
// behind the default favourite for the home, and behind the star state of the
// tree.
import { describe, expect, it, vi } from 'vitest'
import {
  agentHomeLabel,
  resolveGitBrowsingPath,
  shouldAutoStarAgentHome,
  starredPaths,
} from './gitBrowserPath'

const HOME = 'agents/Alice'

describe('resolveGitBrowsingPath', () => {
  it('opens the remembered directory when it is still there', async () => {
    const agentHome = vi.fn(async () => HOME)
    const path = await resolveGitBrowsingPath({
      remembered: 'sharedspace/proj',
      readable: async () => true,
      agentHome,
    })
    expect(path).toBe('sharedspace/proj')
    expect(agentHome).not.toHaveBeenCalled()
  })

  it('falls back to the agent home when the remembered directory is gone', async () => {
    const path = await resolveGitBrowsingPath({
      remembered: 'agents/Bob/old',
      readable: async (candidate) => candidate !== 'agents/Bob/old',
      agentHome: async () => HOME,
    })
    expect(path).toBe(HOME)
  })

  it('keeps the remembered directory when the container cannot be reached', async () => {
    // The directory reads as missing because the agent is restarting: moving the
    // user to the home would silently lose their place, so the path stays.
    const path = await resolveGitBrowsingPath({
      remembered: 'agents/Bob/old',
      readable: async () => false,
      agentHome: async () => null,
    })
    expect(path).toBe('agents/Bob/old')
  })

  it('opens the agent home for an agent that was never browsed', async () => {
    const path = await resolveGitBrowsingPath({
      remembered: null,
      readable: async () => true,
      agentHome: async () => HOME,
    })
    expect(path).toBe(HOME)
  })

  it('opens the data root when the container answers nothing at all', async () => {
    const path = await resolveGitBrowsingPath({
      remembered: null,
      readable: async () => false,
      agentHome: async () => null,
    })
    expect(path).toBe('')
  })

  it('keeps a remembered data root (it is an entry, not an absence)', async () => {
    const agentHome = vi.fn(async () => HOME)
    const path = await resolveGitBrowsingPath({
      remembered: '',
      readable: async () => true,
      agentHome,
    })
    expect(path).toBe('')
    expect(agentHome).not.toHaveBeenCalled()
  })

  it('rejects a remembered path the hypervisor refuses to list', async () => {
    const path = await resolveGitBrowsingPath({
      remembered: '../../etc',
      readable: async () => false,
      agentHome: async () => HOME,
    })
    expect(path).toBe(HOME)
  })
})

describe('shouldAutoStarAgentHome', () => {
  it('stars a home that is not favourited yet', () => {
    expect(shouldAutoStarAgentHome({ home: HOME, shortcuts: [], alreadyHandled: false })).toBe(true)
    expect(
      shouldAutoStarAgentHome({ home: HOME, shortcuts: [{ path: 'sharedspace/proj' }], alreadyHandled: false }),
    ).toBe(true)
  })

  it('never stars an empty home', () => {
    expect(shouldAutoStarAgentHome({ home: '', shortcuts: [], alreadyHandled: false })).toBe(false)
  })

  it('leaves an existing favourite alone', () => {
    expect(
      shouldAutoStarAgentHome({ home: HOME, shortcuts: [{ path: HOME }], alreadyHandled: false }),
    ).toBe(false)
  })

  it('does not add a favourite back after the user unstared it', () => {
    expect(shouldAutoStarAgentHome({ home: HOME, shortcuts: [], alreadyHandled: true })).toBe(false)
  })
})

describe('starredPaths', () => {
  it('keeps only this agent\u2019s favourites', () => {
    const starred = starredPaths('a1', [
      { agent_id: 'a1', path: 'agents/Alice' },
      { agent_id: 'a2', path: 'agents/Bob' },
      { agent_id: 'a1', path: 'sharedspace' },
    ])
    expect([...starred].sort()).toEqual(['agents/Alice', 'sharedspace'])
  })
})

describe('agentHomeLabel', () => {
  it('labels a favourite with the folder name, like manual starring does', () => {
    expect(agentHomeLabel('agents/My Agent')).toBe('My Agent')
    expect(agentHomeLabel('')).toBe('')
  })
})
