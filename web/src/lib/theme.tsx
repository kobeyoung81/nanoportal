import { createContext, useCallback, useContext, useEffect, useInsertionEffect, useMemo, useState, type ReactNode } from 'react'

export type Theme = 'dark' | 'light' | 'system'

// 主题被拆成两个正交的轴：结构（几何/密度）与配色（色值）。
// 产品目前只发一套，但运行时按属性读取，加第二套不需要改组件。
export type Structure = 'graphite'
export type Palette = 'slate'

type ThemeContextValue = {
  theme: Theme
  resolvedTheme: 'dark' | 'light'
  structure: Structure
  palette: Palette
  setTheme: (theme: Theme) => void
  setStructure: (structure: Structure) => void
  setPalette: (palette: Palette) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'nanoportal.theme'
const STRUCTURE_KEY = 'nanoportal.structure'
const PALETTE_KEY = 'nanoportal.palette'

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'dark' || stored === 'light' || stored === 'system') {
    return stored
  }
  return 'system'
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)
  // 目前各只有一档；读存储只是为了让第二档加进来时不用改这里。
  const [structure, setStructureState] = useState<Structure>(() =>
    localStorage.getItem(STRUCTURE_KEY) === 'graphite' ? 'graphite' : 'graphite',
  )
  const [palette, setPaletteState] = useState<Palette>(() =>
    localStorage.getItem(PALETTE_KEY) === 'slate' ? 'slate' : 'slate',
  )
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const resolvedTheme: 'dark' | 'light' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    localStorage.setItem(STORAGE_KEY, next)
  }, [])

  const toggle = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }, [resolvedTheme, setTheme])

  const setStructure = useCallback((next: Structure) => {
    setStructureState(next)
    localStorage.setItem(STRUCTURE_KEY, next)
  }, [])

  const setPalette = useCallback((next: Palette) => {
    setPaletteState(next)
    localStorage.setItem(PALETTE_KEY, next)
  }, [])

  const value = useMemo(
    () => ({ theme, resolvedTheme, structure, palette, setTheme, setStructure, setPalette, toggle }),
    [theme, resolvedTheme, structure, palette, setTheme, setStructure, setPalette, toggle],
  )

  // Apply the resolved theme via useInsertionEffect, which fires before any
  // descendant passive effect (e.g. the terminal theme effect) in the same
  // commit — so computed styles always reflect the NEW theme when children
  // read them. UseEffect would be too late (children's effects run first).
  useInsertionEffect(() => {
    const root = document.documentElement
    root.dataset.structure = structure
    root.dataset.palette = palette
    root.classList.toggle('dark', resolvedTheme === 'dark')
    root.style.colorScheme = resolvedTheme
  }, [resolvedTheme, structure, palette])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
