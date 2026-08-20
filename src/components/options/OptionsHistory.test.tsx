import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OptionsHistory } from './OptionsHistory'
import type { OptionTrade } from '../../types'
import * as useOptions from '../../store/useOptions'

function trade(overrides: Partial<OptionTrade>): OptionTrade {
  return {
    id: overrides.id ?? 't1', userId: 'u1', accountId: 'a1', symbol: 'BTC/USDT', direction: 'BUY',
    investment: '10', currency: 'USDT', durationSeconds: 30, payoutPercentSnapshot: '5',
    entryPrice: '60000', entryPriceTimestamp: new Date().toISOString(), entrySource: 'Binance',
    expiryAt: new Date().toISOString(), expiryPrice: '60100', expiryPriceTimestamp: new Date().toISOString(), expirySource: 'Binance',
    result: 'WIN', profitAmount: '0.5', returnAmount: '10.5', status: 'SETTLED',
    requestedResultMode: 'NORMAL', rejectionReason: null, createdAt: new Date().toISOString(), settledAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('OptionsHistory (history filters)', () => {
  it('renders every trade the backend returns, with asset/direction/result columns', () => {
    vi.spyOn(useOptions, 'useOptionTradeHistory').mockReturnValue({
      trades: [trade({ id: 't1', symbol: 'BTC/USDT', result: 'WIN' }), trade({ id: 't2', symbol: 'ETH/USDT', result: 'LOSS' })],
      loading: false, error: null, refetch: vi.fn(),
    })
    render(<OptionsHistory symbols={['BTC/USDT', 'ETH/USDT']} />)
    // BTC/USDT and ETH/USDT each appear twice — once in a table row, once
    // as a <option> in the asset filter dropdown — assert on the table cells.
    const rows = screen.getAllByRole('row')
    expect(rows.some((r) => r.textContent?.includes('BTC/USDT'))).toBe(true)
    expect(rows.some((r) => r.textContent?.includes('ETH/USDT'))).toBe(true)
  })

  it('shows an honest empty state when there is no history yet, never a fabricated row', () => {
    vi.spyOn(useOptions, 'useOptionTradeHistory').mockReturnValue({ trades: [], loading: false, error: null, refetch: vi.fn() })
    render(<OptionsHistory symbols={[]} />)
    expect(screen.getByText('No option trades yet')).toBeInTheDocument()
  })

  it('re-queries the backend with the selected result filter rather than filtering client-side', () => {
    const spy = vi.spyOn(useOptions, 'useOptionTradeHistory').mockReturnValue({ trades: [], loading: false, error: null, refetch: vi.fn() })
    render(<OptionsHistory symbols={['BTC/USDT']} />)
    fireEvent.change(screen.getByDisplayValue('All results'), { target: { value: 'WIN' } })
    const lastCallArgs = spy.mock.calls[spy.mock.calls.length - 1][0]
    expect(lastCallArgs?.result).toBe('WIN')
  })

  it('re-queries with the active/completed scope filter', () => {
    const spy = vi.spyOn(useOptions, 'useOptionTradeHistory').mockReturnValue({ trades: [], loading: false, error: null, refetch: vi.fn() })
    render(<OptionsHistory symbols={[]} />)
    fireEvent.change(screen.getByDisplayValue('All'), { target: { value: 'completed' } })
    const lastCallArgs = spy.mock.calls[spy.mock.calls.length - 1][0]
    expect(lastCallArgs?.completed).toBe(true)
  })
})
