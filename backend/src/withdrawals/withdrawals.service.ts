import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../ledger/ledger.service'
import { AccountsService } from '../accounts/accounts.service'
import { PlatformSettingsService } from '../platform-settings/platform-settings.service'
import { AuditService } from '../audit/audit.service'
import { AuditEvent } from '../audit/audit-events'
import type { CreateWithdrawalDto } from './dto/create-withdrawal.dto'

/**
 * Withdrawal foundation for this phase — NO real payment rail is connected.
 * Funds are debited from the user's available cash at REQUEST time (not at
 * approval time), moved to the SUSPENSE ledger account, so the same funds
 * can't be reserved by a second concurrent withdrawal/order. If rejected,
 * the reservation is reversed. If approved, no further ledger movement
 * happens in this phase (a real payment rail's confirmation would be what
 * finally clears SUSPENSE in a future phase).
 *
 * CONCURRENCY: the balance check and the reservation entry run inside a
 * single PostgreSQL transaction holding a `pg_advisory_xact_lock` keyed on
 * the user's CASH ledger account (LedgerService.postTransactionWithAccountLock).
 * A second concurrent withdrawal/order against the same account blocks at
 * lock acquisition until the first transaction fully commits or rolls
 * back — there is no window where two requests can both read the same
 * pre-reservation balance and both proceed. This replaced an earlier
 * check-then-reverse-if-negative mitigation, which worked but wasn't a real
 * lock.
 */
@Injectable()
export class WithdrawalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly accounts: AccountsService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly audit: AuditService,
  ) {}

  async createWithdrawal(userId: string, dto: CreateWithdrawalDto) {
    await this.platformSettings.assertWithdrawalsEnabled()
    const amount = new Decimal(dto.amount)
    if (amount.lte(0)) throw new BadRequestException('Withdrawal amount must be positive.')

    const account = await this.accounts.getPrimaryAccount(userId)
    const currency = dto.currency ?? 'USD'
    const { cash } = await this.ledger.getOrCreateUserLedgerAccounts(account.id, currency)
    const suspense = await this.ledger.getSystemLedgerAccount('SUSPENSE', currency)

    const withdrawal = await this.prisma.withdrawal.create({
      data: { userId, amount, currency, destination: dto.destination, status: 'PENDING' },
    })

    try {
      const txn = await this.ledger.postTransactionWithAccountLock(
        cash.id,
        {
          description: `Withdrawal requested: ${amount.toString()} ${currency}`,
          relatedType: 'WITHDRAWAL',
          relatedId: withdrawal.id,
          idempotencyKey: `withdrawal-request-${withdrawal.id}`,
          entries: [
            { ledgerAccountId: cash.id, direction: 'DEBIT', amount, currency, entryType: 'WITHDRAWAL' },
            { ledgerAccountId: suspense.id, direction: 'CREDIT', amount, currency, entryType: 'WITHDRAWAL' },
          ],
        },
        async (tx) => {
          // Runs INSIDE the lock, on the same transaction — no other
          // reservation against this account can be concurrently in flight.
          const balance = await this.ledger.getLedgerAccountBalanceLocked(tx, cash.id)
          if (balance.lt(amount)) throw new BadRequestException('Insufficient available balance.')
        },
      )
      return this.prisma.withdrawal.update({ where: { id: withdrawal.id }, data: { ledgerTransactionId: txn.id } })
    } catch (err) {
      if (err instanceof BadRequestException) {
        return this.prisma.withdrawal.update({ where: { id: withdrawal.id }, data: { status: 'REJECTED' } })
      }
      throw err
    }
  }

  async listMine(userId: string) {
    return this.prisma.withdrawal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
  }

  async listAll(status?: string) {
    return this.prisma.withdrawal.findMany({
      where: status ? { status: status as any } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, email: true, fullName: true } } },
    })
  }

  async approve(withdrawalId: string, adminId: string, reason?: string) {
    const withdrawal = await this.prisma.withdrawal.findUnique({ where: { id: withdrawalId } })
    if (!withdrawal) throw new NotFoundException('Withdrawal not found.')
    if (withdrawal.status === 'APPROVED' || withdrawal.status === 'COMPLETED') return withdrawal // idempotent no-op
    if (withdrawal.status !== 'PENDING' && withdrawal.status !== 'REVIEW') {
      throw new BadRequestException(`Cannot approve a withdrawal in status ${withdrawal.status}.`)
    }

    const updated = await this.prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: { status: 'APPROVED', approvedByAdminId: adminId },
    })

    await this.audit.record({
      actorId: adminId,
      action: AuditEvent.WITHDRAWAL_APPROVED,
      targetType: 'WITHDRAWAL',
      targetId: withdrawal.id,
      previousState: { status: withdrawal.status },
      newState: { status: 'APPROVED' },
      reason,
    })

    return updated
  }

  async reject(withdrawalId: string, adminId: string, reason: string) {
    const withdrawal = await this.prisma.withdrawal.findUnique({ where: { id: withdrawalId } })
    if (!withdrawal) throw new NotFoundException('Withdrawal not found.')
    if (withdrawal.status === 'REJECTED') return withdrawal // idempotent no-op
    if (withdrawal.status === 'COMPLETED') {
      throw new BadRequestException('Cannot reject a withdrawal that has already completed.')
    }

    const account = await this.accounts.getPrimaryAccount(withdrawal.userId)
    const { cash } = await this.ledger.getOrCreateUserLedgerAccounts(account.id, withdrawal.currency)
    const suspense = await this.ledger.getSystemLedgerAccount('SUSPENSE', withdrawal.currency)

    await this.ledger.postTransaction({
      description: `Withdrawal rejected — funds returned: ${withdrawal.id}`,
      relatedType: 'WITHDRAWAL',
      relatedId: withdrawal.id,
      idempotencyKey: `withdrawal-reject-${withdrawal.id}`,
      entries: [
        { ledgerAccountId: suspense.id, direction: 'DEBIT', amount: withdrawal.amount, currency: withdrawal.currency, entryType: 'REFUND' },
        { ledgerAccountId: cash.id, direction: 'CREDIT', amount: withdrawal.amount, currency: withdrawal.currency, entryType: 'REFUND' },
      ],
    })

    const updated = await this.prisma.withdrawal.update({ where: { id: withdrawal.id }, data: { status: 'REJECTED' } })

    await this.audit.record({
      actorId: adminId,
      action: AuditEvent.WITHDRAWAL_REJECTED,
      targetType: 'WITHDRAWAL',
      targetId: withdrawal.id,
      previousState: { status: withdrawal.status },
      newState: { status: 'REJECTED' },
      reason,
    })

    return updated
  }
}
