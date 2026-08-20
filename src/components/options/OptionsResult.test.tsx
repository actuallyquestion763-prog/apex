import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OptionsResult } from './OptionsResult'
import type { OptionTrade } from '../../types'

function trade(overrides: Partial<OptionTrade>): OptionTrade {
  return {
    id: 't1', userId: 'u1', accountId: 'a1', symbol: 'BTC/USDT', direction: 'BUY',
    investment: '100', currency: 'USDT', durationSeconds: 30, payoutPercentSnapshot: '5',
    entryPrice: '60000', entryPriceTimestamp: new Date().toISOString(), entrySource: 'Binance',
    expiryAt: new Date().toISOString(), expiryPrice: '60100', expiryPriceTimestamp: new Date().toISOString(), expirySource: 'Binance',
    result: null, profitAmount: null, returnAmount: null, status: 'SETTLED',
    requestedResultMode: 'NORMAL', rejectionReason: null, createdAt: new Date().toISOString(), settledAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('OptionsResult (result rendering)', () => {
  it('renders a WIN exactly as the backend recorded it — investment, profit, and total return', () => {
    render(<OptionsResult trade={trade({ result: 'WIN', profitAmount: '5', returnAmount: '105' })} onDismiss={() => {}} />)
    expect(screen.getByText('You Won')).toBeInTheDocument()
    expect(screen.getByText('100 USDT')).toBeInTheDocument()
    expect(screen.getByText('+5 USDT')).toBeInTheDocument()
    expect(screen.getByText('105 USDT')).toBeInTheDocument()
  })

  it('renders a LOSS with the loss amount, never a profit figure', () => {
    render(<OptionsResult trade={trade({ result: 'LOSS', profitAmount: '-100', returnAmount: '0' })} onDismiss={() => {}} />)
    expect(screen.getByText('Trade Lost')).toBeInTheDocument()
    expect(screen.queryByText(/Potential Profit/)).not.toBeInTheDocument()
  })

  it('renders a DRAW with the investment returned in full', () => {
    render(<OptionsResult trade={trade({ result: 'DRAW', profitAmount: '0', returnAmount: '100' })} onDismiss={() => {}} />)
    expect(screen.getByText('Trade Draw')).toBeInTheDocument()
    // Both "Investment" (100 USDT) and "Investment Returned" (100 USDT)
    // legitimately show the same figure for a DRAW — assert there are two,
    // rather than a single ambiguous query.
    expect(screen.getAllByText('100 USDT')).toHaveLength(2)
  })

  it('always shows both entry and expiry price so the result is independently checkable', () => {
    render(<OptionsResult trade={trade({ result: 'WIN', profitAmount: '5', returnAmount: '105' })} onDismiss={() => {}} />)
    expect(screen.getByText('60000')).toBeInTheDocument()
    expect(screen.getByText('60100')).toBeInTheDocument()
  })

  it('calls onDismiss when the close button is clicked', () => {
    const onDismiss = vi.fn()
    render(<OptionsResult trade={trade({ result: 'DRAW', profitAmount: '0', returnAmount: '100' })} onDismiss={onDismiss} />)
    screen.getByText('Close').click()
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
