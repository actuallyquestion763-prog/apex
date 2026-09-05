export interface LanguageDef {
  code: string
  label: string // English name, shown as the secondary line
  nativeLabel: string // name in the language itself, shown as the primary line
  rtl?: boolean
}

// Ten total (English + nine more) — the most widely spoken languages
// worldwide, matching what a real trading platform would prioritize first.
// Adding an eleventh is: add a row here + a translations/<code>.ts file.
export const LANGUAGES: LanguageDef[] = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'es', label: 'Spanish', nativeLabel: 'Español' },
  { code: 'fr', label: 'French', nativeLabel: 'Français' },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português' },
  { code: 'de', label: 'German', nativeLabel: 'Deutsch' },
  { code: 'ru', label: 'Russian', nativeLabel: 'Русский' },
  { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', rtl: true },
  { code: 'zh', label: 'Chinese (Simplified)', nativeLabel: '简体中文' },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
  { code: 'ja', label: 'Japanese', nativeLabel: '日本語' },
]

export type LanguageCode = (typeof LANGUAGES)[number]['code']
