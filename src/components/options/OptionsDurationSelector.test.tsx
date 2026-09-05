import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OptionsDurationSelector } from './OptionsDurationSelector'

const durations = [
  { durationSeconds: 30, payoutPercent: '5', minAmount: '10' },
  { durationSeconds: 60, payoutPercent: '7', minAmount: '50' },
  { durationSeconds: 120, payoutPercent: '12', minAmount: '100' },
]

describe('OptionsDurationSelector — read-only tier ladder (amount-driven, never clicked)', () => {
  it('renders every configured duration from the backend, never a hardcoded list', () => {
    render(<OptionsDurationSelector durations={durations} activeDurationSeconds={30} />)
    expect(screen.getByText('30s')).toBeInTheDocument()
    expect(screen.getByText('60s')).toBeInTheDocument()
    expect(screen.getByText('120s')).toBeInTheDocument()
  })

  it('highlights whichever tier the currently-resolved duration is, without being clickable', () => {
    render(<OptionsDurationSelector durations={durations} activeDurationSeconds={60} />)
    expect(screen.getByText('60s')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('30s')).toHaveAttribute('aria-current', 'false')
    // No <button> anywhere — this is a read-only display, not a control.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('highlights nothing when no amount has resolved a tier yet', () => {
    render(<OptionsDurationSelector durations={durations} activeDurationSeconds={null} />)
    expect(screen.getByText('30s')).toHaveAttribute('aria-current', 'false')
    expect(screen.getByText('60s')).toHaveAttribute('aria-current', 'false')
    expect(screen.getByText('120s')).toHaveAttribute('aria-current', 'false')
  })

  it('shows an honest empty state when the backend has no durations configured for this asset', () => {
    render(<OptionsDurationSelector durations={[]} activeDurationSeconds={null} />)
    expect(screen.getByText(/No durations are currently configured/)).toBeInTheDocument()
  })
})
