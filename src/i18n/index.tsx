import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { LANGUAGES, type LanguageCode } from './languages'
import en, { type TranslationKey } from './translations/en'
import es from './translations/es'
import fr from './translations/fr'
import pt from './translations/pt'
import de from './translations/de'
import ru from './translations/ru'
import ar from './translations/ar'
import zh from './translations/zh'
import hi from './translations/hi'
import ja from './translations/ja'

const DICTIONARIES: Record<string, Partial<Record<TranslationKey, string>>> = { en, es, fr, pt, de, ru, ar, zh, hi, ja }

const STORAGE_KEY = 'trust.language'

function readStoredLanguage(): LanguageCode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && LANGUAGES.some((l) => l.code === stored)) return stored
  } catch {
    // localStorage unavailable (private mode, etc.) — fall back to English.
  }
  return 'en'
}

interface I18nContextValue {
  language: LanguageCode
  setLanguage: (code: LanguageCode) => void
  t: (key: TranslationKey) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(readStoredLanguage)

  useEffect(() => {
    const def = LANGUAGES.find((l) => l.code === language)
    document.documentElement.lang = language
    document.documentElement.dir = def?.rtl ? 'rtl' : 'ltr'
  }, [language])

  const setLanguage = useCallback((code: LanguageCode) => {
    setLanguageState(code)
    try {
      window.localStorage.setItem(STORAGE_KEY, code)
    } catch {
      // Soft failure — the selection still applies for this session via state.
    }
  }, [])

  // Missing key in the active language silently falls back to English,
  // never to a raw key or a blank string (see each translations/<code>.ts
  // file's own comment) — this is what lets Tier-1 coverage grow one key
  // at a time without ever showing broken text in the meantime.
  const t = useCallback((key: TranslationKey) => DICTIONARIES[language]?.[key] ?? en[key] ?? key, [language])

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
