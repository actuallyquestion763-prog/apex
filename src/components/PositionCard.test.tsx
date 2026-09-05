import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PositionCard } from './PositionCard'
import type { Position } from '../types'

const POSITION: Position = {
  id: 'p1',
  userId: 'u1',
  symbol: 'BTC/USDT',
  side: 'BUY',
  quantity: '0.002',
  avgEntryPrice: '65000',
  currentPrice: '66000',
  status: 'OPEN',
  openedAt: new Date().toISOString(),
} as unknown as Position

function renderCard(overrides: Partial<Position> = {}) {
  return render(
    <PositionCard
      position={{ ...POSITION, ...overrides }}
      pnl={12.5}
      marketStatus="live"
      onDismiss={vi.fn()}
    />,
  )
}

describe('PositionCard — Quantity is not a currency amount (P1-2)', () => {
  it('shows the Quantity value without a leading "$" — a quantity is not a currency amount', () => {
    renderCard()
    expect(screen.getByText('Quantity')).toBeInTheDocument()
    expect(screen.getByText('0.00')).toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('still shows real USD-denominated prices (Entry/Current) with their "$" prefix — only quantity was wrong', () => {
    renderCard()
    expect(screen.getByText('$65000.00')).toBeInTheDocument()
    expect(screen.getByText('$66000.00')).toBeInTheDocument()
  })
})
