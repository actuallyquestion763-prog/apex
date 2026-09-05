import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { OptionsCountdown } from './OptionsCountdown'

describe('OptionsCountdown (countdown derived from real expiry timestamp)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders the remaining time computed from expiryAt minus now, not a hardcoded value', () => {
    const expiryAt = new Date('2026-01-01T00:00:45.000Z').toISOString()
    render(<OptionsCountdown expiryAt={expiryAt} />)
    expect(screen.getByText('00:45')).toBeInTheDocument()
    expect(screen.getByText('Remaining')).toBeInTheDocument()
  })

  it('decreases as real time passes, derived from expiryAt - now on every tick', () => {
    const expiryAt = new Date('2026-01-01T00:00:30.000Z').toISOString()
    render(<OptionsCountdown expiryAt={expiryAt} />)
    expect(screen.getByText('00:30')).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(10_000) })
    expect(screen.getByText('00:20')).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(10_000) })
    expect(screen.getByText('00:10')).toBeInTheDocument()
  })

  it('does not reset to the original duration when the component re-renders with the same expiryAt', () => {
    const expiryAt = new Date('2026-01-01T00:00:30.000Z').toISOString()
    const { rerender } = render(<OptionsCountdown expiryAt={expiryAt} />)

    act(() => { vi.advanceTimersByTime(20_000) })
    expect(screen.getByText('00:10')).toBeInTheDocument()

    // Simulate a parent re-render (e.g. a poll refresh) passing the same expiryAt prop.
    rerender(<OptionsCountdown expiryAt={expiryAt} />)
    expect(screen.getByText('00:10')).toBeInTheDocument()
    expect(screen.queryByText('00:30')).not.toBeInTheDocument()
  })

  it('stops at zero and shows "Settling…" once expiry has passed, never going negative', () => {
    const expiryAt = new Date('2026-01-01T00:00:05.000Z').toISOString()
    render(<OptionsCountdown expiryAt={expiryAt} />)

    act(() => { vi.advanceTimersByTime(10_000) })
    expect(screen.getByText('00:00')).toBeInTheDocument()
    expect(screen.getByText('Settling…')).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(10_000) })
    expect(screen.getByText('00:00')).toBeInTheDocument()
  })
})
