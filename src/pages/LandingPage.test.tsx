import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LandingPage } from './LandingPage'
import type { TickerPrice } from '../types'

vi.mock('../store/auth', () => ({
  useAuth: () => ({ user: null }),
}))

const PRICES: TickerPrice[] = [
  { symbol: 'BTC/USDT', name: 'Bitcoin', price: 67250.4, change24h: 100, changePct: 2.84 },
]

vi.mock('../store/priceFeed', () => ({
  snapshot: () => PRICES,
  tickAll: () => PRICES,
  getMarketStatus: () => 'live',
  getStats24h: () => ({ priceChangePercent: 2.84, highPrice: 68420, lowPrice: 65890, volume: null, quoteVolume: null }),
}))

vi.mock('../lib/cms', () => ({
  usePublishedPage: () => ({ data: null, loading: false }),
  usePublishedFaqs: () => ({ data: [], loading: false, error: null }),
  usePublishedAnnouncements: () => ({ data: [], loading: false }),
  useCmsNavigation: () => ({ data: null }),
  findSection: () => undefined,
  findSections: () => [],
  field: (_s: unknown, _k: string, fallback: string) => fallback,
}))

function renderPage() {
  return render(<MemoryRouter><LandingPage /></MemoryRouter>)
}

describe('LandingPage — Phase F fabricated-claim removal', () => {
  it('never shows fabricated user/volume/country statistics', () => {
    renderPage()
    expect(screen.queryByText(/2\.4M\+ traders/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\$18B\+ volume/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/140\+ countries/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/join 2\.4 million traders/i)).not.toBeInTheDocument()
  })

  it('never shows fake "as featured in" press logos', () => {
    renderPage()
    expect(screen.queryByText(/as featured in/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Bloomberg')).not.toBeInTheDocument()
    expect(screen.queryByText('CoinDesk')).not.toBeInTheDocument()
  })

  it('never shows a fabricated aggregate review count/rating', () => {
    renderPage()
    expect(screen.queryByText(/12,400\+ reviews/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/4\.9\/5/)).not.toBeInTheDocument()
  })

  it('shows the real, live BTC/USDT price and 24h stats in the hero card instead of hardcoded numbers', () => {
    renderPage()
    expect(screen.getByText('$67,250.4')).toBeInTheDocument()
    expect(screen.getAllByText('+2.84%').length).toBeGreaterThan(0)
    expect(screen.getByText('$68,420')).toBeInTheDocument()
    expect(screen.getByText('$65,890')).toBeInTheDocument()
  })

  it('claims only a real, verified fee rate with no unsupported volume-discount promise', () => {
    renderPage()
    expect(screen.getByText('0.1% per trade.')).toBeInTheDocument()
    expect(screen.queryByText(/volume discounts/i)).not.toBeInTheDocument()
  })

  it('never claims sub-millisecond execution or deep liquidity pools', () => {
    renderPage()
    expect(screen.queryByText(/sub-millisecond/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/deep liquidity pools/i)).not.toBeInTheDocument()
  })
})
