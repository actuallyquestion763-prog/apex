import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PriceTicker } from './PriceTicker'
import type { TickerPrice } from '../types'

const PRICES: TickerPrice[] = [
  { symbol: 'BTC/USDT', name: 'Bitcoin', price: 65000, change24h: 100, changePct: 1.2 },
  { symbol: 'ETH/USDT', name: 'Ethereum', price: 3200, change24h: 10, changePct: -0.5 },
  { symbol: 'USDT/USD', name: 'Tether', price: 1, change24h: 0, changePct: 0 },
  { symbol: 'XRP/USDT', name: 'Ripple', price: 0.5, change24h: 0.01, changePct: 2 },
  { symbol: 'XAU/USD', name: 'Gold', price: 2400, change24h: 5, changePct: 0.1 },
]

vi.mock('../store/priceFeed', () => ({
  snapshot: () => PRICES,
  tickAll: () => PRICES,
}))

function market(symbol: string, quoteAsset: string, baseAsset: string) {
  return {
    id: symbol, symbol, quoteAsset, baseAsset,
    dataSource: 'LIVE', tradingEnabled: true, maintenanceMode: false,
    displayName: symbol, marketType: 'CRYPTO_SPOT', enabled: true,
    pricePrecision: 2, quantityPrecision: 8, provider: null, providerSymbol: null,
  }
}

const MARKETS = [
  market('BTC/USDT', 'USDT', 'BTC'),
  market('ETH/USDT', 'USDT', 'ETH'),
  market('USDT/USD', 'USD', 'USDT'),
  market('XRP/USDT', 'USDT', 'XRP'),
  market('XAU/USD', 'USD', 'XAU'),
]

vi.mock('../store/useStore', () => ({
  useMarketConfigs: () => ({ markets: MARKETS }),
}))

describe('PriceTicker — currency-aware crypto/metal prices (P1-3)', () => {
  it('labels a USDT-quoted crypto price with USDT, not a bare "$"', () => {
    render(<PriceTicker />)
    expect(screen.getAllByText('65,000 USDT').length).toBeGreaterThan(0)
    expect(screen.queryByText('$65,000')).not.toBeInTheDocument()
  })

  it('labels a USD-quoted price with USD, preserving existing USD behavior', () => {
    render(<PriceTicker />)
    expect(screen.getAllByText('2,400 USD').length).toBeGreaterThan(0)
  })
})
