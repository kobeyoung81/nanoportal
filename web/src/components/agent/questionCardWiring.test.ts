// The blocking question card is height-capped so it cannot eat the transcript.
// The cap is a share of the chat column floored at 9rem: a share alone
// collapses on a very short viewport (a phone in landscape), where the card
// would shrink to a strip with the questions unreadable. The questions scroll
// inside the third selector below and the submit button stays outside it.

import { describe, expect, it } from 'vitest'
import pageSource from '../../pages/AgentPage.tsx?raw'

// Built from pieces on purpose: Tailwind scans every source file, tests
// included, and would emit these dead utilities into the bundle if the old
// class names appeared here as whole strings.
const OLD_PHONE_CAP = 'max-h-' + '[40%]'
const OLD_LG_CAP = 'lg:max-h-' + '[50%]'

describe('question card height cap', () => {
  it('caps the card at 32% on a phone and 40% from lg up', () => {
    expect(pageSource).toContain('max-h-[max(9rem,32%)]')
    expect(pageSource).toContain('lg:max-h-[max(9rem,40%)]')
    // The previous caps are gone: 40% on every width, 50% from lg up.
    expect(pageSource).not.toContain(OLD_PHONE_CAP)
    expect(pageSource).not.toContain(OLD_LG_CAP)
  })

  it('keeps the questions scrolling inside the card and the button outside', () => {
    expect(pageSource).toContain('min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1')
    expect(pageSource).toContain('<div className="mt-3 flex shrink-0 justify-end">')
  })
})
