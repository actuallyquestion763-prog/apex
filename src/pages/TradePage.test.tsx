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

// Seven-tier amount-based duration system (final trading spec) — this IS
// the /trade ticket, not an embedded copy of a separate product; same
// values as prisma/seed.ts's OPTION_TIERS.
const BTC_OPTION_MARKET: OptionMarketConfig = {
  symbol: 'BTC/USDT',
  displayName: 'Bitcoin',
  currency: 'USDT',
  minInvestment: '500',
  maxInvestment: null, // no platform-wide cap — the top tier ($250,000.01+) is unbounded
  durations: [
    { durationSeconds: 30, payoutPercent: '10', minAmount: '500' },
    { durationSeconds: 60, payoutPercent: '12', minAmount: '1000.01' },
    { durationSeconds: 120, payoutPercent: '15', minAmount: '5000.01' },
    { durationSeconds: 300, payoutPercent: '18', minAmount: '10000.01' },
    { durationSeconds: 600, payoutPercent: '22', minAmount: '50000.01' },
    { durationSeconds: 900, payoutPercent: '25', minAmount: '100000.01' },
    { durationSeconds: 1800, payoutPercent: '30', minAmount: '250000.01' },
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

describe('TradePage — seven-tier amount-based trading ticket (final trading spec)', () => {
  beforeEach(() => {
    mockExecutionStatus = null
    mockAssets = []
    mockPositions = []
    mockOrders = []
    mockOptionMarkets = [BTC_OPTION_MARKET]
    mockOptionBalance = { currency: 'USDT', cash: '1000000', reserved: '0' }
    mockActiveOptionTrades = []
    mockSubmitOptionTrade.mockReset().mockResolvedValue({ ok: true, data: { id: 't1' } })
  })

  function amountField() {
    return screen.getByPlaceholderText('Enter amount ($500 and above)')
  }

  it('shows the asset name/symbol, a Step 2 amount field with no upper cap, and no manual duration control', () => {
    renderTrade()
    expect(screen.getByText('Bitcoin')).toBeInTheDocument()
    expect(screen.getByText('BTCUSDT')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^30 Seconds$|^1 Minute$/ })).not.toBeInTheDocument()
    expect(amountField()).toBeInTheDocument()
  })

  it('shows a quick-amount button for every tier boundary', () => {
    renderTrade()
    for (const label of ['$500', '$1K', '$5K', '$10K', '$50K', '$100K']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('automatically resolves duration and ROI from the amount — $7,000 lands in the $5,000.01–$10,000 / 2 Minutes / 15% tier', () => {
    renderTrade()
    fireEvent.change(amountField(), { target: { value: '7000' } })
    expect(screen.getByText('2 Minutes').closest('[aria-current]')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('ROI: 15%')).toBeInTheDocument()
  })

  it('resolves the boundary examples from the spec exactly: $1,000 -> 30 Seconds, $1,001 -> 1 Minute', () => {
    renderTrade()
    fireEvent.change(amountField(), { target: { value: '1000' } })
    expect(screen.getByText('30 Seconds').closest('[aria-current]')).toHaveAttribute('aria-current', 'true')

    fireEvent.change(amountField(), { target: { value: '1001' } })
    expect(screen.getByText('1 Minute').closest('[aria-current]')).toHaveAttribute('aria-current', 'true')
  })

  it('has no upper cap — $750,000 (above the old $500,000 ceiling) still resolves to the top tier with no "maximum investment" error', () => {
    renderTrade()
    fireEvent.change(amountField(), { target: { value: '750000' } })
    expect(screen.getByText('30 Minutes').closest('[aria-current]')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('ROI: 30%')).toBeInTheDocument()
    expect(screen.queryByText(/Maximum investment/i)).not.toBeInTheDocument()
  })

  it('shows the top tier as open-ended ("$250.0K+") since the market has no maxInvestment', () => {
    renderTrade()
    expect(screen.getByText('$250.0K+')).toBeInTheDocument()
  })

  it('disables UP/DOWN and shows an honest hint when the amount is below the lowest tier — never fabricates a duration', () => {
    renderTrade()
    fireEvent.change(amountField(), { target: { value: '499' } })
    expect(screen.getByRole('button', { name: /Up — predict/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Down — predict/ })).toBeDisabled()
    expect(screen.getByText(/Enter at least 500 USDT/)).toBeInTheDocument()
  })

  it('clicking UP only selects the direction — it does not submit the trade', () => {
    renderTrade()
    fireEvent.change(amountField(), { target: { value: '10000' } })
    fireEvent.click(screen.getByRole('button', { name: /Up — predict/ }))
    expect(mockSubmitOptionTrade).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Up — predict/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows the Trade Summary (Investment / Potential Profit / Total Return) only once amount, duration, AND direction are all selected', () => {
    renderTrade()
    fireEvent.change(amountField(), { target: { value: '10000' } })
    expect(screen.queryByText('Trade Summary')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Up — predict/ }))
    expect(screen.getByText('Trade Summary')).toBeInTheDocument()
    // $10,000 -> 2 Minutes -> 15% ROI (exactly on the boundary belongs to
    // the LOWER tier — $10,001 is what unlocks 5 Minutes/18%, per the spec)
    // -> profit $1,500, return $11,500
    expect(screen.getByText('10,000.00 USDT')).toBeInTheDocument()
    expect(screen.getByText('+1,500.00 USDT')).toBeInTheDocument()
    expect(screen.getByText('11,500.00 USDT')).toBeInTheDocument()
  })

  it('changing the amount after selecting a direction clears the stale direction — Place Trade cannot fire against an outdated tier', () => {
    renderTrade()
    fireEvent.change(amountField(), { target: { value: '10000' } })
    fireEvent.click(screen.getByRole('button', { name: /Up — predict/ }))
    expect(screen.getByRole('button', { name: /Up — predict/ })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.change(amountField(), { target: { value: '75000' } })
    expect(screen.getByRole('button', { name: /Up — predict/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('Trade Summary')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PLACE TRADE' })).toBeDisabled()
  })

  it('Place Trade submits Market + Amount + Duration + Direction together, only after all three are selected', async () => {
    renderTrade()
    fireEvent.change(amountField(), { target: { value: '10000' } })
    expect(screen.getByRole('button', { name: 'PLACE TRADE' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Up — predict/ }))
    expect(screen.getByRole('button', { name: 'PLACE TRADE' })).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'PLACE TRADE' }))
    await waitFor(() => expect(mockSubmitOptionTrade).toHaveBeenCalledWith({ symbol: 'BTC/USDT', direction: 'BUY', investment: '10000', durationSeconds: 120 }))
  })

  it('shows the active trading position instead of the entry form once a trade is open on this asset', () => {
    mockActiveOptionTrades = [{
      id: 't1', userId: 'u1', accountId: 'a1', symbol: 'BTC/USDT', direction: 'BUY', investment: '10000', currency: 'USDT',
      durationSeconds: 300, payoutPercentSnapshot: '18', entryPrice: '65000', entryPriceTimestamp: new Date().toISOString(), entrySource: 'BINANCE',
      expiryAt: new Date(Date.now() + 300_000).toISOString(), status: 'ACTIVE', requestedResultMode: 'NORMAL',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as unknown as OptionTrade]
    renderTrade()
    expect(screen.getByText('Trading Position')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Enter amount ($500 and above)')).not.toBeInTheDocument()
  })

  it('shows an honest unavailable state when no options market is configured for the current spot symbol — never fabricates a ticket', () => {
    mockOptionMarkets = []
    renderTrade()
    expect(screen.getByText(/Options trading isn't configured for BTC\/USDT yet/)).toBeInTheDocument()
  })
})
