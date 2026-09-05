import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { WithdrawPage } from './WithdrawPage'
import { ToastProvider } from '../components/Toast'
import type { CryptoAssetConfig } from '../store/useCryptoDeposits'
import type { Withdrawal } from '../types'

let mockBalance: { currency: string; cash: string; reserved: string } | null = { currency: 'USDT', cash: '500', reserved: '0' }
let mockAssets: CryptoAssetConfig[] = []
let mockWithdrawals: Withdrawal[] = []
const submitWithdrawal = vi.fn()
const pushLocalNotification = vi.fn()

vi.mock('../store/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', fullName: 'Test User', referralCode: 'TEST1234', status: 'ACTIVE' } }),
}))

vi.mock('../store/useStore', () => ({
  useCashBalance: () => ({ balance: mockBalance, refetch: vi.fn() }),
  useWithdrawals: () => ({ withdrawals: mockWithdrawals, refetch: vi.fn() }),
  submitWithdrawal: (...args: unknown[]) => submitWithdrawal(...args),
  pushLocalNotification: (...args: unknown[]) => pushLocalNotification(...args),
}))

vi.mock('../store/useCryptoDeposits', () => ({
  useCryptoAssets: () => ({ assets: mockAssets }),
}))

const USDT: CryptoAssetConfig = {
  symbol: 'USDT',
  name: 'Tether',
  networks: [
    { networkCode: 'TRC20', networkName: 'Tron (TRC20)', minimumDeposit: '10' },
    { networkCode: 'ERC20', networkName: 'Ethereum (ERC20)', minimumDeposit: null },
  ],
}

function renderPage() {
  return render(<ToastProvider><WithdrawPage /></ToastProvider>)
}

describe('WithdrawPage — USDT-only withdrawal flow (P1-4)', () => {
  beforeEach(() => {
    mockBalance = { currency: 'USDT', cash: '500', reserved: '0' }
    mockAssets = [USDT]
    mockWithdrawals = []
    submitWithdrawal.mockReset().mockResolvedValue({ ok: true, data: { id: 'w1', status: 'PENDING' } })
    pushLocalNotification.mockReset()
  })

  it('never shows Bank Transfer or Credit Card as withdrawal options', () => {
    renderPage()
    expect(screen.queryByText('Bank Transfer')).not.toBeInTheDocument()
    expect(screen.queryByText('Credit / Debit Card')).not.toBeInTheDocument()
    expect(screen.queryByText('Credit Card')).not.toBeInTheDocument()
  })

  it('labels the amount field "Amount (USDT)", never "Amount (USD)"', () => {
    renderPage()
    expect(screen.getByText('Amount (USDT)')).toBeInTheDocument()
    expect(screen.queryByText('Amount (USD)')).not.toBeInTheDocument()
  })

  it('shows the real, backend-configured USDT networks — not a hardcoded list', () => {
    renderPage()
    const select = screen.getByLabelText('Network') as HTMLSelectElement
    expect(select).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Tron (TRC20)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Ethereum (ERC20)' })).toBeInTheDocument()
  })

  it('shows an honest "not configured" state when USDT has no networks configured — never fabricates one', () => {
    mockAssets = []
    renderPage()
    expect(screen.getByText('No networks are currently configured for this asset.')).toBeInTheDocument()
  })

  it('shows the real USDT balance, not a USD figure', () => {
    mockBalance = { currency: 'USDT', cash: '1234.5', reserved: '0' }
    renderPage()
    expect(screen.getByText('1,234.50 USDT')).toBeInTheDocument()
  })

  it('submits the withdrawal with currency USDT', async () => {
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('Your USDT wallet address'), { target: { value: 'TDestAddress123' } })
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: /Submit withdrawal request/ }))
    await waitFor(() => expect(submitWithdrawal).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 50, currency: 'USDT', destination: expect.stringContaining('TDestAddress123') }),
    ))
  })

  it('shows each withdrawal\'s real currency in its history row, not a bare "$"', () => {
    mockWithdrawals = [{ id: 'w1', userId: 'u1', amount: '75.00', currency: 'USDT', destination: 'USDT (Tron (TRC20)): TAddr', status: 'PENDING', createdAt: new Date().toISOString(), completedAt: null }]
    renderPage()
    expect(screen.getByText('75.00 USDT')).toBeInTheDocument()
  })

  it('keeps the honest fictional-platform disclosure', () => {
    renderPage()
    expect(screen.getByText(/TRUST is a fictional demonstration platform/)).toBeInTheDocument()
  })
})
