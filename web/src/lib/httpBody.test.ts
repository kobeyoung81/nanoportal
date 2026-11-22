import { describe, expect, it } from 'vitest'

import { readJsonBody } from './httpBody'

describe('readJsonBody', () => {
  it('resolves on the empty body a 204 carries', async () => {
    await expect(readJsonBody(new Response(null, { status: 204 }))).resolves.toBeUndefined()
  })

  it('parses a body when the server sends one', async () => {
    await expect(readJsonBody(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))).resolves.toEqual({
      status: 'ok',
    })
  })
})
