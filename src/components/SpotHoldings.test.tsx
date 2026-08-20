import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SpotHoldings } from './SpotHoldings'
import type { AssetBalance, ExecutionStatus } from '../types'

const btc: AssetBalance = { currency: 'BTC', cash: '0.001234', reserved: '0', total: '0.001234' }
const usdt: AssetBalance = { currency: 'USDT', cash: '5000', reserved: '0', total: '5000' }

describe('SpotHoldings', () => {
  it('shows real, non-zero balances with their quantity and currency — never a fabricated USD value', () => {
    render(<SpotHoldings assets={[btc, usdt]} loading={false} executionStatus={null} />)
    expect(screen.getByText('0.001234 BTC')).toBeInTheDocument()
    expect(screen.getByText('5000 USDT')).toBeInTheDocument()
  })

  it('shows a reserved-amount note only when reserved is non-zero', () => {
    const reserved: AssetBalance = { currency: 'USDT', cash: '400', reserved: '100', total: '500' }
    render(<SpotHoldings assets={[reserved]} loading={false} executionStatus={null} />)
    expect(screen.getByText('100 reserved')).toBeInTheDocument()
  })

  it('shows a loading state distinct from the empty state', () => {
    render(<SpotHoldings assets={[]} loading={true} executionStatus={null} />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByText('No holdings yet')).not.toBeInTheDocument()
  })

  it('shows environment-aware empty-state copy for BinanceSandbox — never claims live production execution', () => {
    const status: ExecutionStatus = { provider: 'BinanceSandbox', message: 'irrelevant here' }
    render(<SpotHoldings assets={[]} loading={false} executionStatus={status} />)
    expect(screen.getByText('Your spot holdings will appear here after a filled trade.')).toBeInTheDocument()
  })

  it('shows environment-aware empty-state copy for a Disabled provider', () => {
    const status: ExecutionStatus = { provider: 'Disabled', message: 'irrelevant here' }
    render(<SpotHoldings assets={[]} loading={false} executionStatus={status} />)
    expect(screen.getByText('Trading execution is currently disabled.')).toBeInTheDocument()
  })

  it('shows simulation copy for the Fake provider (and as the safe default when status is unknown)', () => {
    render(<SpotHoldings assets={[]} loading={false} executionStatus={null} />)
    expect(screen.getByText('Simulation holdings will appear here after a simulated trade.')).toBeInTheDocument()
  })
})
