import { Decimal } from '@prisma/client/runtime/library'
import { computeProfit, computeReturn, determineResult } from './option-math'

describe('option-math', () => {
  describe('determineResult', () => {
    it('BUY wins when expiry price is higher than entry', () => {
      expect(determineResult('BUY', new Decimal('4485.795'), new Decimal('4486.210'))).toBe('WIN')
    })
    it('BUY loses when expiry price is lower than entry', () => {
      expect(determineResult('BUY', new Decimal('4485.795'), new Decimal('4480.100'))).toBe('LOSS')
    })
    it('SELL wins when expiry price is lower than entry', () => {
      expect(determineResult('SELL', new Decimal('4485.795'), new Decimal('4480.100'))).toBe('WIN')
    })
    it('SELL loses when expiry price is higher than entry', () => {
      expect(determineResult('SELL', new Decimal('4485.795'), new Decimal('4486.210'))).toBe('LOSS')
    })
    it('BUY draws when expiry price exactly equals entry price', () => {
      expect(determineResult('BUY', new Decimal('4485.795'), new Decimal('4485.795'))).toBe('DRAW')
    })
    it('SELL draws when expiry price exactly equals entry price', () => {
      expect(determineResult('SELL', new Decimal('4485.795'), new Decimal('4485.795'))).toBe('DRAW')
    })
    it('draw comparison is exact-Decimal, not a floating-point-tolerant approximation', () => {
      // A value that differs only in the last decimal place must NOT be treated as equal.
      expect(determineResult('BUY', new Decimal('100.00000001'), new Decimal('100.00000002'))).toBe('WIN')
    })
  })

  describe('computeProfit / computeReturn', () => {
    it('computes profit as investment * payoutPercent / 100', () => {
      expect(computeProfit(new Decimal('100'), new Decimal('5')).toString()).toBe('5')
    })
    it('computes potential return as investment + profit', () => {
      const investment = new Decimal('100')
      const profit = computeProfit(investment, new Decimal('5'))
      expect(computeReturn(investment, profit).toString()).toBe('105')
    })
    it('handles non-round payout percentages exactly (no float drift)', () => {
      const profit = computeProfit(new Decimal('333.33'), new Decimal('7.5'))
      expect(profit.toString()).toBe('24.99975')
    })
  })
})
