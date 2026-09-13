import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OptionsDurationSelector } from './OptionsDurationSelector'

// The seven-tier system (operator's final trading spec) — same values as
// prisma/seed.ts's OPTION_TIERS.
const durations = [
  { durationSeconds: 30, payoutPercent: '10', minAmount: '500' },
  { durationSeconds: 60, payoutPercent: '12', minAmount: '1000.01' },
  { durationSeconds: 120, payoutPercent: '15', minAmount: '5000.01' },
  { durationSeconds: 300, payoutPercent: '18', minAmount: '10000.01' },
  { durationSeconds: 600, payoutPercent: '22', minAmount: '50000.01' },
  { durationSeconds: 900, payoutPercent: '25', minAmount: '100000.01' },
  { durationSeconds: 1800, payoutPercent: '30', minAmount: '250000.01' },
]

describe('OptionsDurationSelector — read-only tier ladder (amount-driven, never clicked)', () => {
  it('renders every configured tier as a card with Duration, ROI, and allowed amount range, never a hardcoded list', () => {
    render(<OptionsDurationSelector durations={durations} activeDurationSeconds={null} marketMaxInvestment="500000" />)
    expect(screen.getByText('30 Seconds')).toBeInTheDocument()
    expect(screen.getByText('1 Minute')).toBeInTheDocument()
    expect(screen.getByText('2 Minutes')).toBeInTheDocument()
    expect(screen.getByText('5 Minutes')).toBeInTheDocument()
    expect(screen.getByText('10 Minutes')).toBeInTheDocument()
    expect(screen.getByText('15 Minutes')).toBeInTheDocument()
    expect(screen.getByText('30 Minutes')).toBeInTheDocument()
    expect(screen.getByText('ROI: 10%')).toBeInTheDocument()
    expect(screen.getByText('ROI: 30%')).toBeInTheDocument()
  })

  it("shows each tier's allowed amount range, computed from its own minAmount up to just below the next tier's", () => {
    render(<OptionsDurationSelector durations={durations} activeDurationSeconds={null} marketMaxInvestment="500000" />)
    expect(screen.getByText('$0.5K–$1.0K')).toBeInTheDocument() // 500 -> 1000.01 - 0.01 = 1000
    expect(screen.getByText('$10.0K–$50.0K')).toBeInTheDocument() // 5-min tier
    expect(screen.getByText('$250.0K–$500.0K')).toBeInTheDocument() // top tier bounded by market max, not another tier
  })

  it('highlights whichever tier the currently-resolved duration is, without being clickable', () => {
    render(<OptionsDurationSelector durations={durations} activeDurationSeconds={60} marketMaxInvestment="500000" />)
    expect(screen.getByText('1 Minute').closest('[aria-current]')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('30 Seconds').closest('[aria-current]')).toHaveAttribute('aria-current', 'false')
    // No <button> anywhere — this is a read-only display, not a control.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('highlights nothing when no amount has resolved a tier yet', () => {
    render(<OptionsDurationSelector durations={durations} activeDurationSeconds={null} marketMaxInvestment="500000" />)
    for (const label of ['30 Seconds', '1 Minute', '2 Minutes', '5 Minutes', '10 Minutes', '15 Minutes', '30 Minutes']) {
      expect(screen.getByText(label).closest('[aria-current]')).toHaveAttribute('aria-current', 'false')
    }
  })

  it('shows an honest empty state when the backend has no durations configured for this asset', () => {
    render(<OptionsDurationSelector durations={[]} activeDurationSeconds={null} marketMaxInvestment={null} />)
    expect(screen.getByText(/No durations are currently configured/)).toBeInTheDocument()
  })

  it('falls back to an open-ended "+" range when there is no next tier and no market maximum', () => {
    const single = [{ durationSeconds: 30, payoutPercent: '10', minAmount: '500' }]
    render(<OptionsDurationSelector durations={single} activeDurationSeconds={null} marketMaxInvestment={null} />)
    expect(screen.getByText('$0.5K+')).toBeInTheDocument()
  })

  it('shows the top tier as open-ended when the market has no maxInvestment (the real production config) — never falls back to a fabricated $500K ceiling', () => {
    render(<OptionsDurationSelector durations={durations} activeDurationSeconds={null} marketMaxInvestment={null} />)
    expect(screen.getByText('$250.0K+')).toBeInTheDocument()
    expect(screen.queryByText('$250.0K–$500.0K')).not.toBeInTheDocument()
  })
})
