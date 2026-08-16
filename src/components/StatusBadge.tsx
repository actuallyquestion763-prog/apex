import type { MarketStatus } from '../store/priceFeed'

const CONFIG: Record<MarketStatus, { label: string; className: string; dot?: string }> = {
  live: { label: 'LIVE', className: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400', dot: 'bg-emerald-400' },
  simulated: { label: 'SIMULATED', className: 'border-sky-500/30 bg-sky-500/15 text-sky-300' },
  stale: { label: 'STALE', className: 'border-amber-500/30 bg-amber-500/15 text-amber-300' },
  unavailable: { label: 'UNAVAILABLE', className: 'border-rose-500/30 bg-rose-500/10 text-rose-300' },
  loading: { label: 'LOADING', className: 'border-ink-600 bg-ink-800/60 text-slate-400', dot: 'bg-slate-400' },
}

// Single source of truth for how market status renders across the app.
// 'simulated' must never look identical to 'live' — this is the only place that maps status -> style.
export function StatusBadge({ status, className = '' }: { status: MarketStatus; className?: string }) {
  const cfg = CONFIG[status] ?? CONFIG.unavailable
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide ${cfg.className} ${className}`}>
      {cfg.dot && <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot} ${status === 'live' ? 'animate-pulse' : ''}`} />}
      {cfg.label}
    </span>
  )
}
