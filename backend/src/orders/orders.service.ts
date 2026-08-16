import { BadRequestException, Injectable } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../ledger/ledger.service'
import { PlatformSettingsService } from '../platform-settings/platform-settings.service'
import { MarketsService } from '../markets/markets.service'
import { AccountsService } from '../accounts/accounts.service'
import type { CreateOrderDto } from './dto/create-order.dto'

/**
 * Order foundation for this phase.
 *
 * IMPORTANT — there is no broker/exchange connected. This service does not
 * and must not fabricate a fill. An accepted order is: validated, reserves
 * the requested amount against the user's cash balance (a real, auditable
 * ledger movement — this is not fake), and is then REJECTED with an honest
 * reason because there is nowhere to actually execute it, releasing the
 * reservation in the same step. This exercises the real reserve/release
 * ledger path end-to-end without ever claiming FILLED.
 *
 * `quantity` here is treated as a USD investment/margin amount, matching the
 * existing frontend's `Position.size` convention (src/types.ts) — not a
 * newly invented interpretation.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly markets: MarketsService,
    private readonly accounts: AccountsService,
  ) {}

  async createOrder(userId: string, dto: CreateOrderDto) {
    const quantity = new Decimal(dto.quantity)
    if (quantity.lte(0)) throw new BadRequestException('Quantity must be a positive number.')

    await this.platformSettings.assertTradingEnabled()

    const account = await this.accounts.getPrimaryAccount(userId)
    const marketConfig = await this.markets.getMarketConfig(dto.symbol)

    if (!marketConfig.tradingEnabled) {
      return this.createRejectedOrder(userId, account.id, dto, quantity, 'Trading is not enabled for this market yet.')
    }
    if (marketConfig.maintenanceMode) {
      return this.createRejectedOrder(userId, account.id, dto, quantity, 'This market is under maintenance.')
    }

    let requestedPrice: Decimal | undefined
    if (marketConfig.dataSource === 'LIVE') {
      if (dto.symbol !== 'XAU/USD') {
        return this.createRejectedOrder(userId, account.id, dto, quantity, 'No live execution price source is configured for this symbol.')
      }
      const quote = await this.markets.getXauQuote()
      if ('error' in quote || quote.stale) {
        return this.createRejectedOrder(userId, account.id, dto, quantity, 'Market price is not currently live.')
      }
      requestedPrice = new Decimal(quote.price)
    }
    // SIMULATED markets: no server-side execution price source exists yet in
    // this foundation phase (the existing frontend generates simulated
    // prices client-side, which is not an execution price a backend should
    // trust) — requestedPrice stays undefined; see "Remaining Issues" in the
    // final report.

    const order = await this.prisma.order.create({
      data: {
        userId,
        accountId: account.id,
        symbol: dto.symbol,
        side: dto.side,
        quantity,
        requestedPrice,
        status: 'PENDING',
      },
    })

    const { cash, reserved } = await this.ledger.getOrCreateUserLedgerAccounts(account.id)

    // Balance check + reservation happen inside one PostgreSQL transaction
    // holding an advisory lock on the user's CASH account (same primitive
    // WithdrawalsService uses) — a concurrent withdrawal or second order
    // against this account cannot interleave with this check.
    try {
      await this.ledger.postTransactionWithAccountLock(
        cash.id,
        {
          description: `Reserve funds for order ${order.id}`,
          relatedType: 'ORDER',
          relatedId: order.id,
          idempotencyKey: `order-reserve-${order.id}`,
          entries: [
            { ledgerAccountId: cash.id, direction: 'DEBIT', amount: quantity, entryType: 'TRADE_RESERVATION' },
            { ledgerAccountId: reserved.id, direction: 'CREDIT', amount: quantity, entryType: 'TRADE_RESERVATION' },
          ],
        },
        async (tx) => {
          const balance = await this.ledger.getLedgerAccountBalanceLocked(tx, cash.id)
          if (balance.lt(quantity)) throw new BadRequestException('Insufficient available balance.')
        },
      )
    } catch (err) {
      if (err instanceof BadRequestException) {
        return this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'REJECTED', rejectionReason: 'Insufficient available balance.' },
        })
      }
      throw err
    }

    // No broker/exchange is connected in this phase — release the
    // reservation and reject honestly instead of pretending an execution
    // happened.
    await this.ledger.postTransaction({
      description: `Release reservation — no broker connected for order ${order.id}`,
      relatedType: 'ORDER',
      relatedId: order.id,
      idempotencyKey: `order-release-${order.id}`,
      entries: [
        { ledgerAccountId: reserved.id, direction: 'DEBIT', amount: quantity, entryType: 'TRADE_RELEASE' },
        { ledgerAccountId: cash.id, direction: 'CREDIT', amount: quantity, entryType: 'TRADE_RELEASE' },
      ],
    })

    return this.prisma.order.update({
      where: { id: order.id },
      data: { status: 'REJECTED', rejectionReason: 'No broker/exchange is connected in this environment. This phase only validates and demonstrates the order/ledger foundation.' },
    })
  }

  private async createRejectedOrder(userId: string, accountId: string, dto: CreateOrderDto, quantity: Decimal, reason: string, requestedPrice?: Decimal) {
    return this.prisma.order.create({
      data: {
        userId,
        accountId,
        symbol: dto.symbol,
        side: dto.side,
        quantity,
        requestedPrice,
        status: 'REJECTED',
        rejectionReason: reason,
      },
    })
  }

  async listMyOrders(userId: string) {
    return this.prisma.order.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 })
  }
}
