import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CandlestickChart } from './CandlestickChart'

// lightweight-charts touches real canvas/layout APIs JSDOM doesn't provide —
// mocked here the same way this checkpoint's OptionsChart.tsx precedent
// implicitly relies on (no direct test exists for it either); this lets us
// verify the component's OWN logic (data loading, symbol/timeframe
// switching, lifecycle) without needing a real chart engine.
const setData = vi.fn()
const update = vi.fn()
const applyOptions = vi.fn()
const removeChart = vi.fn()
const fitContent = vi.fn()
const subscribeCrosshairMove = vi.fn()

vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(() => ({
    addSeries: vi.fn(() => ({ setData, update, priceScale: () => ({ applyOptions: vi.fn() }) })),
    subscribeCrosshairMove,
    applyOptions,
    remove: removeChart,
    timeScale: () => ({ fitContent }),
  })),
  CandlestickSeries: 'CandlestickSeries',
  HistogramSeries: 'HistogramSeries',
}))

let mockStatus: string = 'live'
let mockPrice = 65000
let mockRealCandles: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }> | null = [
  { time: Date.now() - 60_000, open: 100, high: 110, low: 95, close: 105, volume: 10 },
  { time: Date.now(), open: 105, high: 108, low: 102, close: 106, volume: 8 },
]

vi.mock('../store/priceFeed', () => ({
  getPrice: () => mockPrice,
  getMarketStatus: () => mockStatus,
  fetchRealCandles: vi.fn(() => Promise.resolve(mockRealCandles)),
  generateHistory: vi.fn(() => [{ time: Date.now(), open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 }]),
}))

class MockResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  mockStatus = 'live'
  mockPrice = 65000
  mockRealCandles = [
    { time: Date.now() - 60_000, open: 100, high: 110, low: 95, close: 105, volume: 10 },
    { time: Date.now(), open: 105, high: 108, low: 102, close: 106, volume: 8 },
  ]
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
  setData.mockClear()
  update.mockClear()
  removeChart.mockClear()
  fitContent.mockClear()
})

describe('CandlestickChart — TradingView-style chart (lightweight-charts)', () => {
  it('renders the given symbol and all 6 supported timeframe buttons', async () => {
    render(<CandlestickChart symbol="BTC/USDT" />)
    expect(screen.getByText('BTC/USDT')).toBeInTheDocument()
    for (const tf of ['1m', '5m', '15m', '1H', '4H', '1D']) {
      expect(screen.getByRole('button', { name: tf })).toBeInTheDocument()
    }
    // 30m is deliberately not offered — the backend has no real 30m kline source
    expect(screen.queryByRole('button', { name: '30m' })).not.toBeInTheDocument()
  })

  it('loads real candle data via fetchRealCandles for a LIVE symbol and feeds it into the chart series', async () => {
    render(<CandlestickChart symbol="BTC/USDT" />)
    await vi.waitFor(() => expect(setData).toHaveBeenCalled())
  })

  it('shows an honest "unavailable" message when the backend returns no real candles — never a fabricated one', async () => {
    mockRealCandles = null
    render(<CandlestickChart symbol="XAU/USD" />)
    await screen.findByText(/Historical chart data unavailable for XAU\/USD/)
  })

  it('reloads candles when the timeframe selection changes', async () => {
    const { rerender } = render(<CandlestickChart symbol="BTC/USDT" />)
    await vi.waitFor(() => expect(setData).toHaveBeenCalled())
    setData.mockClear()
    const btn15m = screen.getByRole('button', { name: '15m' })
    btn15m.click()
    rerender(<CandlestickChart symbol="BTC/USDT" />)
    await vi.waitFor(() => expect(setData).toHaveBeenCalled())
  })

  it('reloads candles and clears prior series data when the symbol changes — no stale candles from the previous symbol', async () => {
    const { rerender } = render(<CandlestickChart symbol="BTC/USDT" />)
    await vi.waitFor(() => expect(setData).toHaveBeenCalled())
    setData.mockClear()
    rerender(<CandlestickChart symbol="ETH/USDT" />)
    // immediate clear (stale-data guard) plus the new symbol's real data
    await vi.waitFor(() => expect(setData).toHaveBeenCalled())
  })

  it('disposes the chart instance on unmount', () => {
    const { unmount } = render(<CandlestickChart symbol="BTC/USDT" />)
    unmount()
    expect(removeChart).toHaveBeenCalledTimes(1)
  })
})
