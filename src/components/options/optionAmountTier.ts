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

// Display-only upper bound for one tier's amount-range label (e.g. the
// "$10.0K–$50.0K" on a duration card) — the tier's own minAmount is
// already its lower bound. The upper bound is whatever comes JUST BEFORE
// the next-higher configured tier's minAmount (so ranges never visually
// overlap), or the market's own maxInvestment for the highest tier (no
// higher tier exists to bound it). Returns null when neither applies
// (unbounded — e.g. a market with no maxInvestment and this is the only
// tier), so the caller can render "and up" rather than inventing a number.
export function tierUpperBound(
  durations: OptionDurationConfig[],
  tier: OptionDurationConfig,
  marketMaxInvestment: string | null,
): number | null {
  const tierMin = parseFloat(tier.minAmount)
  let nextMin: number | null = null
  for (const d of durations) {
    const dMin = parseFloat(d.minAmount)
    if (dMin <= tierMin) continue
    if (nextMin === null || dMin < nextMin) nextMin = dMin
  }
  if (nextMin !== null) return nextMin - 0.01
  return marketMaxInvestment != null ? parseFloat(marketMaxInvestment) : null
}
