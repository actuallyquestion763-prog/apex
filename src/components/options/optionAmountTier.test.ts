import { describe, it, expect } from 'vitest'
import { resolveDurationForAmount, nextTier, tierUpperBound } from './optionAmountTier'

// Matches the example rule from the product spec exactly:
// $10 -> 30s -> 5%, $50 -> 60s -> 10%, $100 -> 90s -> 15%
const TIERS = [
  { durationSeconds: 30, payoutPercent: '5', minAmount: '10' },
  { durationSeconds: 60, payoutPercent: '10', minAmount: '50' },
  { durationSeconds: 90, payoutPercent: '15', minAmount: '100' },
]

describe('resolveDurationForAmount', () => {
  it('resolves the exact tier at each threshold', () => {
    expect(resolveDurationForAmount(TIERS, 10)?.durationSeconds).toBe(30)
    expect(resolveDurationForAmount(TIERS, 50)?.durationSeconds).toBe(60)
    expect(resolveDurationForAmount(TIERS, 100)?.durationSeconds).toBe(90)
  })

  it('resolves the highest tier whose minimum is at or below the amount, never the next one up', () => {
    expect(resolveDurationForAmount(TIERS, 75)?.durationSeconds).toBe(60) // between $50 and $100 -> the $50 tier, not $100
    expect(resolveDurationForAmount(TIERS, 999)?.durationSeconds).toBe(90) // above the top tier -> still the top tier, never invented
  })

  it('resolves nothing below the lowest tier — never fabricates a duration/profit', () => {
    expect(resolveDurationForAmount(TIERS, 5)).toBeNull()
    expect(resolveDurationForAmount(TIERS, 0)).toBeNull()
  })

  it('resolves nothing for an invalid amount', () => {
    expect(resolveDurationForAmount(TIERS, NaN)).toBeNull()
    expect(resolveDurationForAmount(TIERS, -10)).toBeNull()
  })

  it('never gates on amount when a duration has no configured threshold (minAmount 0 — always qualifies)', () => {
    const unset = [{ durationSeconds: 30, payoutPercent: '5', minAmount: '0' }]
    expect(resolveDurationForAmount(unset, 1)?.durationSeconds).toBe(30)
  })
})

describe('nextTier', () => {
  it('reports the smallest not-yet-qualified tier, for "enter at least $X" messaging', () => {
    expect(nextTier(TIERS, 5)?.minAmount).toBe('10')
    expect(nextTier(TIERS, 30)?.minAmount).toBe('50')
  })

  it('reports nothing once every tier is qualified', () => {
    expect(nextTier(TIERS, 100)).toBeNull()
    expect(nextTier(TIERS, 500)).toBeNull()
  })
})

// The seven-tier system (operator's final trading spec) — every boundary
// example from the spec, expressed as minAmount values with a $0.01 gap
// above each displayed upper bound (see prisma/seed.ts's OPTION_TIERS
// comment for why: a whole-dollar amount exactly ON a boundary resolves to
// the LOWER tier, and the very next cent resolves to the next one).
const SEVEN_TIERS = [
  { durationSeconds: 30, payoutPercent: '10', minAmount: '500' },
  { durationSeconds: 60, payoutPercent: '12', minAmount: '1000.01' },
  { durationSeconds: 120, payoutPercent: '15', minAmount: '5000.01' },
  { durationSeconds: 300, payoutPercent: '18', minAmount: '10000.01' },
  { durationSeconds: 600, payoutPercent: '22', minAmount: '50000.01' },
  { durationSeconds: 900, payoutPercent: '25', minAmount: '100000.01' },
  { durationSeconds: 1800, payoutPercent: '30', minAmount: '250000.01' },
]

describe('resolveDurationForAmount — the seven-tier system, every boundary from the spec', () => {
  it.each([
    [500, 30], [750, 30], [1000, 30],
    [1001, 60], [5000, 60],
    [5001, 120], [10000, 120],
    [10001, 300], [50000, 300],
    [50001, 600], [100000, 600],
    [100001, 900], [250000, 900],
    [250001, 1800], [500000, 1800],
  ])('$%i resolves to the %is tier', (amount, expectedDuration) => {
    expect(resolveDurationForAmount(SEVEN_TIERS, amount)?.durationSeconds).toBe(expectedDuration)
  })

  it('below the lowest tier ($499) resolves nothing — never fabricates a duration', () => {
    expect(resolveDurationForAmount(SEVEN_TIERS, 499)).toBeNull()
  })
})

describe('tierUpperBound', () => {
  it("computes each tier's upper bound as just below the next tier's minAmount", () => {
    expect(tierUpperBound(SEVEN_TIERS, SEVEN_TIERS[0], '500000')).toBe(1000) // 1000.01 - 0.01
    expect(tierUpperBound(SEVEN_TIERS, SEVEN_TIERS[3], '500000')).toBe(50000) // 50000.01 - 0.01
  })

  it('uses the market maxInvestment for the top tier, since no higher tier bounds it', () => {
    expect(tierUpperBound(SEVEN_TIERS, SEVEN_TIERS[6], '500000')).toBe(500000)
  })

  it('returns null (open-ended) when there is no next tier and no market maximum', () => {
    expect(tierUpperBound(SEVEN_TIERS, SEVEN_TIERS[6], null)).toBeNull()
  })
})
