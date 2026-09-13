import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OptionsTradeSummary } from './OptionsTradeSummary'

describe('OptionsTradeSummary', () => {
  it('computes Potential Profit and Total Return using the exact spec formula (investment * ROI / 100)', () => {
    render(<OptionsTradeSummary investment={10000} currency="USDT" payoutPercent="18" />)
    expect(screen.getByText('10,000.00 USDT')).toBeInTheDocument()
    expect(screen.getByText('+1,800.00 USDT')).toBeInTheDocument()
    expect(screen.getByText('11,800.00 USDT')).toBeInTheDocument()
  })

  it('shows an honest placeholder when no tier has resolved yet, never a fabricated profit/return', () => {
    render(<OptionsTradeSummary investment={NaN} currency="USDT" payoutPercent={null} />)
    expect(screen.getAllByText('—')).toHaveLength(3)
  })

  it('recomputes correctly for a different tier (top tier, 30%)', () => {
    render(<OptionsTradeSummary investment={500000} currency="USDT" payoutPercent="30" />)
    expect(screen.getByText('+150,000.00 USDT')).toBeInTheDocument()
    expect(screen.getByText('650,000.00 USDT')).toBeInTheDocument()
  })
})
