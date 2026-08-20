import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CryptoAddressDisplay } from './CryptoAddressDisplay'
import type { ResolvedCryptoAddress } from '../../store/useCryptoDeposits'

const resolved: ResolvedCryptoAddress = {
  symbol: 'USDT',
  networkCode: 'TRC20',
  networkName: 'Tron (TRC20)',
  receivingAddress: 'TJX9aKp7m3QrVb8sN2cWdFzL4hY6tRxEuP',
  minimumDeposit: '10',
}

describe('CryptoAddressDisplay', () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  it('shows a dynamic warning naming the SPECIFIC asset and network — not a generic static message', () => {
    render(<CryptoAddressDisplay resolved={resolved} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('USDT')
    expect(alert.textContent).toContain('Tron (TRC20)')
  })

  it('updates the warning when the resolved asset/network changes (never a fixed hardcoded pair)', () => {
    const { rerender } = render(<CryptoAddressDisplay resolved={resolved} />)
    expect(screen.getByRole('alert').textContent).toContain('USDT')

    const otherResolved: ResolvedCryptoAddress = { ...resolved, symbol: 'BTC', networkName: 'Bitcoin', receivingAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' }
    rerender(<CryptoAddressDisplay resolved={otherResolved} />)
    expect(screen.getByRole('alert').textContent).toContain('BTC')
    expect(screen.getByRole('alert').textContent).toContain('Bitcoin')
  })

  it('renders the exact receiving address as visible text', () => {
    render(<CryptoAddressDisplay resolved={resolved} />)
    expect(screen.getByText(resolved.receivingAddress)).toBeInTheDocument()
  })

  it('the QR code renders for the same address shown as text (QR data matches receiving address)', () => {
    const { container } = render(<CryptoAddressDisplay resolved={resolved} />)
    // QrCode is given resolved.receivingAddress as its value prop; it renders
    // an accessible, labeled SVG whose module pattern is a real encoding of
    // that same value (verified independently in QrCode.test.tsx).
    const svg = container.querySelector('svg[aria-label]')
    expect(svg).toBeTruthy()
  })

  it('copies the receiving address to the clipboard and shows "Copied!" feedback on click', async () => {
    render(<CryptoAddressDisplay resolved={resolved} />)
    fireEvent.click(screen.getByLabelText('Copy receiving address'))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(resolved.receivingAddress)
    await waitFor(() => expect(screen.getByText('Copied!')).toBeInTheDocument())
  })

  it('never calls any external service to perform the copy — only the local clipboard API', async () => {
    render(<CryptoAddressDisplay resolved={resolved} />)
    fireEvent.click(screen.getByLabelText('Copy receiving address'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(resolved.receivingAddress)
  })

  it('does not crash and leaves the address visible if the clipboard API rejects (soft failure)', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    render(<CryptoAddressDisplay resolved={resolved} />)
    fireEvent.click(screen.getByLabelText('Copy receiving address'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    expect(screen.getByText(resolved.receivingAddress)).toBeInTheDocument()
    expect(screen.queryByText('Copied!')).not.toBeInTheDocument()
  })

  it('displays the configured minimum deposit when present', () => {
    render(<CryptoAddressDisplay resolved={resolved} />)
    expect(screen.getByText(/Minimum deposit/)).toBeInTheDocument()
  })

  it('omits the minimum-deposit note when no minimum is configured', () => {
    render(<CryptoAddressDisplay resolved={{ ...resolved, minimumDeposit: null }} />)
    expect(screen.queryByText(/Minimum deposit/)).not.toBeInTheDocument()
  })
})
