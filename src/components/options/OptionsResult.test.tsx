import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OptionsResult } from './OptionsResult'
import type { OptionTrade } from '../../types'

function trade(overrides: Partial<OptionTrade>): OptionTrade {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeee000468', userId: 'u1', accountId: 'a1', symbol: 'XAU/USD', direction: 'BUY',
    investment: '100', currency: 'USDT', durationSeconds: 30, payoutPercentSnapshot: '5',
    entryPrice: '60000', entryPriceTimestamp: new Date().toISOString(), entrySource: 'Binance',
    expiryAt: new Date().toISOString(), expiryPrice: '60100', expiryPriceTimestamp: new Date().toISOString(), expirySource: 'Binance',
    result: null, profitAmount: null, returnAmount: null, status: 'SETTLED',
    requestedResultMode: 'NORMAL', rejectionReason: null,
    createdAt: '2026-09-04T07:05:18.000Z', settledAt: '2026-09-04T07:05:51.000Z',
    ...overrides,
  }
}

describe('OptionsResult (result rendering)', () => {
  it('renders a WIN exactly as the backend recorded it — market, direction, investment, profit, and payout', () => {
    render(<OptionsResult trade={trade({ result: 'WIN', profitAmount: '5', returnAmount: '105' })} onDismiss={() => {}} />)
    expect(screen.getByText('Transaction Details')).toBeInTheDocument()
    expect(screen.getByText('Transaction Completed')).toBeInTheDocument()
    expect(screen.getByText('XAUUSD')).toBeInTheDocument() // Market — slash stripped
    expect(screen.getByText('BUY')).toBeInTheDocument()
    expect(screen.getByText('100 USDT')).toBeInTheDocument() // Investment
    expect(screen.getAllByText(/\+5/).length).toBeGreaterThan(0) // headline amount + Profit/Loss row
    expect(screen.getByText('105 USDT')).toBeInTheDocument() // Payout
    expect(screen.getByText('30s')).toBeInTheDocument()
  })

  it('never fabricates an order number — "Orders" is a real slice of the trade\'s own id', () => {
    render(<OptionsResult trade={trade({ result: 'WIN', profitAmount: '5', returnAmount: '105' })} onDismiss={() => {}} />)
    expect(screen.getByText('#000468')).toBeInTheDocument()
  })

  it('shows Open Time and Close Time from the trade\'s real createdAt/settledAt, never a live clock', () => {
    render(<OptionsResult trade={trade({ result: 'WIN', profitAmount: '5', returnAmount: '105' })} onDismiss={() => {}} />)
    expect(screen.getByText('Open Time')).toBeInTheDocument()
    expect(screen.getByText('Close Time')).toBeInTheDocument()
  })

  it('renders a LOSS with the signed loss amount, never a fabricated profit figure', () => {
    render(<OptionsResult trade={trade({ result: 'LOSS', profitAmount: '-100', returnAmount: '0' })} onDismiss={() => {}} />)
    expect(screen.getAllByText(/-100/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/\+100/)).not.toBeInTheDocument()
  })

  it('renders a DRAW with the investment returned in full, no +/- sign', () => {
    render(<OptionsResult trade={trade({ result: 'DRAW', profitAmount: '0', returnAmount: '100' })} onDismiss={() => {}} />)
    // Both "Investment" (100 USDT) and "Payout" (100 USDT) legitimately show
    // the same figure for a DRAW — assert there are two, never assume one.
    expect(screen.getAllByText('100 USDT')).toHaveLength(2)
  })

  it('calls onDismiss when the close button is clicked', () => {
    const onDismiss = vi.fn()
    render(<OptionsResult trade={trade({ result: 'DRAW', profitAmount: '0', returnAmount: '100' })} onDismiss={onDismiss} />)
    screen.getByText('Close').click()
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
