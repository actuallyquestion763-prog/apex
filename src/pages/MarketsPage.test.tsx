import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MarketsPage from './MarketsPage'
import type { TickerPrice } from '../types'

const ROWS: TickerPrice[] = [
  { symbol: 'BTC/USDT', name: 'Bitcoin', price: 65000, change24h: 100, changePct: 1.2 },
  { symbol: 'XAU/USD', name: 'Gold', price: 2400, change24h: 5, changePct: 0.1 },
]

vi.mock('../store/priceFeed', () => ({
  snapshot: () => ROWS,
  getMarketStatus: () => 'live',
}))

function market(symbol: string, quoteAsset: string, baseAsset: string) {
  return {
    id: symbol, symbol, quoteAsset, baseAsset,
    dataSource: 'LIVE', tradingEnabled: true, maintenanceMode: false,
    displayName: symbol, marketType: 'CRYPTO_SPOT', enabled: true,
    pricePrecision: 2, quantityPrecision: 8, provider: null, providerSymbol: null,
  }
}

vi.mock('../store/useStore', () => ({
  useMarketConfigs: () => ({ markets: [market('BTC/USDT', 'USDT', 'BTC'), market('XAU/USD', 'USD', 'XAU')] }),
}))

describe('MarketsPage — currency-aware crypto/metal prices (P1-3)', () => {
  it('labels a USDT-quoted crypto price with USDT, not a bare "$"', () => {
    render(<MemoryRouter><MarketsPage /></MemoryRouter>)
    expect(screen.getByText('65,000.00 USDT')).toBeInTheDocument()
  })

  it('labels a USD-quoted price with USD, preserving existing USD behavior', () => {
    render(<MemoryRouter><MarketsPage /></MemoryRouter>)
    expect(screen.getByText('2,400.00 USD')).toBeInTheDocument()
  })
})
