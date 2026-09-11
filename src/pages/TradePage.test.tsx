import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TradePage from './TradePage'
import { ToastProvider } from '../components/Toast'
import type { OptionMarketConfig, OptionTrade } from '../types'

vi.mock('../components/CandlestickChart', () => ({ CandlestickChart: () => <div data-testid="chart" /> }))

vi.mock('../store/priceFeed', () => ({
  SYMBOLS: [{ symbol: 'BTC/USDT', name: 'Bitcoin', base: 65000 }],
  getPrice: () => 65000,
  getMarketStatus: () => 'live',
  getStats24h: () => ({ highPrice: null, lowPrice: null, volume: null, priceChangePercent: null }),
}))

let mockExecutionStatus: { provider: string; message: string } | null = { provider: 'BinanceSandbox', message: 'Sandbox trading — orders are sent to Binance Testnet using test assets. No real funds are used.' }
let mockAssets: { currency: string; cash: string; reserved: string; total: string }[] = []
let mockPositions: Record<string, unknown>[] = []
let mockOrders: Record<string, unknown>[] = []
const mockMarkets = [{ id: 'm1', symbol: 'BTC/USDT', quoteAsset: 'USDT', baseAsset: 'BTC', dataSource: 'LIVE', tradingEnabled: true, maintenanceMode: false, displayName: 'BTC/USDT', marketType: 'CRYPTO_SPOT', enabled: true, pricePrecision: 2, quantityPrecision: 8, provider: null, providerSymbol: null }]

vi.mock('../store/useStore', () => ({
  usePositions: () => ({ positions: mockPositions, refetch: vi.fn() }),
  useOrders: () => ({ orders: mockOrders, refetch: vi.fn() }),
  useMarketConfigs: () => ({ markets: mockMarkets }),
  useExecutionStatus: () => ({ status: mockExecutionStatus }),
  useAssetBalances: () => ({ assets: mockAssets, loading: false, refetch: vi.fn() }),
  computePositionPnl: () => 0,
}))

// Amount-tier trading ticket (Part 30) — the same options-trading backend
// used by src/pages/OptionsPage.tsx, embedded into the /trade order panel.
const BTC_OPTION_MARKET: OptionMarketConfig = {
  symbol: 'BTC/USDT',
  displayName: 'Bitcoin',
  currency: 'USDT',
  minInvestment: '1',
  maxInvestment: null,
  durations: [
    { durationSeconds: 30, payoutPercent: '5', minAmount: '10' },
    { durationSeconds: 60, payoutPercent: '10', minAmount: '50' },
    { durationSeconds: 90, payoutPercent: '15', minAmount: '100' },
  ],
}
let mockOptionMarkets: OptionMarketConfig[] = [BTC_OPTION_MARKET]
let mockOptionBalance: { currency: string; cash: string; reserved: string } | null = { currency: 'USDT', cash: '1000', reserved: '0' }
let mockActiveOptionTrades: OptionTrade[] = []
const mockSubmitOptionTrade = vi.fn()

vi.mock('../store/useOptions', () => ({
  useOptionMarkets: () => ({ markets: mockOptionMarkets, loading: false, error: null, refetch: vi.fn() }),
  useOptionBalance: () => ({ balance: mockOptionBalance, loading: false, error: null, refetch: vi.fn() }),
  useActiveOptionTrades: () => ({ trades: mockActiveOptionTrades, loading: false, error: null, refetch: vi.fn() }),
  submitOptionTrade: (...args: unknown[]) => mockSubmitOptionTrade(...args),
}))

function renderTrade() {
  // Explicit symbol, independent of whatever TradePage's own default is —
  // this suite specifically exercises the BTC/USDT flow (mockMarkets/
  // mockOptionMarkets below only define BTC/USDT), not "whatever the
  // default happens to be".
  return render(<MemoryRouter initialEntries={['/trade?symbol=BTC%2FUSDT']}><ToastProvider><TradePage /></ToastProvider></MemoryRouter>)
}

describe('TradePage — unchanged sections (chart, Spot Holdings, Open Positions, Order History)', () => {
  beforeEach(() => {
    mockExecutionStatus = { provider: 'BinanceSandbox', message: 'Sandbox trading — orders are sent to Binance Testnet using test assets. No real funds are used.' }
    mockAssets = []
    mockPositions = []
    mockOrders = []
    mockOptionMarkets = [BTC_OPTION_MARKET]
    mockOptionBalance = { currency: 'USDT', cash: '1000', reserved: '0' }
    mockActiveOptionTrades = []
    mockSubmitOptionTrade.mockReset().mockResolvedValue({ ok: true, data: { id: 't1' } })
  })

  it('shows a "Spot Holdings" section, separate from "Open Positions", derived from real ledger balances', () => {
    mockAssets = [{ currency: 'BTC', cash: '0.001234', reserved: '0', total: '0.001234' }]
    renderTrade()
    expect(screen.getByText('Spot Holdings')).toBeInTheDocument()
    expect(screen.getByText('BTC')).toBeInTheDocument()
    expect(screen.getByText('0.001234 BTC')).toBeInTheDocument()
  })

  it('Open Positions empty state no longer implies a filled spot trade disappeared', () => {
    mockAssets = [{ currency: 'BTC', cash: '0.001234', reserved: '0', total: '0.001234' }]
    renderTrade()
    expect(screen.getByText(/see Spot Holdings above/i)).toBeInTheDocument()
  })

  it('shows an honest empty state in Spot Holdings when the user has no holdings yet, matching the sandbox environment', () => {
    mockAssets = []
    renderTrade()
    expect(screen.getByText(/Your spot holdings will appear here after a filled trade\./)).toBeInTheDocument()
  })

  it('does not render a broker/exchange execution-status disclaimer anywhere on the page', () => {
    renderTrade()
    expect(screen.queryByText(/Sandbox trading — orders are sent to Binance Testnet/)).not.toBeInTheDocument()
    expect(screen.queryByText(/not yet connected to a broker\/exchange/)).not.toBeInTheDocument()
    expect(screen.queryByText(/No real funds are used/)).not.toBeInTheDocument()
  })

  it('shows a neutral, static page subtitle', () => {
    renderTrade()
    expect(screen.getByText('Trade with your account balance.')).toBeInTheDocument()
  })

  it('shows the Open Positions Quantity without a leading "$" — a quantity is not a currency amount', () => {
    mockPositions = [{ id: 'p1', symbol: 'BTC/USDT', side: 'BUY', quantity: '0.002', avgEntryPrice: '64000', currentPrice: '64500', status: 'OPEN' }]
    renderTrade()
    expect(screen.getByText('0.00')).toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
    expect(screen.getByText('$64000.00')).toBeInTheDocument()
    expect(screen.getByText('$64500.00')).toBeInTheDocument()
  })

  it('shows the Order History Quantity without a leading "$"', () => {
    mockOrders = [{ id: 'o1', symbol: 'BTC/USDT', side: 'BUY', quantity: '0.002', status: 'FILLED', createdAt: new Date().toISOString(), rejectionReason: null }]
    renderTrade()
    expect(screen.getByText('BUY BTC/USDT — 0.00')).toBeInTheDocument()
    expect(screen.queryByText(/— \$0\.00/)).not.toBeInTheDocument()
  })
})

