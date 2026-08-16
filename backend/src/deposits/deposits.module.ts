import { Module } from '@nestjs/common'
import { DepositsService } from './deposits.service'
import { DepositsController } from './deposits.controller'
import { LedgerModule } from '../ledger/ledger.module'
import { AccountsModule } from '../accounts/accounts.module'
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [LedgerModule, AccountsModule, PlatformSettingsModule, AuditModule],
  providers: [DepositsService],
  controllers: [DepositsController],
  exports: [DepositsService],
})
export class DepositsModule {}
