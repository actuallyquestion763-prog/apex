import { Module } from '@nestjs/common'
import { AccountsService } from './accounts.service'
import { AccountsController } from './accounts.controller'
import { LedgerModule } from '../ledger/ledger.module'
import { MarketsModule } from '../markets/markets.module'
import { IdempotencyModule } from '../common/idempotency/idempotency.module'

@Module({
  imports: [LedgerModule, MarketsModule, IdempotencyModule],
  providers: [AccountsService],
  controllers: [AccountsController],
  exports: [AccountsService],
})
export class AccountsModule {}
