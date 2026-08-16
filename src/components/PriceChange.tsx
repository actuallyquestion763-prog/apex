// Consistent formatting for a percentage or dollar change: sign, color, no fabricated precision.
export function PriceChange({ value, mode = 'pct', className = '' }: { value: number; mode?: 'pct' | 'usd'; className?: string }) {
  if (!Number.isFinite(value)) return <span className={`text-slate-500 ${className}`}>—</span>
  const up = value >= 0
  const text = mode === 'pct' ? `${up ? '+' : ''}${value.toFixed(2)}%` : `${up ? '+' : '-'}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return <span className={`font-mono font-semibold ${up ? 'text-bull' : 'text-bear'} ${className}`}>{text}</span>
}
