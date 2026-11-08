// The grouping API's shape: which endpoint, which method, and that the user id
// is never part of the payload (the portal takes it from the session).

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({
  USER_API_BASE: '/api/user/v1',
  fetchJson: vi.fn(),
  postJson: vi.fn(),
  putJson: vi.fn(),
  deleteJson: vi.fn(),
}))

import { deleteJson, fetchJson, postJson, putJson } from './api'
import {
  arrangeAgents,
  createAgentGroup,
  deleteAgentGroup,
  listAgentGroups,
  renameAgentGroup,
  reorderAgentGroups,
} from './agentGroups'

const mocked = {
  fetchJson: vi.mocked(fetchJson),
  postJson: vi.mocked(postJson),
  putJson: vi.mocked(putJson),
  deleteJson: vi.mocked(deleteJson),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('agent groups API', () => {
  it('lists groups and their agents through the user API', async () => {
    mocked.fetchJson.mockResolvedValue({
      groups: [{ id: 'g1', name: 'Work', position: 0, agents: ['a1'] }],
      ungrouped: ['a2'],
    })
    await expect(listAgentGroups()).resolves.toEqual({
      groups: [{ id: 'g1', name: 'Work', position: 0, agents: ['a1'] }],
      ungrouped: ['a2'],
    })
    expect(mocked.fetchJson).toHaveBeenCalledWith('/agent-groups', '/api/user/v1')
  })

  it('defaults a missing agents array and ungrouped list', async () => {
    mocked.fetchJson.mockResolvedValue({ groups: [{ id: 'g1', name: 'Work', position: 0 }] })
    await expect(listAgentGroups()).resolves.toEqual({
      groups: [{ id: 'g1', name: 'Work', position: 0, agents: [] }],
      ungrouped: [],
    })
  })

  it('creates a group by name only', async () => {
    mocked.postJson.mockResolvedValue({ id: 'g1', name: 'Work', position: 0 })
    await expect(createAgentGroup('Work')).resolves.toEqual({
      id: 'g1', name: 'Work', position: 0, agents: [],
    })
    expect(mocked.postJson).toHaveBeenCalledWith('/agent-groups', { name: 'Work' }, '/api/user/v1')
  })

  it('renames with an encoded id', async () => {
    mocked.putJson.mockResolvedValue({})
    await renameAgentGroup('a/b', 'New')
    expect(mocked.putJson).toHaveBeenCalledWith('/agent-groups/a%2Fb', { name: 'New' }, '/api/user/v1')
  })

  it('deletes and reports how many agents were unassigned', async () => {
    mocked.deleteJson.mockResolvedValue({ unassigned: 3 })
    await expect(deleteAgentGroup('g1')).resolves.toEqual({ unassigned: 3 })
    expect(mocked.deleteJson).toHaveBeenCalledWith('/agent-groups/g1', '/api/user/v1')
  })

  it('defaults a missing unassigned count to zero', async () => {
    mocked.deleteJson.mockResolvedValue({})
    await expect(deleteAgentGroup('g1')).resolves.toEqual({ unassigned: 0 })
  })

  it('reorders the full id list', async () => {
    mocked.postJson.mockResolvedValue({})
    await reorderAgentGroups(['g2', 'g1'])
    expect(mocked.postJson).toHaveBeenCalledWith('/agent-groups/reorder', { ids: ['g2', 'g1'] }, '/api/user/v1')
  })

  it('arranges groups and the ungrouped tail in one request', async () => {
    mocked.postJson.mockResolvedValue({})
    await arrangeAgents([{ id: 'g1', agents: ['a2', 'a1'] }], ['a3'])
    expect(mocked.postJson).toHaveBeenCalledWith(
      '/agent-groups/arrange',
      { groups: [{ id: 'g1', agents: ['a2', 'a1'] }], ungrouped: ['a3'] },
      '/api/user/v1',
    )
  })
})
