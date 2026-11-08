// The shortcut is stored as a canonical string and has to survive being typed by
// hand into the platform config, recorded from a key press, and matched against
// every key event on the page. The rules that matter are the strict ones: an
// extra modifier is a different gesture, Shift+letter is not a shortcut, and an
// explicit "off" must not quietly fall back to the platform value.
import { describe, expect, it } from 'vitest'
import {
  matchesShortcut,
  normalizeShortcut,
  parseShortcut,
  resolveShortcut,
  shortcutFromEvent,
  shortcutLabel,
  type ShortcutEvent,
} from './shortcut'

/** key('m', { alt: true }) builds the event shape the matcher reads. */
function key(k: string, held: { alt?: boolean; ctrl?: boolean; meta?: boolean; shift?: boolean } = {}): ShortcutEvent {
  return {
    key: k,
    altKey: !!held.alt,
    ctrlKey: !!held.ctrl,
    metaKey: !!held.meta,
    shiftKey: !!held.shift,
  }
}

describe('normalizeShortcut', () => {
  it('canonicalises case, spacing and modifier order', () => {
    expect(normalizeShortcut(' alt + m ')).toBe('Alt+M')
    expect(normalizeShortcut('SHIFT+ctrl+m')).toBe('Ctrl+Shift+M')
    expect(normalizeShortcut('cmd+shift+d')).toBe('Shift+Meta+D')
  })

  it('accepts the names people use for the modifiers', () => {
    expect(normalizeShortcut('control+alt+k')).toBe('Ctrl+Alt+K')
    expect(normalizeShortcut('command+m')).toBe('Meta+M')
    expect(normalizeShortcut('option+m')).toBe('Alt+M')
  })

  it('names the keys a keyboard actually reports', () => {
    expect(normalizeShortcut('alt+space')).toBe('Alt+Space')
    expect(normalizeShortcut('ctrl+f5')).toBe('Ctrl+F5')
    expect(normalizeShortcut('alt+arrowup')).toBe('Alt+ArrowUp')
  })

  it('rejects anything that is not a usable shortcut', () => {
    expect(normalizeShortcut('')).toBe('')
    expect(normalizeShortcut('m')).toBe('')
    expect(normalizeShortcut('shift+m')).toBe('')
    expect(normalizeShortcut('alt')).toBe('')
    expect(normalizeShortcut('alt+alt')).toBe('')
    expect(normalizeShortcut('alt+m+n')).toBe('')
    expect(normalizeShortcut('alt+nonsense')).toBe('')
  })
})

describe('matchesShortcut', () => {
  it('matches the exact gesture, whatever the letter case', () => {
    expect(matchesShortcut('Alt+M', key('m', { alt: true }))).toBe(true)
    expect(matchesShortcut('Alt+M', key('M', { alt: true }))).toBe(true)
    expect(matchesShortcut('Ctrl+Shift+M', key('M', { ctrl: true, shift: true }))).toBe(true)
  })

  it('refuses an extra or missing modifier', () => {
    // The extra Ctrl is the difference between "dictate" and "dictate while
    // Ctrl is held" — they must not be the same gesture.
    expect(matchesShortcut('Alt+M', key('m', { alt: true, ctrl: true }))).toBe(false)
    expect(matchesShortcut('Ctrl+Alt+M', key('m', { alt: true }))).toBe(false)
    expect(matchesShortcut('Alt+M', key('m', { alt: true, shift: true }))).toBe(false)
    expect(matchesShortcut('Alt+M', key('n', { alt: true }))).toBe(false)
    expect(matchesShortcut('Alt+M', key('m'))).toBe(false)
  })

  it('never matches an unusable spec', () => {
    expect(matchesShortcut('', key('m', { alt: true }))).toBe(false)
    expect(matchesShortcut('shift+m', key('M', { shift: true }))).toBe(false)
  })
})

describe('shortcutFromEvent', () => {
  it('builds the canonical string from the gesture', () => {
    expect(shortcutFromEvent(key('m', { alt: true }))).toBe('Alt+M')
    expect(shortcutFromEvent(key('D', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+D')
    expect(shortcutFromEvent(key(' ', { alt: true }))).toBe('Alt+Space')
  })

  it('keeps waiting while only modifiers are held', () => {
    expect(shortcutFromEvent(key('Alt', { alt: true }))).toBeNull()
    expect(shortcutFromEvent(key('Shift', { shift: true }))).toBeNull()
    expect(shortcutFromEvent(key('Control', { ctrl: true }))).toBeNull()
  })

  it('refuses a bare key and a bare Shift', () => {
    expect(shortcutFromEvent(key('m'))).toBeNull()
    expect(shortcutFromEvent(key('M', { shift: true }))).toBeNull()
  })
})

describe('shortcutLabel', () => {
  it('uses the platform symbols', () => {
    expect(shortcutLabel('Ctrl+Shift+M', true)).toBe('⌃+⇧+M')
    expect(shortcutLabel('Ctrl+Shift+M', false)).toBe('Ctrl+Shift+M')
  })

  it('is empty for an unusable spec', () => {
    expect(shortcutLabel('', false)).toBe('')
    expect(shortcutLabel('shift+m', false)).toBe('')
  })
})

describe('resolveShortcut', () => {
  it('falls back to the platform value when this browser has no override', () => {
    expect(resolveShortcut(null, 'Alt+M')).toBe('Alt+M')
    expect(resolveShortcut(undefined, 'Alt+M')).toBe('Alt+M')
  })

  it('lets an override win', () => {
    expect(resolveShortcut('Ctrl+Shift+M', 'Alt+M')).toBe('Ctrl+Shift+M')
  })

  it('treats an explicit empty override as "no shortcut", not as "use the platform one"', () => {
    // This is the whole reason the override is tri-state: turning the shortcut
    // off must not be undone by the platform default.
    expect(resolveShortcut('', 'Alt+M')).toBe('')
  })
})

describe('parseShortcut', () => {
  it('returns the parts it read', () => {
    expect(parseShortcut('ctrl+shift+m')).toEqual({ modifiers: ['Ctrl', 'Shift'], key: 'M' })
  })

  it('returns null for a string it cannot use', () => {
    expect(parseShortcut('m')).toBeNull()
    expect(parseShortcut('alt+m+n')).toBeNull()
  })
})
