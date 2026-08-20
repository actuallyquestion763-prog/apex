import { BadRequestException, Controller, Get, NotFoundException, Param, Query } from '@nestjs/common'
import { MarketsService } from './markets.service'
import { MarketDataService } from './market-data.service'
import type { KlineInterval } from './market-data.types'

const VALID_INTERVALS: KlineInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d']

// Public — market data is a quote, not an account action (same trust
// boundary as before this phase). Every route resolves ONLY against
// TRUST's own configured instrument list (Part 12) — there is no route
// here that accepts an arbitrary symbol/URL and forwards it to an external
// provider; getQuote()/getQuotes() always go through MarketDataService,
// which looks the symbol up in MarketConfig first and returns UNAVAILABLE
// for anything not configured, never making an outbound request for an
// unknown symbol. No provider credential is ever read, logged, or returned
// by anything in this controller.
@Controller('markets')
export class MarketsController {
  constructor(
    private readonly marketsService: MarketsService,
    private readonly marketData: MarketDataService,
  ) {}

  // List of all enabled instruments with their configuration — the
  // database-backed replacement for the frontend's previously-hardcoded
  // SYMBOLS array (Part 4).
  @Get()
  async listInstruments() {
    return this.marketData.listInstruments()
  }

  @Get('config')
  listConfigs() {
    // Kept for backward compatibility with existing internal callers —
    // same data as GET /markets minus the `enabled` filter (admin tooling
    // wants to see disabled instruments too).
    return this.marketsService.listMarketConfigs()
  }

  @Get('quotes')
  async getQuotes(@Query('symbols') symbolsParam?: string) {
    if (!symbolsParam) throw new BadRequestException('symbols query parameter is required, comma-separated.')
    const symbols = symbolsParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50) // hard cap — never an unbounded batch
    if (symbols.length === 0) throw new BadRequestException('No valid symbols provided.')
    return this.marketData.getQuotes(symbols)
  }

  @Get(':symbol/quote')
  async getQuote(@Param('symbol') symbol: string) {
    return this.marketData.getQuote(decodeURIComponent(symbol))
  }

  // Historical candles (Part 11) — honest OHLC_UNAVAILABLE for any
  // instrument with no real history provider (e.g. XAU/USD today), never a
  // fabricated candle. limit is hard-capped regardless of what's requested.
  @Get(':symbol/candles')
  async getCandles(@Param('symbol') symbol: string, @Query('interval') interval = '1m', @Query('limit') limit?: string) {
    if (!VALID_INTERVALS.includes(interval as KlineInterval)) {
      throw new BadRequestException(`interval must be one of: ${VALID_INTERVALS.join(', ')}`)
    }
    const parsedLimit = Math.min(Math.max(Number(limit) || 60, 1), 500)
    const result = await this.marketData.getCandles(decodeURIComponent(symbol), interval as KlineInterval, parsedLimit)
    if (!result.candles) {
      return { symbol: decodeURIComponent(symbol), status: 'OHLC_UNAVAILABLE', reason: result.reason }
    }
    return { symbol: decodeURIComponent(symbol), status: 'OK', candles: result.candles }
  }

  @Get(':symbol')
  async getInstrument(@Param('symbol') symbol: string) {
    const instrument = await this.marketData.getInstrument(decodeURIComponent(symbol))
    if (!instrument || !instrument.enabled) throw new NotFoundException('Instrument not found.')
    return instrument
  }
}
