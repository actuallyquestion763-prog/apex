import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OptionsAmountInput, isOptionAmountValid } from './OptionsAmountInput'

describe('isOptionAmountValid', () => {
  it('rejects zero, negative, and non-numeric amounts', () => {
    expect(isOptionAmountValid('0', '1', null, 1000)).toBe(false)
    expect(isOptionAmountValid('-5', '1', null, 1000)).toBe(false)
    expect(isOptionAmountValid('abc', '1', null, 1000)).toBe(false)
  })
  it('rejects amounts below the configured minimum', () => {
    expect(isOptionAmountValid('5', '10', null, 1000)).toBe(false)
  })
  it('rejects amounts above the configured maximum', () => {
    expect(isOptionAmountValid('500', '1', '100', 1000)).toBe(false)
  })
  it('rejects amounts exceeding the available balance', () => {
    expect(isOptionAmountValid('100', '1', null, 50)).toBe(false)
  })
  it('accepts a valid amount within range and balance', () => {
    expect(isOptionAmountValid('100', '1', '1000', 500)).toBe(true)
  })
  it('does not gate on balance when it is unknown (null)', () => {
    expect(isOptionAmountValid('100', '1', null, null)).toBe(true)
  })
})

describe('OptionsAmountInput (payout display, amount calculation, balance UX)', () => {
  it('displays the payout percentage exactly as configured, never hardcoded', () => {
    render(<OptionsAmountInput value="100" onChange={() => {}} currency="USDT" payoutPercent="7" min="1" max={null} availableBalance={1000} />)
    expect(screen.getByText('7%')).toBeInTheDocument()
  })

  it('computes potential profit and return using profit = investment * payoutPercent / 100', () => {
    render(<OptionsAmountInput value="100" onChange={() => {}} currency="USDT" payoutPercent="5" min="1" max={null} availableBalance={1000} />)
    expect(screen.getByText('5 USDT')).toBeInTheDocument() // potential profit
    expect(screen.getByText('105 USDT')).toBeInTheDocument() // potential return
  })

  it('shows an insufficient-balance message with the exact available/required amounts, and never a color-only cue', () => {
    render(<OptionsAmountInput value="600" onChange={() => {}} currency="USDT" payoutPercent="5" min="1" max={null} availableBalance={500} />)
    expect(screen.getByText('Insufficient balance')).toBeInTheDocument()
    expect(screen.getByText(/Available: 500 USDT · Required: 600 USDT/)).toBeInTheDocument()
  })

  it('shows a minimum-investment message when the amount is below the configured minimum', () => {
    render(<OptionsAmountInput value="1" onChange={() => {}} currency="USDT" payoutPercent="5" min="10" max={null} availableBalance={1000} />)
    expect(screen.getByText(/Minimum investment is 10 USDT/)).toBeInTheDocument()
  })

  it('associates the amount input with its label for accessibility', () => {
    render(<OptionsAmountInput value="100" onChange={() => {}} currency="USDT" payoutPercent="5" min="1" max={null} availableBalance={1000} />)
    expect(screen.getByLabelText('Investment (USDT)')).toBeInTheDocument()
  })
})
