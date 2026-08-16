import { Module } from '@nestjs/common'
import { AdminService } from './admin.service'
import { AdminController } from './admin.controller'
import { LedgerModule } from '../ledger/ledger.module'
import { AccountsModule } from '../accounts/accounts.module'
import { AuditModule } from '../audit/audit.module'
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module'
import { MarketsModule } from '../markets/markets.module'
import { DepositsModule } from '../deposits/deposits.module'
import { WithdrawalsModule } from '../withdrawals/withdrawals.module'
import { KycModule } from '../kyc/kyc.module'
import { SecurityModule } from '../common/security/security.module'

@Module({
  imports: [LedgerModule, AccountsModule, AuditModule, PlatformSettingsModule, MarketsModule, DepositsModule, WithdrawalsModule, KycModule, SecurityModule],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
