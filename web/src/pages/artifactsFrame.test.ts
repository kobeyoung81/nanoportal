import { describe, expect, it } from 'vitest'
import { shouldResetFrame } from './artifactsFrame'

describe('shouldResetFrame', () => {
  it('does not reset when a space is open', () => {
    expect(shouldResetFrame('/artifacts', '?space=s1')).toBe(false)
  })

  it('does not reset when a node inside a space is open', () => {
    expect(shouldResetFrame('/artifacts', '?space=s1&node=n1')).toBe(false)
  })

  it('does not reset when a work is open', () => {
    expect(shouldResetFrame('/artifacts', '?work=w1')).toBe(false)
  })

  it('resets on the bare library route', () => {
    expect(shouldResetFrame('/artifacts', '')).toBe(true)
  })

  it('treats an empty query string as bare', () => {
    expect(shouldResetFrame('/artifacts', '?')).toBe(true)
  })

  it('never resets from another page', () => {
    expect(shouldResetFrame('/agent', '')).toBe(false)
  })
})
