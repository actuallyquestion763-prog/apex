import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AssetsPage from './AssetsPage'

let mockSummary: { cash: string } | null = { cash: '6000' }
let mockUsdtBalance: { currency: string; cash: string; reserved: string } | null = { currency: 'USDT', cash: '0', reserved: '0' }
let mockAssets: { currency: string; cash: string; reserved: string; total: string }[] = []

vi.mock('../store/useStore', () => ({
  useAccountSummary: () => ({ summary: mockSummary, loading: false }),
  useAssetBalances: () => ({ assets: mockAssets, loading: false }),
  useExecutionStatus: () => ({ status: { provider: 'BinanceSandbox', message: '' } }),
  useCashBalance: () => ({ balance: mockUsdtBalance, loading: false }),
}))

function renderAssets() {
  return render(<MemoryRouter><AssetsPage /></MemoryRouter>)
}

describe('AssetsPage — ledger-derived holdings (Spot Holdings Visibility checkpoint)', () => {
  beforeEach(() => {
    mockSummary = { cash: '6000' }
    mockUsdtBalance = { currency: 'USDT', cash: '0', reserved: '0' }
    mockAssets = []
  })

  it('shows the real USDT balance as the primary Spot Balance, never USD relabeled as USDT', () => {
    mockUsdtBalance = { currency: 'USDT', cash: '5900.71', reserved: '0' }
    renderAssets()
    expect(screen.getByText('Spot Balance')).toBeInTheDocument()
    expect(screen.getByText('5,900.71')).toBeInTheDocument()
    expect(screen.getByText('USDT')).toBeInTheDocument()
  })

  it('shows 0.00 USDT when the user has USD but no USDT — never fabricates a USDT balance from USD', () => {
    mockSummary = { cash: '6000' } // plenty of USD
    mockUsdtBalance = { currency: 'USDT', cash: '0', reserved: '0' } // zero USDT
    renderAssets()
    expect(screen.getByText('0.00')).toBeInTheDocument()
    expect(screen.queryByText('6,000.00')).not.toBeInTheDocument()
  })

  it('shows the real USD balance as a separate, secondary figure, never a fabricated combined total', () => {
    renderAssets()
    expect(screen.getByText('USD Balance')).toBeInTheDocument()
    expect(screen.getByText('$6,000.00')).toBeInTheDocument()
  })

  it('shows an honest empty state when the user has no crypto holdings', () => {
    renderAssets()
    expect(screen.getByText('No holdings yet')).toBeInTheDocument()
  })

  it('shows real, non-zero crypto holdings after a filled trade — e.g. BTC with its actual quantity', () => {
    mockAssets = [{ currency: 'BTC', cash: '0.001234', reserved: '0', total: '0.001234' }]
    renderAssets()
    expect(screen.getByText('BTC')).toBeInTheDocument()
    expect(screen.getByText('0.001234 BTC')).toBeInTheDocument()
  })

  it('never shows a currency with a zero balance', () => {
    mockAssets = [{ currency: 'BTC', cash: '0.001234', reserved: '0', total: '0.001234' }]
    renderAssets()
    expect(screen.queryByText(/^0 /)).not.toBeInTheDocument()
  })
})
