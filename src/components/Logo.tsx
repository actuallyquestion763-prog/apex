export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const dims = size === 'sm' ? 'h-7 w-7' : size === 'lg' ? 'h-12 w-12' : 'h-9 w-9'
  const text = size === 'sm' ? 'text-lg' : size === 'lg' ? 'text-3xl' : 'text-xl'
  return (
    <div className="flex items-center gap-2.5">
      <div className={`${dims} rounded-xl bg-ink-800 ring-1 ring-gold-500/30 flex items-center justify-center transition`}>
        <svg viewBox="0 0 64 64" className="h-2/3 w-2/3">
          <path d="M16 44V20l10 12 10-12v24" stroke="#f59e0b" strokeWidth="4" fill="none" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx="48" cy="20" r="4" fill="#0ea5e9" />
        </svg>
      </div>
      <span className={`${text} font-extrabold tracking-tight text-white`}>
        TRUS<span className="text-gold-400">T</span>
      </span>
    </div>
  )
}
