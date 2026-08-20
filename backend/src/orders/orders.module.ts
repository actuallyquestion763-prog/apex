import { Module } from '@nestjs/common'
import { OrdersService } from './orders.service'
import { OrdersController } from './orders.controller'
import { OrderReconciliationService } from './order-reconciliation.service'
import { RiskEngineService } from './risk-engine.service'
import { LedgerModule } from '../ledger/ledger.module'
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module'
import { MarketsModule } from '../markets/markets.module'
import { AccountsModule } from '../accounts/accounts.module'
import { IdempotencyModule } from '../common/idempotency/idempotency.module'
import { AuditModule } from '../audit/audit.module'
import { ExecutionModule } from '../execution/execution.module'

@Module({
  imports: [LedgerModule, PlatformSettingsModule, MarketsModule, AccountsModule, IdempotencyModule, AuditModule, ExecutionModule],
  providers: [OrdersService, OrderReconciliationService, RiskEngineService],
  controllers: [OrdersController],
  // Phase 6F Checkpoint E — exported so AdminModule can expose reconciliation
  // through an admin-only endpoint without duplicating its wiring.
  // Phase 6F Checkpoint F — RiskEngineService also exported so tests (and a
  // future admin risk-review screen) can evaluate/inspect it directly
  // without re-deriving OrdersModule's wiring.
  exports: [OrderReconciliationService, RiskEngineService],
})
export class OrdersModule {}
