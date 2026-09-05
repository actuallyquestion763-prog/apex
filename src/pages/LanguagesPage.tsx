import { Check, Globe2 } from 'lucide-react'
import { LANGUAGES } from '../i18n/languages'
import { useI18n } from '../i18n'

export function LanguagesPage() {
  const { language, setLanguage, t } = useI18n()

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ocean-500/15 text-ocean-400">
            <Globe2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">{t('languages.title')}</h1>
            <p className="text-sm text-slate-400">{t('languages.subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            onClick={() => setLanguage(lang.code)}
            className="flex w-full items-center gap-3 border-b border-ink-700/60 px-5 py-4 text-left text-sm text-slate-300 transition last:border-b-0 hover:bg-ink-800/40 hover:text-white"
          >
            <div className="flex-1">
              <p className="font-medium text-white">{lang.nativeLabel}</p>
              <p className="text-xs text-slate-500">{lang.label}</p>
            </div>
            {lang.code === language && <Check className="h-4 w-4 shrink-0 text-bull" />}
          </button>
        ))}
      </div>

      <p className="text-xs text-slate-500">{t('languages.footnote')}</p>
    </div>
  )
}

export default LanguagesPage
