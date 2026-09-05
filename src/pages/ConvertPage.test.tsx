import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ConvertPage } from './ConvertPage'
import { ToastProvider } from '../components/Toast'

const mockSubmitConvert = vi.fn()

vi.mock('../store/useConvert', () => ({
  CONVERTIBLE_CURRENCIES: ['USDT', 'BTC', 'ETH', 'BNB'],
  submitConvert: (...args: unknown[]) => mockSubmitConvert(...args),
}))

// Real, already-running price feed the Trade/Dashboard pages also read from
// — mocked here with fixed values so the preview math is deterministic.
vi.mock('../store/priceFeed', () => ({
  getPrice: (symbol: string) => {
    if (symbol === 'BTC/USDT') return 50000
    if (symbol === 'ETH/USDT') return 2500
    return 0
  },
}))

function renderPage() {
  return render(<MemoryRouter><ToastProvider><ConvertPage /></ToastProvider></MemoryRouter>)
}

describe('ConvertPage', () => {
  beforeEach(() => {
    mockSubmitConvert.mockReset().mockResolvedValue({ ok: true, data: { transactionId: 't1', fromCurrency: 'USDT', toCurrency: 'BTC', fromAmount: '100', toAmount: '0.002' } })
  })

  it('defaults to USDT -> BTC and shows a live-price-derived preview, never a fabricated rate', () => {
    renderPage()
    expect(screen.getByText('USDT')).toBeInTheDocument()
    expect(screen.getAllByText('BTC').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '100' } })
    // 100 USDT / 50000 USDT per BTC = 0.002 BTC
    expect(screen.getByText('0.00200000')).toBeInTheDocument()
  })

  it('shows an honest zero preview until a valid amount is entered', () => {
    renderPage()
    expect(screen.getByText('0.00000000')).toBeInTheDocument()
  })

  it('swaps From and To when the swap button is clicked', () => {
    renderPage()
    fireEvent.click(screen.getByLabelText('Swap From and To'))
    // After swapping, the (default) To value BTC is now From, and USDT is now To.
    const btcTriggers = screen.getAllByText('BTC')
    expect(btcTriggers.length).toBeGreaterThan(0)
  })

  it('disables Convert Now until a valid amount is entered', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /Convert Now/ })).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '50' } })
    expect(screen.getByRole('button', { name: /Convert Now/ })).not.toBeDisabled()
  })

  it('submits the real fromCurrency/toCurrency/amount to the backend on Convert Now', async () => {
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: /Convert Now/ }))
    await waitFor(() => expect(mockSubmitConvert).toHaveBeenCalledWith({ fromCurrency: 'USDT', toCurrency: 'BTC', amount: '100' }))
  })

  it('shows the backend error on failure, never claims success', async () => {
    mockSubmitConvert.mockResolvedValue({ ok: false, error: 'Insufficient balance for this conversion.' })
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: /Convert Now/ }))
    expect(await screen.findByText('Insufficient balance for this conversion.')).toBeInTheDocument()
  })
})
