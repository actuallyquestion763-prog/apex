import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DepositPage } from './DepositPage'
import { ToastProvider } from '../components/Toast'
import type { CryptoAssetConfig, ResolvedCryptoAddress } from '../store/useCryptoDeposits'

let mockAssets: CryptoAssetConfig[] = []
let mockAssetsLoading = false
let mockResolved: ResolvedCryptoAddress | null = null
const submitCryptoDeposit = vi.fn()
const uploadDepositProof = vi.fn()

vi.mock('../store/useCryptoDeposits', () => ({
  useCryptoAssets: () => ({ assets: mockAssets, loading: mockAssetsLoading }),
  useResolvedCryptoAddress: () => ({ resolved: mockResolved, loading: false, error: null }),
  submitCryptoDeposit: (...args: unknown[]) => submitCryptoDeposit(...args),
  uploadDepositProof: (...args: unknown[]) => uploadDepositProof(...args),
}))

const USDT: CryptoAssetConfig = {
  symbol: 'USDT',
  name: 'Tether',
  networks: [
    { networkCode: 'TRC20', networkName: 'Tron (TRC20)', minimumDeposit: '10' },
    { networkCode: 'ERC20', networkName: 'Ethereum (ERC20)', minimumDeposit: null },
  ],
}
const BTC: CryptoAssetConfig = {
  symbol: 'BTC',
  name: 'Bitcoin',
  networks: [{ networkCode: 'BTC', networkName: 'Bitcoin', minimumDeposit: null }],
}
const RESOLVED: ResolvedCryptoAddress = {
  symbol: 'USDT',
  networkCode: 'TRC20',
  networkName: 'Tron (TRC20)',
  receivingAddress: 'TJX9aKp7m3QrVb8sN2cWdFzL4hY6tRxEuP',
  minimumDeposit: '10',
}

function renderPage() {
  return render(<ToastProvider><DepositPage /></ToastProvider>)
}

describe('DepositPage — multi-asset crypto deposit', () => {
  beforeEach(() => {
    mockAssets = [USDT, BTC]
    mockAssetsLoading = false
    mockResolved = RESOLVED
    submitCryptoDeposit.mockReset().mockResolvedValue({ ok: true, data: { id: 'dep_1' } })
    uploadDepositProof.mockReset()
  })

  it('opens directly into the crypto deposit experience — no tabs, no Internal Transfer', () => {
    renderPage()
    expect(screen.getByText('Deposit Crypto')).toBeInTheDocument()
    expect(screen.getByText('Fund your account with crypto.')).toBeInTheDocument()
    expect(screen.queryByText('Internal Transfer')).not.toBeInTheDocument()
    expect(screen.queryByText('Bank Transfer')).not.toBeInTheDocument()
    expect(screen.queryByText('Credit / Debit Card')).not.toBeInTheDocument()
  })

  it('shows a real asset selector listing every backend-configured crypto, defaulting to the first', () => {
    renderPage()
    const trigger = screen.getByLabelText('Crypto')
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveTextContent('USDT')
    fireEvent.click(trigger)
    expect(screen.getByRole('option', { name: 'USDT' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'BTC' })).toBeInTheDocument()
  })

  it('switching the asset selector switches which asset/network is used', async () => {
    renderPage()
    fireEvent.click(screen.getByLabelText('Crypto'))
    fireEvent.click(screen.getByRole('option', { name: 'BTC' }))
    await waitFor(() => expect(screen.getByLabelText('Crypto')).toHaveTextContent('BTC'))
    expect(screen.getByRole('option', { name: 'Bitcoin' })).toBeInTheDocument()
  })

  it('shows a real network selector driven by the backend-configured networks', () => {
    renderPage()
    const select = screen.getByLabelText('Network') as HTMLSelectElement
    expect(select).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Tron (TRC20)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Ethereum (ERC20)' })).toBeInTheDocument()
  })

  it('displays the real backend-provided deposit address and minimum deposit', () => {
    renderPage()
    expect(screen.getByText(RESOLVED.receivingAddress)).toBeInTheDocument()
    expect(screen.getByText(/Minimum deposit/)).toBeInTheDocument()
  })

  it('labels the amount field "Amount (USDT)" and shows a USDT suffix — never USD', () => {
    renderPage()
    expect(screen.getByText('Amount (USDT)')).toBeInTheDocument()
    expect(screen.queryByText('Amount (USD)')).not.toBeInTheDocument()
    expect(screen.queryByText('$100')).not.toBeInTheDocument()
    expect(screen.queryByText('$500')).not.toBeInTheDocument()
    expect(screen.queryByText('$1000')).not.toBeInTheDocument()
    expect(screen.queryByText('$5000')).not.toBeInTheDocument()
  })

  it('never shows the fiat bonus banner, "Total credit", or a USD current-balance line', () => {
    renderPage()
    expect(screen.queryByText(/get 20% bonus/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Total credit')).not.toBeInTheDocument()
    expect(screen.queryByText(/Bonus \(20%\)/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Current balance/)).not.toBeInTheDocument()
  })

  it('shows the optional deposit proof upload, matching existing (non-mandatory) backend behavior', () => {
    renderPage()
    expect(screen.getByText('Upload Proof (optional)')).toBeInTheDocument()
  })

  it('submits through the existing crypto deposit API with the real symbol/network/amount', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Amount (USDT)'), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: /Submit Deposit/ }))
    await waitFor(() => expect(submitCryptoDeposit).toHaveBeenCalledWith({ amount: '25', cryptoAssetSymbol: 'USDT', networkCode: 'TRC20' }))
  })

  it('shows an honest unavailable state when no crypto asset is configured/enabled at all — never a fabricated one', () => {
    mockAssets = []
    renderPage()
    expect(screen.getByText('Crypto deposits are currently unavailable.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Crypto')).not.toBeInTheDocument()
  })

  it('still offers a single configured asset (e.g. only BTC enabled) rather than treating it as unavailable', () => {
    mockAssets = [BTC]
    renderPage()
    const trigger = screen.getByLabelText('Crypto')
    expect(trigger).toHaveTextContent('BTC')
    fireEvent.click(trigger)
    expect(screen.getByRole('option', { name: 'BTC' })).toBeInTheDocument()
  })

  it('shows a loading state while the asset list is being fetched', () => {
    mockAssetsLoading = true
    renderPage()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })
})
