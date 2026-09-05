import type { OptionDurationConfig } from '../../types'

// Amount-tier trading ticket — duration and profit are resolved entirely
// from the amount the user types (never manually clicked/typed): the
// qualifying tier is the one with the GREATEST minAmount at or below the
// entered amount (e.g. $10 -> 30s/5%, $50 -> 60s/10%, $100 -> 90s/15%: $75
// resolves to the 60s/10% tier, not 90s). The backend independently
// re-enforces this exact rule at trade-creation time (OptionsRiskService's
// DURATION_MIN_AMOUNT_NOT_MET check) — this is display-only, never
// authoritative.
export function resolveDurationForAmount(durations: OptionDurationConfig[], amount: number): OptionDurationConfig | null {
  if (!Number.isFinite(amount) || amount <= 0) return null
  let best: OptionDurationConfig | null = null
  for (const d of durations) {
    if (amount < parseFloat(d.minAmount)) continue
    if (!best || parseFloat(d.minAmount) > parseFloat(best.minAmount)) best = d
  }
  return best
}

// The smallest not-yet-qualified tier — used to tell the user exactly how
// much more they need to enter to unlock the next duration/profit tier.
export function nextTier(durations: OptionDurationConfig[], amount: number): OptionDurationConfig | null {
  let next: OptionDurationConfig | null = null
  for (const d of durations) {
    if (amount >= parseFloat(d.minAmount)) continue
    if (!next || parseFloat(d.minAmount) < parseFloat(next.minAmount)) next = d
  }
  return next
}
