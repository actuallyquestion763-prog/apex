import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CryptoNetworkSelector } from './CryptoNetworkSelector'

const networks = [
  { networkCode: 'TRC20', networkName: 'Tron (TRC20)', minimumDeposit: null },
  { networkCode: 'ERC20', networkName: 'Ethereum (ERC20)', minimumDeposit: '10' },
]

describe('CryptoNetworkSelector', () => {
  it('shows only the networks configured for the currently-selected asset — never an incompatible combination', () => {
    render(<CryptoNetworkSelector networks={networks} selected="TRC20" onSelect={() => {}} />)
    expect(screen.getByRole('option', { name: 'Tron (TRC20)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Ethereum (ERC20)' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /BEP20/ })).not.toBeInTheDocument()
  })

  it('calls onSelect with the chosen network code', () => {
    const onSelect = vi.fn()
    render(<CryptoNetworkSelector networks={networks} selected="TRC20" onSelect={onSelect} />)
    fireEvent.change(screen.getByLabelText('Network'), { target: { value: 'ERC20' } })
    expect(onSelect).toHaveBeenCalledWith('ERC20')
  })

  it('shows an honest empty state when the asset has no configured networks (e.g. BTC + TRC20-style mismatch)', () => {
    render(<CryptoNetworkSelector networks={[]} selected={null} onSelect={() => {}} />)
    expect(screen.getByText(/No networks are currently configured/)).toBeInTheDocument()
  })
})
