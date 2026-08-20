import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OptionsActiveTrade } from './OptionsActiveTrade'
import type { OptionTrade } from '../../types'

function activeTrade(overrides: Partial<OptionTrade> = {}): OptionTrade {
  return {
    id: 't1', userId: 'u1', accountId: 'a1', symbol: 'XAU/USD', direction: 'BUY',
    investment: '100', currency: 'USDT', durationSeconds: 30, payoutPercentSnapshot: '5',
    entryPrice: '4485.795', entryPriceTimestamp: new Date().toISOString(), entrySource: 'GoldAPI',
    expiryAt: new Date(Date.now() + 26_000).toISOString(), expiryPrice: null, expiryPriceTimestamp: null, expirySource: null,
    result: null, profitAmount: null, returnAmount: null, status: 'ACTIVE',
    requestedResultMode: 'NORMAL', rejectionReason: null, createdAt: new Date().toISOString(), settledAt: null,
    ...overrides,
  }
}

describe('OptionsActiveTrade (active trade rendering)', () => {
  it('renders asset, direction, investment, payout, and duration exactly as the backend returned them', () => {
    render(<OptionsActiveTrade trade={activeTrade()} />)
    expect(screen.getAllByText('XAU/USD').length).toBeGreaterThan(0)
    expect(screen.getByText('100 USDT')).toBeInTheDocument()
    expect(screen.getByText('5%')).toBeInTheDocument()
    expect(screen.getByText('30s')).toBeInTheDocument()
    expect(screen.getByText('4485.795')).toBeInTheDocument()
  })

  it('shows the direction badge', () => {
    render(<OptionsActiveTrade trade={activeTrade()} />)
    expect(screen.getAllByText('BUY').length).toBeGreaterThan(0)
  })

  it('shows SELL trades with the bear color/down arrow, distinguishable beyond color alone by its own text', () => {
    render(<OptionsActiveTrade trade={activeTrade({ direction: 'SELL' })} />)
    expect(screen.getAllByText('SELL').length).toBeGreaterThan(0)
  })

  it('always shows the "settling" hint so the user understands what is happening', () => {
    render(<OptionsActiveTrade trade={activeTrade()} />)
    expect(screen.getByText(/Please wait while your trade is being settled/)).toBeInTheDocument()
  })
})
