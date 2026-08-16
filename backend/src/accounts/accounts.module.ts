import { Module } from '@nestjs/common'
import { AccountsService } from './accounts.service'
import { AccountsController } from './accounts.controller'
import { LedgerModule } from '../ledger/ledger.module'

@Module({
  imports: [LedgerModule],
  providers: [AccountsService],
  controllers: [AccountsController],
  exports: [AccountsService],
})
export class AccountsModule {}
