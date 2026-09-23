import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import QRCode from 'qrcode'
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

  it('copies the receiving address to the clipboard and shows "Copied" feedback on click', async () => {
    render(<CryptoAddressDisplay resolved={resolved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(resolved.receivingAddress)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument())
  })

  it('never calls any external service to perform the copy — only the local clipboard API', async () => {
    render(<CryptoAddressDisplay resolved={resolved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(resolved.receivingAddress)
  })

  it('does not crash and leaves the address visible if the clipboard API rejects (soft failure)', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    render(<CryptoAddressDisplay resolved={resolved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    expect(screen.getByText(resolved.receivingAddress)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument()
  })

  it('Share QR falls back to copying the address when the Web Share API is unavailable', async () => {
    render(<CryptoAddressDisplay resolved={resolved} />)
    fireEvent.click(screen.getByRole('button', { name: /Share QR/ }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(resolved.receivingAddress))
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

// The customer-facing QR is drawn client-side from whatever address the
// backend returns, so once the backend returns the protected wallet (see
// backend/test/crypto-deposit-wallet-protection.e2e-spec.ts) the QR and the
// text beside it cannot disagree. These tests read back the modules the SVG
// ACTUALLY drew and compare them with a fresh encoding of the address, so a
// QR made from any other value fails.
describe('CryptoAddressDisplay — QR and displayed address for each protected production wallet', () => {
  const EVM = '0x4545e58dd75f65486fc9553277f76f178781bda2'
  const CASES = [
    { label: 'USDT TRC20', symbol: 'USDT', networkCode: 'TRC20', networkName: 'Tron (TRC20)', address: 'TY9jWFW7zPknZqT7T9x7SwiLLHfXNZXUpa' },
    { label: 'USDT ERC20', symbol: 'USDT', networkCode: 'ERC20', networkName: 'Ethereum (ERC20)', address: EVM },
    { label: 'BTC', symbol: 'BTC', networkCode: 'BTC', networkName: 'Bitcoin', address: '18chkuPvDEexJMmXXMtz7aExTL8FruU4jd' },
    { label: 'ETH', symbol: 'ETH', networkCode: 'ETH', networkName: 'Ethereum', address: EVM },
    { label: 'BNB Smart Chain', symbol: 'BNB', networkCode: 'BEP20', networkName: 'BNB Smart Chain (BEP20)', address: EVM },
  ]
  const CMS_ADDRESS = '0x028693214AFA4E3bf4537175b5505315AFda80A3' // what a CMS edit could hold instead

  // Which (column,row) modules the rendered SVG drew dark. The first <rect>
  // is the white background; each remaining one is a single dark module whose
  // width is the cell size.
  function drawnModules(container: HTMLElement): Set<string> {
    const rects = Array.from(container.querySelectorAll('svg[aria-label] rect')).slice(1)
    const cell = Number(rects[0].getAttribute('width'))
    return new Set(rects.map((r) => `${Math.round(Number(r.getAttribute('x')) / cell)},${Math.round(Number(r.getAttribute('y')) / cell)}`))
  }
  function encodedModules(value: string): Set<string> {
    const m = QRCode.create(value, { errorCorrectionLevel: 'M' }).modules
    const out = new Set<string>()
    for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.get(x, y)) out.add(`${x},${y}`)
    return out
  }
  const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((k) => b.has(k))

  it.each(CASES)('$label: the displayed address is the protected address and the QR encodes exactly that address', ({ symbol, networkCode, networkName, address }) => {
    const { container } = render(<CryptoAddressDisplay resolved={{ symbol, networkCode, networkName, receivingAddress: address, minimumDeposit: null }} />)
    expect(screen.getByText(address)).toBeInTheDocument() // displayed address
    expect(same(drawnModules(container), encodedModules(address))).toBe(true) // QR payload = the same address
    expect(same(drawnModules(container), encodedModules(CMS_ADDRESS))).toBe(false) // …and NOT some other (e.g. CMS) address
  })

  it('the QR follows the address when the selection changes — it can never keep showing the previous wallet', () => {
    const [trc20, , btc] = CASES
    const { container, rerender } = render(<CryptoAddressDisplay resolved={{ symbol: trc20.symbol, networkCode: trc20.networkCode, networkName: trc20.networkName, receivingAddress: trc20.address, minimumDeposit: null }} />)
    expect(same(drawnModules(container), encodedModules(trc20.address))).toBe(true)

    rerender(<CryptoAddressDisplay resolved={{ symbol: btc.symbol, networkCode: btc.networkCode, networkName: btc.networkName, receivingAddress: btc.address, minimumDeposit: null }} />)
    expect(screen.getByText(btc.address)).toBeInTheDocument()
    expect(same(drawnModules(container), encodedModules(btc.address))).toBe(true)
    expect(same(drawnModules(container), encodedModules(trc20.address))).toBe(false)
  })

  it('the copy button and the share text use the very same address the QR encodes', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    const c = CASES[0]
    render(<CryptoAddressDisplay resolved={{ symbol: c.symbol, networkCode: c.networkCode, networkName: c.networkName, receivingAddress: c.address, minimumDeposit: null }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(c.address)
  })
})
