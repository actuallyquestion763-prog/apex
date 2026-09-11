export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const dims = size === 'sm' ? 'h-7 w-7' : size === 'lg' ? 'h-12 w-12' : 'h-9 w-9'
  const text = size === 'sm' ? 'text-lg' : size === 'lg' ? 'text-3xl' : 'text-xl'
  return (
    <div className="flex items-center gap-2.5">
      <div className={`${dims} rounded-xl bg-ink-800 ring-1 ring-ocean-500/30 flex items-center justify-center shadow-glow-sm transition`}>
        <svg viewBox="0 0 64 64" className="h-2/3 w-2/3">
          <path d="M16 44V20l10 12 10-12v24" stroke="#06b6d4" strokeWidth="4" fill="none" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx="48" cy="20" r="4" fill="#f59e0b" />
        </svg>
      </div>
      <span className={`${text} font-extrabold tracking-tight text-white`}>
        EDGE<span className="text-gold-400">TRADE</span>
      </span>
    </div>
  )
}
