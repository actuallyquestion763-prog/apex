import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CryptoAssetSelector } from './CryptoAssetSelector'

const assets = [
  { symbol: 'USDT', name: 'Tether', networks: [] },
  { symbol: 'BTC', name: 'Bitcoin', networks: [] },
  { symbol: 'ETH', name: 'Ethereum', networks: [] },
]

describe('CryptoAssetSelector', () => {
  it('renders every asset the backend configuration returned, never a hardcoded list', () => {
    render(<CryptoAssetSelector assets={assets} selected="USDT" onSelect={() => {}} />)
    expect(screen.getByRole('option', { name: /USDT/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /BTC/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /ETH/ })).toBeInTheDocument()
  })

  it('calls onSelect with the chosen symbol', () => {
    const onSelect = vi.fn()
    render(<CryptoAssetSelector assets={assets} selected="USDT" onSelect={onSelect} />)
    fireEvent.change(screen.getByLabelText('Crypto'), { target: { value: 'BTC' } })
    expect(onSelect).toHaveBeenCalledWith('BTC')
  })

  it('shows an honest placeholder when no assets are configured', () => {
    render(<CryptoAssetSelector assets={[]} selected={null} onSelect={() => {}} />)
    expect(screen.getByText('No crypto assets available')).toBeInTheDocument()
  })
})
