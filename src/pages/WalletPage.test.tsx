import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { WalletPage } from './WalletPage'
import type { LedgerEntry } from '../types'

let mockSummary: { cash: string } | null = { cash: '6000' }
let mockEntries: LedgerEntry[] = []
let mockHistoryLoading = false

vi.mock('../store/useStore', () => ({
  useAccountSummary: () => ({ summary: mockSummary, loading: false }),
  useLedgerHistory: () => ({ entries: mockEntries, loading: mockHistoryLoading, error: null }),
}))

function entry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: Math.random().toString(),
    ledgerAccount: 'CASH',
    direction: 'CREDIT',
    amount: '100',
    currency: 'USD',
    entryType: 'DEPOSIT',
    description: 'Test entry',
    relatedType: null,
    relatedId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function renderWallet() {
  return render(<MemoryRouter><WalletPage /></MemoryRouter>)
}

describe('WalletPage — currency-aware transaction display (Wallet Currency Display checkpoint)', () => {
  beforeEach(() => {
    mockSummary = { cash: '6000' }
    mockEntries = []
    mockHistoryLoading = false
  })

  it('shows a clear loading indicator while ledger history is being fetched, distinct from the empty state', () => {
    mockHistoryLoading = true
    mockEntries = []
    renderWallet()
    expect(screen.getByText('Loading transactions…')).toBeInTheDocument()
    expect(screen.queryByText('No transactions yet.')).not.toBeInTheDocument()
  })

  it('1/6. displays a USD ledger entry as USD, with the existing $ prefix', () => {
    mockEntries = [entry({ currency: 'USD', amount: '100', direction: 'CREDIT' })]
    renderWallet()
    expect(screen.getByText('+$100.00 USD')).toBeInTheDocument()
  })

  it('2/4. displays a USDT ledger entry as USDT, never with a "$" prefix', () => {
    mockEntries = [entry({ currency: 'USDT', amount: '100', direction: 'CREDIT' })]
    renderWallet()
    expect(screen.getByText('+100.00 USDT')).toBeInTheDocument()
    expect(screen.queryByText('+$100.00')).not.toBeInTheDocument()
    expect(screen.queryByText(/\$100\.00 USDT/)).not.toBeInTheDocument()
  })

  it('3/5. displays a BTC ledger entry as BTC with full 8-decimal precision, never with a "$" prefix', () => {
    mockEntries = [entry({ currency: 'BTC', amount: '0.00138', direction: 'CREDIT' })]
    renderWallet()
    expect(screen.getByText('+0.00138000 BTC')).toBeInTheDocument()
    expect(screen.queryByText(/\$0\.00138/)).not.toBeInTheDocument()
  })

  it('displays an ETH ledger entry with full 8-decimal precision', () => {
    mockEntries = [entry({ currency: 'ETH', amount: '0.25', direction: 'CREDIT' })]
    renderWallet()
    expect(screen.getByText('+0.25000000 ETH')).toBeInTheDocument()
  })

  it('7. an empty transaction history still renders correctly', () => {
    mockEntries = []
    renderWallet()
    expect(screen.getByText('No transactions yet.')).toBeInTheDocument()
  })

  it('8. a debit (negative) entry displays with a minus, a credit (positive) entry with a plus, per currency', () => {
    mockEntries = [
      entry({ currency: 'USDT', amount: '50', direction: 'DEBIT', entryType: 'FEE' }),
      entry({ currency: 'USDT', amount: '200', direction: 'CREDIT', entryType: 'DEPOSIT' }),
    ]
    renderWallet()
    expect(screen.getByText('-50.00 USDT')).toBeInTheDocument()
    expect(screen.getByText('+200.00 USDT')).toBeInTheDocument()
  })

  it('never mixes currencies together in the Total Deposited figure — shows one line per currency actually deposited', () => {
    mockEntries = [
      entry({ currency: 'USD', amount: '500', direction: 'CREDIT', entryType: 'DEPOSIT' }),
      entry({ currency: 'USDT', amount: '1000', direction: 'CREDIT', entryType: 'DEPOSIT' }),
    ]
    renderWallet()
    expect(screen.getByText('$500.00 USD')).toBeInTheDocument()
    expect(screen.getByText('1,000.00 USDT')).toBeInTheDocument()
    // never a single combined 1500 figure
    expect(screen.queryByText(/1,?500\.00/)).not.toBeInTheDocument()
  })

  it('shows the real USD balance hero labeled explicitly as USD', () => {
    renderWallet()
    expect(screen.getByText('USD Balance')).toBeInTheDocument()
    expect(screen.getByText('$6,000.00 USD')).toBeInTheDocument()
  })
})
