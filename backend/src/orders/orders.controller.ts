import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { OrdersService } from './orders.service'
import { CreateOrderDto } from './dto/create-order.dto'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { IdempotencyKeyHeader } from '../common/decorators/idempotency-key.decorator'
import { IdempotencyService } from '../common/idempotency/idempotency.service'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { FINANCIAL_CREATE_THROTTLE } from '../common/rate-limits'

@Controller('orders')
@UseGuards(SessionAuthGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  @Throttle(FINANCIAL_CREATE_THROTTLE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrderDto, @IdempotencyKeyHeader() idempotencyKey?: string) {
    return this.idempotency.run(
      { userId: user.id, scope: 'orders.create', key: idempotencyKey, requestPayload: dto },
      () => this.ordersService.createOrder(user.id, dto),
    )
  }

  @Get('mine')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.listMyOrders(user.id)
  }

  // Phase 6F Checkpoint D — LIMIT order lifecycle. No Idempotency-Key
  // wrapper here: cancelOrder()'s own state machine (terminal → no-op,
  // CANCEL_PENDING → re-sync instead of a second provider call) already
  // makes a repeated request safe by construction (Part 19).
  @Post(':id/cancel')
  @Throttle(FINANCIAL_CREATE_THROTTLE)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.ordersService.cancelOrder(id, user.id)
  }

  // Explicit, on-demand synchronization (Part 12) — no background polling
  // loop exists; a client (or a future admin/reconciliation job) calls this
  // to pull the latest provider state for one resting order.
  @Post(':id/sync')
  sync(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.ordersService.syncOrder(id, user.id)
  }
}
