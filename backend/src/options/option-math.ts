// Pure, dependency-free math for Fixed-Time Options Trading — mirrors the
// existing convention of order-fill-math.ts/order-risk-math.ts (financial
// comparisons/derivations extracted into pure functions, unit-tested in
// isolation, never inlined float math). Every value here is a Decimal — no
// JavaScript floating-point number is ever used for a monetary comparison
// or calculation.
import { Decimal } from '@prisma/client/runtime/library'
import type { OptionDirection, OptionResult } from '@prisma/client'

// The core WIN/LOSS/DRAW rule (Part 9/10). Equal price is always a DRAW,
// regardless of direction — never a market outcome, just the honest "the
// price genuinely did not move" case.
export function determineResult(direction: OptionDirection, entryPrice: Decimal, expiryPrice: Decimal): OptionResult {
  if (expiryPrice.equals(entryPrice)) return 'DRAW'
  const expiryHigher = expiryPrice.gt(entryPrice)
  if (direction === 'BUY') return expiryHigher ? 'WIN' : 'LOSS'
  return expiryHigher ? 'LOSS' : 'WIN'
}

// profit = investment * payoutPercent / 100 (Part 6). payoutPercent is the
// admin-configured/snapshotted value, e.g. Decimal('5') for 5%.
export function computeProfit(investment: Decimal, payoutPercent: Decimal): Decimal {
  return investment.times(payoutPercent).dividedBy(100)
}

export function computeReturn(investment: Decimal, profit: Decimal): Decimal {
  return investment.plus(profit)
}
