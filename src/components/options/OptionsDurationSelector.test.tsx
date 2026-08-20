import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OptionsDurationSelector } from './OptionsDurationSelector'

const durations = [
  { durationSeconds: 30, payoutPercent: '5' },
  { durationSeconds: 60, payoutPercent: '7' },
  { durationSeconds: 120, payoutPercent: '12' },
]

describe('OptionsDurationSelector', () => {
  it('renders every configured duration from the backend, never a hardcoded list', () => {
    render(<OptionsDurationSelector durations={durations} selected={30} onSelect={() => {}} />)
    expect(screen.getByText('30s')).toBeInTheDocument()
    expect(screen.getByText('60s')).toBeInTheDocument()
    expect(screen.getByText('120s')).toBeInTheDocument()
  })

  it('calls onSelect with exactly the clicked duration — never a different one', () => {
    const onSelect = vi.fn()
    render(<OptionsDurationSelector durations={durations} selected={30} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('60s'))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(60)
  })

  it('marks the selected duration as pressed for assistive technology, not color alone', () => {
    render(<OptionsDurationSelector durations={durations} selected={60} onSelect={() => {}} />)
    expect(screen.getByText('60s')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('30s')).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows an honest empty state when the backend has no durations configured for this asset', () => {
    render(<OptionsDurationSelector durations={[]} selected={null} onSelect={() => {}} />)
    expect(screen.getByText(/No durations are currently configured/)).toBeInTheDocument()
  })
})
