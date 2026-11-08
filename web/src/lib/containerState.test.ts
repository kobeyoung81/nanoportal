// The admin user detail page offers a row action only when the bus would accept
// it: a container is disposable while it still holds its slot, restartable only
// while running, and reprovisionable only once it is disposed or failed. Getting
// this wrong put "Reprovision" next to a live container, whose click the bus
// answers with a 404. These are the rules the buttons ask about.
import { describe, expect, it } from 'vitest'
import { canDispose, canReprovision, canRestart } from './containerState'

// Every status a container_requests row can hold (nanobus migrations 002 + 029).
const ALL_STATUSES = [
  'pending',
  'creating',
  'running',
  'suspended',
  'disposing',
  'disposed',
  'restarting',
  'failed',
]

describe('canDispose', () => {
  it('offers disposal while the container still occupies its slot', () => {
    for (const status of ['pending', 'creating', 'running', 'suspended']) {
      expect(canDispose(status)).toBe(true)
    }
  })

  it('hides disposal once it is in flight or terminal', () => {
    for (const status of ['disposing', 'disposed', 'restarting', 'failed', '', 'unknown']) {
      expect(canDispose(status)).toBe(false)
    }
  })
})

describe('canRestart', () => {
  it('offers a restart only for a running container', () => {
    expect(canRestart('running')).toBe(true)
    for (const status of [...ALL_STATUSES.filter((s) => s !== 'running'), '', 'unknown']) {
      expect(canRestart(status)).toBe(false)
    }
  })
})

describe('canReprovision', () => {
  it('offers reprovision only for a disposed or failed container', () => {
    expect(canReprovision('disposed')).toBe(true)
    expect(canReprovision('failed')).toBe(true)
    for (const status of ['pending', 'creating', 'running', 'suspended', 'disposing', 'restarting', '', 'unknown']) {
      expect(canReprovision(status)).toBe(false)
    }
  })

  it('matches the bus contract exactly (disposed or failed, nothing else)', () => {
    for (const status of [...ALL_STATUSES, '', 'unknown']) {
      expect(canReprovision(status)).toBe(status === 'disposed' || status === 'failed')
    }
  })
})
