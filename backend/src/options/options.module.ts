import { Module } from '@nestjs/common'
import { LedgerModule } from '../ledger/ledger.module'
import { AccountsModule } from '../accounts/accounts.module'
import { MarketsModule } from '../markets/markets.module'
import { AuditModule } from '../audit/audit.module'
import { IdempotencyModule } from '../common/idempotency/idempotency.module'
import { SecurityModule } from '../common/security/security.module'
import { OptionsService } from './options.service'
import { OptionsSettingsService } from './options-settings.service'
import { OptionsMarketService } from './options-market.service'
import { OptionsRiskService } from './options-risk.service'
import { OptionsController } from './options.controller'
import { OptionsAdminController } from './options-admin.controller'

@Module({
  imports: [LedgerModule, AccountsModule, MarketsModule, AuditModule, IdempotencyModule, SecurityModule],
  providers: [OptionsService, OptionsSettingsService, OptionsMarketService, OptionsRiskService],
  controllers: [OptionsController, OptionsAdminController],
  exports: [OptionsService, OptionsSettingsService, OptionsMarketService],
})
export class OptionsModule {}
