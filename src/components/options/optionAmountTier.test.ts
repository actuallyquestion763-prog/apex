import { describe, it, expect } from 'vitest'
import { resolveDurationForAmount, nextTier } from './optionAmountTier'

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
