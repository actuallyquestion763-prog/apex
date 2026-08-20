import { generateReferralCode } from './referral-code.util'

describe('generateReferralCode', () => {
  it('generates an 8-character code by default', () => {
    expect(generateReferralCode()).toHaveLength(8)
  })

  it('never includes visually-ambiguous characters (0/O, 1/I/L)', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateReferralCode()).not.toMatch(/[01ILO]/)
    }
  })

  it('is not the same value every call (genuinely randomized)', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateReferralCode()))
    expect(codes.size).toBeGreaterThan(45)
  })

  it('respects a custom length', () => {
    expect(generateReferralCode(12)).toHaveLength(12)
  })
})
