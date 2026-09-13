import { Decimal } from '@prisma/client/runtime/library'
import type { OptionDuration } from '@prisma/client'

// Backend mirror of the frontend's resolveDurationForAmount()
// (src/components/options/optionAmountTier.ts) — the SAME deterministic
// rule, expressed independently on each side rather than shared over the
// network, per the operator's explicit "no ambiguity, same rule on both
// sides" requirement. The qualifying tier is always the one with the
// GREATEST minAmount at or below the entered investment amount (e.g. an
// amount exactly on a displayed boundary, like $1,000, resolves to the
// LOWER tier, because the next tier's minAmount is seeded as $1,000.01 —
// see prisma/seed.ts's OPTION_TIERS comment for the exact boundary values).
//
// This is the SERVER-SIDE half of amount-tier enforcement
// (OptionsRiskService's DURATION_TIER_MISMATCH check calls this to confirm
// the client-submitted duration is actually the correct tier for the
// submitted investment — not just "big enough" for that duration's own
// minAmount, which was the previous, incomplete check).
export function resolveDurationForAmount(durations: OptionDuration[], amount: Decimal): OptionDuration | null {
  if (!amount.isFinite() || amount.lte(0)) return null
  let best: OptionDuration | null = null
  for (const d of durations) {
    if (amount.lt(d.minAmount)) continue
    if (!best || d.minAmount.gt(best.minAmount)) best = d
  }
  return best
}
