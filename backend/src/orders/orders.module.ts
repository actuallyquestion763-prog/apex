import { Module } from '@nestjs/common'
import { OrdersService } from './orders.service'
import { OrdersController } from './orders.controller'
import { LedgerModule } from '../ledger/ledger.module'
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module'
import { MarketsModule } from '../markets/markets.module'
import { AccountsModule } from '../accounts/accounts.module'

@Module({
  imports: [LedgerModule, PlatformSettingsModule, MarketsModule, AccountsModule],
  providers: [OrdersService],
  controllers: [OrdersController],
})
export class OrdersModule {}
