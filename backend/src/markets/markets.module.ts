import { Module } from '@nestjs/common'
import { MarketsService } from './markets.service'
import { MarketsController } from './markets.controller'
import { MarketDataService } from './market-data.service'
import { GoldApiProvider } from './providers/goldapi.provider'
import { SimulatedProvider } from './providers/simulated.provider'
import { BinanceProvider } from './providers/binance.provider'

@Module({
  providers: [MarketsService, MarketDataService, GoldApiProvider, SimulatedProvider, BinanceProvider],
  controllers: [MarketsController],
  exports: [MarketsService, MarketDataService],
})
export class MarketsModule {}
