// Tool arguments are shown by pretty-printing JSON and by leaving everything
// else alone: an `edit` call reads far better indented, while a tool whose
// arguments are not JSON must not be reformatted into something it never was.
import { describe, expect, it } from 'vitest'
import { formatToolArgs } from './toolDisplay'

describe('formatToolArgs', () => {
  it('pretty-prints a JSON object', () => {
    expect(formatToolArgs('{"a":1,"b":[2,3]}')).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}')
  })

  it('pretty-prints a JSON array', () => {
    expect(formatToolArgs('[1,2]')).toBe('[\n  1,\n  2\n]')
  })

  it('leaves text that is not JSON untouched', () => {
    expect(formatToolArgs('ls -la | head')).toBe('ls -la | head')
    expect(formatToolArgs('{"unterminated":')).toBe('{"unterminated":')
  })

  it('leaves a JSON scalar and an empty string untouched', () => {
    expect(formatToolArgs('42')).toBe('42')
    expect(formatToolArgs('')).toBe('')
  })
})
