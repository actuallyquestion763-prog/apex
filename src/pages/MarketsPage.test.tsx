import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MarketsPage from './MarketsPage'
import type { TickerPrice } from '../types'

const ROWS: TickerPrice[] = [
  { symbol: 'BTC/USDT', name: 'Bitcoin', price: 65000, change24h: 100, changePct: 1.2 },
  { symbol: 'XAU/USD', name: 'Gold', price: 2400, change24h: 5, changePct: 0.1 },
  { symbol: 'ETH/USDT', name: 'Ethereum', price: 3000, change24h: -50, changePct: -2.5 },
]

// getMarketStatus is overridden per-describe-block below where the LIVE-tab
// distinction matters; this default keeps every row 'live' for the
// currency-formatting tests that don't care about status filtering.
let statusFor: (symbol: string) => string = () => 'live'

vi.mock('../store/priceFeed', () => ({
  snapshot: () => ROWS,
  getMarketStatus: (symbol: string) => statusFor(symbol),
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
  useMarketConfigs: () => ({ markets: [market('BTC/USDT', 'USDT', 'BTC'), market('XAU/USD', 'USD', 'XAU'), market('ETH/USDT', 'USDT', 'ETH')] }),
}))

function renderMarkets() {
  return render(<MemoryRouter><MarketsPage /></MemoryRouter>)
}

describe('MarketsPage — currency-aware crypto/metal prices (P1-3)', () => {
  it('labels a USDT-quoted crypto price with USDT, not a bare "$"', () => {
    renderMarkets()
    expect(screen.getByText('65,000.00 USDT')).toBeInTheDocument()
  })

  it('labels a USD-quoted price with USD, preserving existing USD behavior', () => {
    renderMarkets()
    expect(screen.getByText('2,400.00 USD')).toBeInTheDocument()
  })
})

describe('MarketsPage — LIVE/HOT/24H LIST/RISE/LOSS tabs', () => {
  it('defaults to the LIVE tab, showing only markets whose real status is live', () => {
    statusFor = (s) => (s === 'BTC/USDT' ? 'live' : 'simulated')
    renderMarkets()
    expect(screen.getByRole('button', { name: /LIVE/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('BTC/USDT')).toBeInTheDocument()
    expect(screen.queryByText('XAU/USD')).not.toBeInTheDocument()
  })

  it('24H LIST shows every market regardless of live status, sorted alphabetically', () => {
    statusFor = (s) => (s === 'BTC/USDT' ? 'live' : 'simulated')
    renderMarkets()
    fireEvent.click(screen.getByRole('button', { name: /24H LIST/ }))
    const rows = screen.getAllByRole('button', { name: /Bitcoin|Gold|Ethereum/ })
    // BTC/USDT, then ETH/USDT, then XAU/USD — alphabetical.
    expect(within(rows[0]).getByText('BTC/USDT')).toBeInTheDocument()
    expect(within(rows[1]).getByText('ETH/USDT')).toBeInTheDocument()
    expect(within(rows[2]).getByText('XAU/USD')).toBeInTheDocument()
  })

  it('RISE only shows gainers (biggest first), LOSS only shows losers', () => {
    statusFor = () => 'live'
    renderMarkets()

    fireEvent.click(screen.getByRole('button', { name: /^RISE/ }))
    const gainers = screen.getAllByRole('button', { name: /Bitcoin|Gold|Ethereum/ })
    expect(gainers).toHaveLength(2)
    expect(within(gainers[0]).getByText('BTC/USDT')).toBeInTheDocument() // +1.2%, biggest gainer first
    expect(within(gainers[1]).getByText('XAU/USD')).toBeInTheDocument() // +0.1%
    expect(screen.queryByText('ETH/USDT')).not.toBeInTheDocument() // -2.5%, excluded

    fireEvent.click(screen.getByRole('button', { name: /^LOSS/ }))
    expect(screen.getByText('ETH/USDT')).toBeInTheDocument()
    expect(screen.queryByText('BTC/USDT')).not.toBeInTheDocument()
    expect(screen.queryByText('XAU/USD')).not.toBeInTheDocument()
  })

  it('HOT ranks by the size of the 24h move regardless of direction', () => {
    statusFor = () => 'live'
    renderMarkets()
    fireEvent.click(screen.getByRole('button', { name: /^HOT/ }))
    const rows = screen.getAllByRole('button', { name: /Bitcoin|Gold|Ethereum/ })
    // ETH/USDT moved -2.5% (biggest absolute move), then BTC/USDT +1.2%, then XAU/USD +0.1%.
    expect(within(rows[0]).getByText('ETH/USDT')).toBeInTheDocument()
    expect(within(rows[1]).getByText('BTC/USDT')).toBeInTheDocument()
    expect(within(rows[2]).getByText('XAU/USD')).toBeInTheDocument()
  })

  it('shows an honest, tab-specific empty state instead of a blank list', () => {
    statusFor = () => 'simulated'
    renderMarkets()
    expect(screen.getByText('No markets are live right now')).toBeInTheDocument()
  })

  it('shows a pill-style 24h change with an up/down arrow next to the price', () => {
    statusFor = () => 'live'
    renderMarkets()
    fireEvent.click(screen.getByRole('button', { name: /24H LIST/ }))
    expect(screen.getByText('+1.20%')).toBeInTheDocument()
    expect(screen.getByText('+0.10%')).toBeInTheDocument()
  })
})
