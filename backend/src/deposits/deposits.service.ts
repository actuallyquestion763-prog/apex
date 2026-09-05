import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../ledger/ledger.service'
import { AccountsService } from '../accounts/accounts.service'
import { PlatformSettingsService } from '../platform-settings/platform-settings.service'
import { AuditService } from '../audit/audit.service'
import { AuditEvent } from '../audit/audit-events'
import { CryptoDepositsService } from '../crypto-deposits/crypto-deposits.service'
import { MediaStorageService } from '../cms/media-storage.service'
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
    private readonly cryptoDeposits: CryptoDepositsService,
    private readonly media: MediaStorageService,
  ) {}

  async createDeposit(userId: string, dto: CreateDepositDto) {
    await this.platformSettings.assertDepositsEnabled()
    const amount = new Decimal(dto.amount)
    if (amount.lte(0)) throw new BadRequestException('Deposit amount must be positive.')

    // Checkpoint K — CRYPTO deposits branch here only for validation +
    // snapshotting; everything after this block (PENDING creation, ledger
    // confirm()/reject() — see below) is completely unchanged for every
    // deposit method, crypto included. No new financial pathway, no new
    // idempotency/ledger mechanism.
    if (dto.method === 'CRYPTO') {
      if (!dto.cryptoAssetSymbol || !dto.networkCode) {
        throw new BadRequestException('cryptoAssetSymbol and networkCode are required for a CRYPTO deposit.')
      }
      const resolved = await this.cryptoDeposits.resolveForDeposit(dto.cryptoAssetSymbol.toUpperCase(), dto.networkCode.toUpperCase())
      if (!resolved.ok) throw new BadRequestException(`${resolved.reason}: ${resolved.message}`)
      const { asset, network } = resolved

      if (network.minimumDeposit && amount.lt(network.minimumDeposit)) {
        throw new BadRequestException(`Minimum deposit for ${asset.symbol} / ${network.networkCode} is ${network.minimumDeposit.toString()} ${asset.symbol}.`)
      }

      const deposit = await this.prisma.deposit.create({
        data: {
          userId,
          amount,
          // Part 23 — the deposit's ledger currency IS the crypto asset
          // symbol (USDT deposit -> USDT ledger account; BTC deposit -> BTC
          // ledger account). The existing multi-currency ledger already
          // supports an arbitrary currency string per (account, currency)
          // pair (see LedgerAccount's schema comment / Phase 6F) — this is
          // the same mechanism spot trading already relies on for BTC/ETH
          // holdings, not a new capability.
          currency: asset.symbol,
          method: 'CRYPTO',
          status: 'PENDING',
          // SNAPSHOT (Part 15/16) — copied from the resolved config now,
          // never re-read from CryptoDepositAddress again. A later admin
          // address change can never alter what THIS deposit displays.
          cryptoAssetSymbol: asset.symbol,
          networkCode: network.networkCode,
          receivingAddress: network.receivingAddress,
        },
      })
      await this.audit.record({
        actorId: userId,
        action: AuditEvent.DEPOSIT_CREATED,
        targetType: 'DEPOSIT',
        targetId: deposit.id,
        newState: { method: 'CRYPTO', cryptoAssetSymbol: asset.symbol, networkCode: network.networkCode, amount: amount.toString() },
      })
      return deposit
    }

    const deposit = await this.prisma.deposit.create({
      data: { userId, amount, currency: dto.currency ?? 'USD', method: dto.method, status: 'PENDING' },
    })
    await this.audit.record({
      actorId: userId,
      action: AuditEvent.DEPOSIT_CREATED,
      targetType: 'DEPOSIT',
      targetId: deposit.id,
      newState: { method: dto.method, amount: amount.toString() },
    })
    return deposit
  }

  async listMine(userId: string) {
    return this.prisma.deposit.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
  }

  // ---- Deposit proof (Part 20) — reuses MediaStorageService exactly as
  // CmsMedia/SupportAttachment already do (Part 20 explicitly: preserve/
  // reuse, never a second storage mechanism). Optional — the existing
  // product has never required proof for any deposit method, and nothing
  // here makes it mandatory; a deposit can be reviewed and approved with or
  // without one, same as before this checkpoint. ---------------------------

  async uploadProof(userId: string, depositId: string, file: { originalname: string; mimetype: string; buffer: Buffer }) {
    const deposit = await this.prisma.deposit.findUnique({ where: { id: depositId } })
    if (!deposit) throw new NotFoundException('Deposit not found.')
    if (deposit.userId !== userId) throw new NotFoundException('Deposit not found.')
    if (deposit.status !== 'PENDING' && deposit.status !== 'PROCESSING') {
      throw new BadRequestException(`Cannot attach proof to a deposit in status ${deposit.status}.`)
    }

    const stored = await this.media.save(file.originalname, file.mimetype, file.buffer)
    // Replaces any previously-uploaded proof for this deposit (the old
    // stored object is deleted) — a deposit has at most one current proof,
    // matching the single "Upload Slip" area in the product's own screenshot.
    if (deposit.proofStorageKey) await this.media.delete(deposit.proofStorageKey)

    const updated = await this.prisma.deposit.update({
      where: { id: depositId },
      data: { proofFilename: file.originalname, proofMimeType: file.mimetype, proofSize: stored.size, proofStorageKey: stored.storageKey },
    })
    await this.audit.record({
      actorId: userId,
      action: AuditEvent.DEPOSIT_PROOF_UPLOADED,
      targetType: 'DEPOSIT',
      targetId: depositId,
      metadata: { filename: file.originalname, size: stored.size },
    })
    return updated
  }

  // Ownership-or-permission gated (mirrors SupportService.getAttachmentFile
  // exactly) — no public URL for a deposit proof, ever.
  async getProofFile(requesterId: string, requesterIsPrivileged: boolean, depositId: string) {
    const deposit = await this.prisma.deposit.findUnique({ where: { id: depositId } })
    if (!deposit || !deposit.proofStorageKey) throw new NotFoundException('No proof on file for this deposit.')
    if (deposit.userId !== requesterId && !requesterIsPrivileged) throw new NotFoundException('Deposit not found.')
    const stream = await this.media.getObjectStream(deposit.proofStorageKey)
    return { stream, mimeType: deposit.proofMimeType!, filename: deposit.proofFilename! }
  }

  async listAll(status?: string, userId?: string) {
    return this.prisma.deposit.findMany({
      where: {
        ...(status ? { status: status as any } : {}),
        ...(userId ? { userId } : {}),
      },
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
