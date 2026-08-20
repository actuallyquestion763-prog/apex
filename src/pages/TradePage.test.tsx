import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TradePage from './TradePage'
import { ToastProvider } from '../components/Toast'

vi.mock('../components/CandlestickChart', () => ({ CandlestickChart: () => <div data-testid="chart" /> }))

vi.mock('../store/priceFeed', () => ({
  SYMBOLS: [{ symbol: 'BTC/USDT', name: 'Bitcoin', base: 65000 }],
  getPrice: () => 65000,
  getMarketStatus: () => 'live',
  getStats24h: () => ({ highPrice: null, lowPrice: null, volume: null, priceChangePercent: null }),
}))

let mockBalance: { cash: string; currency: string } | null = { cash: '0', currency: 'USDT' }
let mockExecutionStatus: { provider: string; message: string } | null = { provider: 'BinanceSandbox', message: 'Sandbox trading — orders are sent to Binance Testnet using test assets. No real funds are used.' }
let mockAssets: { currency: string; cash: string; reserved: string; total: string }[] = []
const mockMarkets = [{ id: 'm1', symbol: 'BTC/USDT', quoteAsset: 'USDT', baseAsset: 'BTC', dataSource: 'LIVE', tradingEnabled: true, maintenanceMode: false, displayName: 'BTC/USDT', marketType: 'CRYPTO_SPOT', enabled: true, pricePrecision: 2, quantityPrecision: 8, provider: null, providerSymbol: null }]

vi.mock('../store/useStore', () => ({
  usePositions: () => ({ positions: [], refetch: vi.fn() }),
  useOrders: () => ({ orders: [], refetch: vi.fn() }),
  useCashBalance: () => ({ balance: mockBalance, refetch: vi.fn() }),
  useMarketConfigs: () => ({ markets: mockMarkets }),
  useExecutionStatus: () => ({ status: mockExecutionStatus }),
  useAssetBalances: () => ({ assets: mockAssets, loading: false, refetch: vi.fn() }),
  submitOrder: vi.fn(),
  computePositionPnl: () => 0,
}))

function renderTrade() {
  return render(<MemoryRouter><ToastProvider><TradePage /></ToastProvider></MemoryRouter>)
}

describe('TradePage — currency-aware balance and execution status (Trade Experience checkpoint)', () => {
  beforeEach(() => {
    mockBalance = { cash: '0', currency: 'USDT' }
    mockExecutionStatus = { provider: 'BinanceSandbox', message: 'Sandbox trading — orders are sent to Binance Testnet using test assets. No real funds are used.' }
    mockAssets = []
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

  it('shows the amount input labeled with the market\'s real quote asset, never a hardcoded "Amount (USD)"', () => {
    renderTrade()
    expect(screen.getByText('Amount (USDT)')).toBeInTheDocument()
    expect(screen.queryByText('Amount (USD)')).not.toBeInTheDocument()
  })

  it('shows the available balance in the market\'s quote currency, not a bare "$" figure', () => {
    mockBalance = { cash: '0.00', currency: 'USDT' }
    renderTrade()
    expect(screen.getByText(/0\.00 USDT/)).toBeInTheDocument()
  })

  it('shows a clear insufficient-balance message (not "$6,000 available") when the entered amount exceeds the real USDT balance', () => {
    mockBalance = { cash: '0', currency: 'USDT' }
    renderTrade()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '100' } })
    expect(screen.getByText(/Insufficient balance: 100 USDT required, 0 USDT available/)).toBeInTheDocument()
  })

  it('disables BUY/SELL when the entered amount exceeds the available balance', () => {
    mockBalance = { cash: '0', currency: 'USDT' }
    renderTrade()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '100' } })
    expect(screen.getByRole('button', { name: 'BUY' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'SELL' })).toBeDisabled()
  })

  it('enables BUY/SELL when the entered amount is within the available balance', () => {
    mockBalance = { cash: '500', currency: 'USDT' }
    renderTrade()
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '100' } })
    expect(screen.getByRole('button', { name: 'BUY' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'SELL' })).not.toBeDisabled()
  })

  it('does not render a broker/exchange execution-status disclaimer anywhere on the order panel', () => {
    renderTrade()
    expect(screen.queryByText(/Sandbox trading — orders are sent to Binance Testnet/)).not.toBeInTheDocument()
    expect(screen.queryByText(/not yet connected to a broker\/exchange/)).not.toBeInTheDocument()
    expect(screen.queryByText(/No real funds are used/)).not.toBeInTheDocument()
  })

  it('does not render a broker/exchange execution-status disclaimer when the provider is Fake', () => {
    mockExecutionStatus = { provider: 'Fake', message: 'Simulation mode — orders are simulated locally and do not reach an exchange.' }
    renderTrade()
    expect(screen.queryByText(/Simulation mode — orders are simulated locally/)).not.toBeInTheDocument()
  })

  it('shows a neutral, static page subtitle regardless of execution status', () => {
    renderTrade()
    expect(screen.getByText('Trade with your account balance.')).toBeInTheDocument()
  })
})
