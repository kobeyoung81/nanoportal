import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'

export const LANG_KEY = 'nanoportal.lang'

export type Lang = 'en' | 'zh-CN'

export const LANGS: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '中文' },
]

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY)
    if (stored === 'en' || stored === 'zh-CN') {
      return stored
    }
  } catch {
    // ignore
  }
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh')) {
    return 'zh-CN'
  }
  return 'en'
}

const initial = initialLang()

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    'zh-CN': { translation: zhCN },
  },
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

document.documentElement.lang = initial

export function changeLang(lang: Lang): void {
  void i18n.changeLanguage(lang)
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {
    // ignore
  }
  document.documentElement.lang = lang
}

export default i18n
