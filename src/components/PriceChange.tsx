// Consistent formatting for a percentage or dollar change: sign, color, no fabricated precision.
export function PriceChange({ value, mode = 'pct', pill = false, className = '' }: { value: number; mode?: 'pct' | 'usd'; pill?: boolean; className?: string }) {
  if (!Number.isFinite(value)) return <span className={`text-slate-500 ${className}`}>—</span>
  const up = value >= 0
  const text = mode === 'pct' ? `${up ? '+' : ''}${value.toFixed(2)}%` : `${up ? '+' : '-'}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (pill) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-xs font-bold ${up ? 'bg-bull/15 text-bull' : 'bg-bear/15 text-bear'} ${className}`}>
        <span aria-hidden="true">{up ? '↗' : '↘'}</span>
        {text}
      </span>
    )
  }
  return <span className={`font-mono font-semibold ${up ? 'text-bull' : 'text-bear'} ${className}`}>{text}</span>
}