describe('TradePage — amount-tier trading ticket (Part 30)', () => {
  beforeEach(() => {
    mockExecutionStatus = null
    mockAssets = []
    mockPositions = []
    mockOrders = []
    mockOptionMarkets = [BTC_OPTION_MARKET]
    mockOptionBalance = { currency: 'USDT', cash: '1000', reserved: '0' }
    mockActiveOptionTrades = []
    mockSubmitOptionTrade.mockReset().mockResolvedValue({ ok: true, data: { id: 't1' } })
  })

  it('shows the asset name/symbol and no manual duration control — only an amount input', () => {
    renderTrade()
    expect(screen.getByText('Bitcoin')).toBeInTheDocument()
    expect(screen.getByText('BTCUSDT')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^30s$|^60s$|^90s$/ })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Amount USDT')).toBeInTheDocument()
  })

  it('automatically resolves duration and profit from the amount — $75 lands in the $50/60s/10% tier, never the $100 tier', () => {
    renderTrade()
    fireEvent.change(screen.getByPlaceholderText('Amount USDT'), { target: { value: '75' } })
    // Appears twice: once in the read-only tier ladder, once in the Duration/Profit box.
    expect(screen.getAllByText('60s').length).toBeGreaterThan(0)
    expect(screen.getAllByText('10%').length).toBeGreaterThan(0)
    // The ladder lists every configured tier regardless of which is active —
    // 90s is still shown, just not highlighted as the resolved one.
    expect(screen.getAllByText('60s').some((el) => el.getAttribute('aria-current') === 'true')).toBe(true)
    expect(screen.getAllByText('90s').some((el) => el.getAttribute('aria-current') === 'true')).toBe(false)
  })

  it('resolves the top tier at $100 — $100 -> 90s -> 15%, matching the product example exactly', () => {
    renderTrade()
    fireEvent.change(screen.getByPlaceholderText('Amount USDT'), { target: { value: '100' } })
    expect(screen.getAllByText('90s').length).toBeGreaterThan(0)
    expect(screen.getAllByText('15%').length).toBeGreaterThan(0)
  })

  it('disables BUY/SELL and shows an honest hint when the amount is below the lowest tier — never fabricates a duration', () => {
    renderTrade()
    fireEvent.change(screen.getByPlaceholderText('Amount USDT'), { target: { value: '5' } })
    expect(screen.getByRole('button', { name: /Buy — predict/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Sell — predict/ })).toBeDisabled()
    expect(screen.getByText(/Enter at least 10 USDT/)).toBeInTheDocument()
  })

  it('submits a real options trade with the automatically resolved duration when BUY is clicked', async () => {
    renderTrade()
    fireEvent.change(screen.getByPlaceholderText('Amount USDT'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: /Buy — predict/ }))
    await waitFor(() => expect(mockSubmitOptionTrade).toHaveBeenCalledWith({ symbol: 'BTC/USDT', direction: 'BUY', investment: '100', durationSeconds: 90 }))
  })

  it('shows the active trading position (with its Duration/Profit) instead of the entry form once a trade is open on this asset', () => {
    mockActiveOptionTrades = [{
      id: 't1', userId: 'u1', accountId: 'a1', symbol: 'BTC/USDT', direction: 'BUY', investment: '100', currency: 'USDT',
      durationSeconds: 90, payoutPercentSnapshot: '15', entryPrice: '65000', entryPriceTimestamp: new Date().toISOString(), entrySource: 'BINANCE',
      expiryAt: new Date(Date.now() + 90_000).toISOString(), status: 'ACTIVE', requestedResultMode: 'NORMAL',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as unknown as OptionTrade]
    renderTrade()
    expect(screen.getByText('Trading Position')).toBeInTheDocument()
    expect(screen.getByText('15%')).toBeInTheDocument()
    expect(screen.getByText('90s')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Amount USDT')).not.toBeInTheDocument()
  })

  it('shows an honest unavailable state when no options market is configured for the current spot symbol — never fabricates a ticket', () => {
    mockOptionMarkets = []
    renderTrade()
    expect(screen.getByText(/Options trading isn't configured for BTC\/USDT yet/)).toBeInTheDocument()
  })
})
