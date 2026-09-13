import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

describe('OptionsAmountInput (amount entry, quick buttons, balance UX)', () => {
  it('shows the $500–$500,000 range in the placeholder when min/max are configured', () => {
    render(<OptionsAmountInput value="" onChange={() => {}} currency="USDT" min="500" max="500000" availableBalance={null} />)
    expect(screen.getByPlaceholderText('Enter amount ($500 – $500,000)')).toBeInTheDocument()
  })

  it('shows an open-ended placeholder ("$500 and above") when there is no configured maximum — the real market config as of the latest spec update', () => {
    render(<OptionsAmountInput value="" onChange={() => {}} currency="USDT" min="500" max={null} availableBalance={null} />)
    expect(screen.getByPlaceholderText('Enter amount ($500 and above)')).toBeInTheDocument()
  })

  it('never shows a maximum-investment error when max is null, no matter how large the amount', () => {
    render(<OptionsAmountInput value="10000000" onChange={() => {}} currency="USDT" min="500" max={null} availableBalance={null} />)
    expect(screen.queryByText(/Maximum investment/i)).not.toBeInTheDocument()
  })

  it('renders a quick-amount button for every tier boundary and fills the field when clicked', () => {
    const onChange = vi.fn()
    render(<OptionsAmountInput value="" onChange={onChange} currency="USDT" min="500" max="500000" availableBalance={1000000} />)
    for (const label of ['$500', '$1K', '$5K', '$10K', '$50K', '$100K']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('button', { name: '$10K' }))
    expect(onChange).toHaveBeenCalledWith('10000')
  })

  it('highlights the quick-amount button matching the current value', () => {
    render(<OptionsAmountInput value="5000" onChange={() => {}} currency="USDT" min="500" max="500000" availableBalance={1000000} />)
    expect(screen.getByRole('button', { name: '$5K' })).toHaveClass('bg-gold-500')
  })

  it('shows an insufficient-balance message with the exact available/required amounts, and never a color-only cue', () => {
    render(<OptionsAmountInput value="600" onChange={() => {}} currency="USDT" min="1" max={null} availableBalance={500} />)
    expect(screen.getByText('Insufficient balance')).toBeInTheDocument()
    expect(screen.getByText(/Available: 500 USDT · Required: 600 USDT/)).toBeInTheDocument()
  })

  it('shows a minimum-investment message when the amount is below the configured minimum', () => {
    render(<OptionsAmountInput value="1" onChange={() => {}} currency="USDT" min="10" max={null} availableBalance={1000} />)
    expect(screen.getByText(/Minimum investment is 10 USDT/)).toBeInTheDocument()
  })

  it('shows a maximum-investment message when the amount exceeds the configured maximum', () => {
    render(<OptionsAmountInput value="600000" onChange={() => {}} currency="USDT" min="500" max="500000" availableBalance={null} />)
    expect(screen.getByText(/Maximum investment is 500000 USDT/)).toBeInTheDocument()
  })

  it('associates the amount input with its label for accessibility, even though the label is visually hidden in favor of a placeholder', () => {
    render(<OptionsAmountInput value="100" onChange={() => {}} currency="USDT" min="1" max={null} availableBalance={1000} />)
    expect(screen.getByLabelText('Investment (USDT)')).toBeInTheDocument()
  })
})
