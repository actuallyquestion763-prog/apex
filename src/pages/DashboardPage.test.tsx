import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DashboardPage } from './DashboardPage'
import { ToastProvider } from '../components/Toast'

vi.mock('../store/priceFeed', () => ({
  getPrice: () => 65000,
  getMarketStatus: () => 'live',
  getMarketMeta: () => ({ name: 'Bitcoin', base: 65000 }),
  snapshot: () => [],
}))

let mockUsdtBalance: { currency: string; cash: string; reserved: string } | null = { currency: 'USDT', cash: '0', reserved: '0' }

vi.mock('../store/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', fullName: 'Test User', referralCode: 'TEST1234', status: 'ACTIVE' } }),
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
  useAccountSummary: () => ({ summary: null, loading: false, error: null }),
  useCashBalance: () => ({ balance: mockUsdtBalance, loading: false }),
  useMarketConfigs: () => ({ markets: [market('BTC/USDT', 'USDT', 'BTC'), market('XAU/USD', 'USD', 'XAU')] }),
}))

function renderDashboard() {
  return render(<MemoryRouter><ToastProvider><DashboardPage /></ToastProvider></MemoryRouter>)
}

describe('DashboardPage — USDT primary Spot Balance (USDT Primary Currency UX checkpoint)', () => {
  beforeEach(() => {
    mockUsdtBalance = { currency: 'USDT', cash: '0', reserved: '0' }
  })

  it('shows the real USDT balance as the primary Spot Balance', () => {
    mockUsdtBalance = { currency: 'USDT', cash: '5900.71', reserved: '0' }
    renderDashboard()
    expect(screen.getByText('Spot Balance')).toBeInTheDocument()
    expect(screen.getByText('5,900.71 USDT')).toBeInTheDocument()
  })

  it('shows 0.00 USDT when the user has no USDT — never fabricates a balance', () => {
    mockUsdtBalance = { currency: 'USDT', cash: '0', reserved: '0' }
    renderDashboard()
    expect(screen.getByText('0.00 USDT')).toBeInTheDocument()
  })

  it('builds the referral link from the real page origin, never a hardcoded domain', () => {
    renderDashboard()
    expect(screen.getByText(`${window.location.origin}/r/TEST1234`)).toBeInTheDocument()
    expect(screen.queryByText(/trust\.io/)).not.toBeInTheDocument()
  })

  it('does not claim an unsupported referral commission (P1-6)', () => {
    renderDashboard()
    expect(screen.queryByText(/10% commission/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Share this link with others.')).toBeInTheDocument()
  })

  it('labels a USDT-quoted trending market with USDT, not a bare "$" (P1-3)', () => {
    renderDashboard()
    expect(screen.getAllByText('65,000 USDT').length).toBeGreaterThan(0)
  })

  it('labels a USD-quoted trending market with USD, preserving existing USD behavior (P1-3)', () => {
    renderDashboard()
    expect(screen.getAllByText('65,000 USD').length).toBeGreaterThan(0)
  })

  it('no longer shows the USD summary cards, Spot Holdings, quick actions, or Open Positions preview — removed per operator request', () => {
    renderDashboard()
    expect(screen.queryByText('USD Balance')).not.toBeInTheDocument()
    expect(screen.queryByText('USD Available Balance')).not.toBeInTheDocument()
    expect(screen.queryByText('Spot Holdings')).not.toBeInTheDocument()
    expect(screen.queryByText('Deposit')).not.toBeInTheDocument()
    expect(screen.queryByText('Withdraw')).not.toBeInTheDocument()
    expect(screen.queryByText(/Open Positions/)).not.toBeInTheDocument()
  })
})
