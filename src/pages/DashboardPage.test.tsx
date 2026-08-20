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

let mockSummary: { cash: string; equity: string; unrealizedPnl: string } | null = { cash: '6000', equity: '6000', unrealizedPnl: '0' }
let mockUsdtBalance: { currency: string; cash: string; reserved: string } | null = { currency: 'USDT', cash: '0', reserved: '0' }
let mockAssets: { currency: string; cash: string; reserved: string; total: string }[] = []

vi.mock('../store/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', fullName: 'Test User', referralCode: 'TEST1234', status: 'ACTIVE' } }),
}))

vi.mock('../store/useStore', () => ({
  useAccountSummary: () => ({ summary: mockSummary, loading: false, error: null }),
  useCashBalance: () => ({ balance: mockUsdtBalance, loading: false }),
  useAssetBalances: () => ({ assets: mockAssets, loading: false }),
  useExecutionStatus: () => ({ status: { provider: 'BinanceSandbox', message: '' } }),
  usePositions: () => ({ positions: [] }),
  computePositionPnl: () => 0,
}))

function renderDashboard() {
  return render(<MemoryRouter><ToastProvider><DashboardPage /></ToastProvider></MemoryRouter>)
}

describe('DashboardPage — USDT primary Spot Balance (USDT Primary Currency UX checkpoint)', () => {
  beforeEach(() => {
    mockSummary = { cash: '6000', equity: '6000', unrealizedPnl: '0' }
    mockUsdtBalance = { currency: 'USDT', cash: '0', reserved: '0' }
    mockAssets = []
  })

  it('shows the real USDT balance as the primary Spot Balance', () => {
    mockUsdtBalance = { currency: 'USDT', cash: '5900.71', reserved: '0' }
    renderDashboard()
    expect(screen.getByText('Spot Balance')).toBeInTheDocument()
    expect(screen.getByText('5,900.71 USDT')).toBeInTheDocument()
  })

  it('shows 0.00 USDT when the user has USD but no USDT — never fabricates a USDT balance from USD', () => {
    mockSummary = { cash: '6000', equity: '6000', unrealizedPnl: '0' } // plenty of USD
    mockUsdtBalance = { currency: 'USDT', cash: '0', reserved: '0' } // zero USDT
    renderDashboard()
    expect(screen.getByText('0.00 USDT')).toBeInTheDocument()
    expect(screen.queryByText('6,000.00 USDT')).not.toBeInTheDocument()
  })

  it('shows the USD summary cards as clearly-labeled, separate USD figures', () => {
    renderDashboard()
    expect(screen.getByText('USD Balance')).toBeInTheDocument()
    expect(screen.getByText('USD Available Balance')).toBeInTheDocument()
  })

  it('shows a Spot Holdings section reusing the shared SpotHoldings component', () => {
    mockAssets = [{ currency: 'BTC', cash: '0.00138', reserved: '0', total: '0.00138' }]
    renderDashboard()
    expect(screen.getByText('Spot Holdings')).toBeInTheDocument()
    expect(screen.getByText('0.00138 BTC')).toBeInTheDocument()
  })
})
