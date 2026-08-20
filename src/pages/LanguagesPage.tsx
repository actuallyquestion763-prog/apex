import { Check } from 'lucide-react'

// Structured for future growth (Part 7) — adding a language is adding one
// entry here, not retyping strings across every page. No translation
// system exists yet in the app, so only English is offered; this list is
// deliberately not padded with unsupported languages marked "coming soon"
// to avoid implying translation work that hasn't happened.
const LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
] as const

export function LanguagesPage() {
  const active = 'en'

  return (
    <div className="space-y-6">
      <div className="card overflow-hidden">
        {LANGUAGES.map((lang) => (
          <div key={lang.code} className="flex items-center gap-3 border-b border-ink-700/60 px-5 py-4 text-sm text-slate-300 last:border-b-0">
            <div className="flex-1">
              <p className="font-medium text-white">{lang.nativeLabel}</p>
              <p className="text-xs text-slate-500">{lang.label}</p>
            </div>
            {lang.code === active && <Check className="h-4 w-4 text-bull" />}
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500">TRUST is currently available in English only. More languages will appear here as they become available.</p>
    </div>
  )
}
