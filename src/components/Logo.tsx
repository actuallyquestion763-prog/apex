export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const dims = size === 'sm' ? 'h-7 w-7' : size === 'lg' ? 'h-12 w-12' : 'h-9 w-9'
  const text = size === 'sm' ? 'text-lg' : size === 'lg' ? 'text-3xl' : 'text-xl'
  return (
    <div className="flex items-center gap-2.5">
      <div className={`${dims} rounded-xl bg-ink-950 border-2 border-ocean-400 flex items-center justify-center shadow-glow-sm transition`}>
        <svg viewBox="0 0 64 64" className="h-2/3 w-2/3">
          {/* Bold "E" letterform */}
          <rect x="13" y="13" width="9" height="38" fill="#fff" />
          <rect x="13" y="13" width="27" height="9" fill="#fff" />
          <rect x="13" y="28" width="21" height="9" fill="#fff" />
          <rect x="13" y="42" width="27" height="9" fill="#fff" />
          {/* Upward trend-arrow accent */}
          <path d="M38 27 L54 11 M42 11 H54 V23" stroke="#f59e0b" strokeWidth="5" fill="none" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
      <span className={`${text} font-extrabold tracking-tight text-white`}>
        EDGE<span className="text-gold-400">TRADE</span>
      </span>
    </div>
  )
}
