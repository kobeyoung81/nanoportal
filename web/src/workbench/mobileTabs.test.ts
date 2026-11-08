// The mobile workbench's seeded panel set. A phone shows one panel at a time, so
// this set is the only navigation there is: it has to be the three panels a
// session needs, in a fixed order, and the conversation has to be the one on
// screen.
import { describe, expect, it } from 'vitest'
import {
  defaultMobileActive,
  defaultMobileTabs,
  MOBILE_DEFAULT_ACTIVE,
  MOBILE_DEFAULT_TABS,
} from './mobileTabs'

// The workbench manifest, in the order it declares its plugins.
const MANIFEST = ['agents', 'chat', 'files', 'terminal', 'git-browser', 'user-config']

describe('defaultMobileTabs', () => {
  it('opens the agent list, the conversation and the files, in that order', () => {
    expect(defaultMobileTabs(MANIFEST)).toEqual(['agents', 'chat', 'files'])
  })

  it('keeps the order when one of the defaults does not ship', () => {
    expect(defaultMobileTabs(['agents', 'chat', 'terminal'])).toEqual(['agents', 'chat'])
  })

  it('falls back to the first panel when none of the defaults ship', () => {
    expect(defaultMobileTabs(['terminal', 'git-browser'])).toEqual(['terminal'])
  })

  it('has nothing to open for an empty manifest', () => {
    expect(defaultMobileTabs([])).toEqual([])
  })

  it('ships a conversation in its default set', () => {
    // The active default has to be part of the set, or the phone would open with
    // no panel on screen.
    expect([...MOBILE_DEFAULT_TABS]).toContain(MOBILE_DEFAULT_ACTIVE)
  })
})

describe('defaultMobileActive', () => {
  it('shows the conversation first', () => {
    expect(defaultMobileActive(['agents', 'chat', 'files'])).toBe('chat')
  })

  it('falls back to the first tab when the conversation is not in the set', () => {
    expect(defaultMobileActive(['agents', 'files'])).toBe('agents')
  })

  it('has nothing to show for an empty set', () => {
    expect(defaultMobileActive([])).toBeNull()
  })
})
