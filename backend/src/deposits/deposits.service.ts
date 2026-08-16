import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../ledger/ledger.service'
import { AccountsService } from '../accounts/accounts.service'
import { PlatformSettingsService } from '../platform-settings/platform-settings.service'
import { AuditService } from '../audit/audit.service'
import { AuditEvent } from '../audit/audit-events'
import type { CreateDepositDto } from './dto/create-deposit.dto'

/**
 * Deposit foundation for this phase — NO real payment provider is connected.
 *
 * createDeposit() only ever creates a PENDING record; it never credits
 * anything. Money only moves in confirm(), and only an ADMIN/SUPER_ADMIN can
 * call it in this phase (a real payment-provider webhook handler will
 * replace/augment that in a future phase — see backend/README.md). A
 * frontend "deposit successful" message must never be treated as
 * confirmation.
 */
@Injectable()
export class DepositsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly accounts: AccountsService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly audit: AuditService,
  ) {}

  async createDeposit(userId: string, dto: CreateDepositDto) {
    await this.platformSettings.assertDepositsEnabled()
    const amount = new Decimal(dto.amount)
    if (amount.lte(0)) throw new BadRequestException('Deposit amount must be positive.')

    return this.prisma.deposit.create({
      data: { userId, amount, currency: dto.currency ?? 'USD', method: dto.method, status: 'PENDING' },
    })
  }

  async listMine(userId: string) {
    return this.prisma.deposit.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
  }

  async listAll(status?: string) {
    return this.prisma.deposit.findMany({
      where: status ? { status: status as any } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, email: true, fullName: true } } },
    })
  }

  async confirm(depositId: string, adminId: string, reason?: string) {
    const deposit = await this.prisma.deposit.findUnique({ where: { id: depositId } })
    if (!deposit) throw new NotFoundException('Deposit not found.')
    if (deposit.status === 'CONFIRMED') return deposit // idempotent no-op
    if (deposit.status !== 'PENDING' && deposit.status !== 'PROCESSING') {
      throw new BadRequestException(`Cannot confirm a deposit in status ${deposit.status}.`)
    }

    const account = await this.accounts.getPrimaryAccount(deposit.userId)
    const { cash } = await this.ledger.getOrCreateUserLedgerAccounts(account.id, deposit.currency)
    const suspense = await this.ledger.getSystemLedgerAccount('SUSPENSE', deposit.currency)

    const txn = await this.ledger.postTransaction({
      description: `Deposit confirmed: ${deposit.method} ${deposit.amount.toString()} ${deposit.currency}`,
      relatedType: 'DEPOSIT',
      relatedId: deposit.id,
      idempotencyKey: `deposit-confirm-${deposit.id}`,
      entries: [
        { ledgerAccountId: suspense.id, direction: 'DEBIT', amount: deposit.amount, currency: deposit.currency, entryType: 'DEPOSIT' },
        { ledgerAccountId: cash.id, direction: 'CREDIT', amount: deposit.amount, currency: deposit.currency, entryType: 'DEPOSIT' },
      ],
    })

    const updated = await this.prisma.deposit.update({
      where: { id: deposit.id },
      data: { status: 'CONFIRMED', ledgerTransactionId: txn.id, confirmedAt: new Date() },
    })

    await this.audit.record({
      actorId: adminId,
      action: AuditEvent.DEPOSIT_APPROVED,
      targetType: 'DEPOSIT',
      targetId: deposit.id,
      previousState: { status: deposit.status },
      newState: { status: 'CONFIRMED' },
      reason,
    })

    return updated
  }

  async reject(depositId: string, adminId: string, reason: string) {
    const deposit = await this.prisma.deposit.findUnique({ where: { id: depositId } })
    if (!deposit) throw new NotFoundException('Deposit not found.')
    if (deposit.status === 'FAILED') return deposit // idempotent no-op
    if (deposit.status === 'CONFIRMED') {
      throw new BadRequestException('Cannot reject a deposit that has already been confirmed — use a reversal instead.')
    }

    const updated = await this.prisma.deposit.update({ where: { id: deposit.id }, data: { status: 'FAILED' } })

    await this.audit.record({
      actorId: adminId,
      action: AuditEvent.DEPOSIT_REJECTED,
      targetType: 'DEPOSIT',
      targetId: deposit.id,
      previousState: { status: deposit.status },
      newState: { status: 'FAILED' },
      reason,
    })

    return updated
  }
}
