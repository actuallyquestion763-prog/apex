import { BadRequestException, Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { PrismaService } from '../prisma/prisma.service'
import { LedgerService } from '../ledger/ledger.service'
import { AccountsService } from '../accounts/accounts.service'
import { AuditService } from '../audit/audit.service'
import { AuditEvent } from '../audit/audit-events'
import { PlatformSettingsService } from '../platform-settings/platform-settings.service'
import { MarketsService } from '../markets/markets.service'
import { WithdrawalsService } from '../withdrawals/withdrawals.service'
import { StepUpService } from '../common/security/step-up.service'
import { toPublicUser } from '../users/public-user'
import type { PermissionKey } from '../common/permissions'
import type { FinancialAdjustmentDto } from './dto/financial-adjustment.dto'
import type { UpdateUserStatusDto } from './dto/update-user-status.dto'
import type { UpdateUserRoleDto } from './dto/update-user-role.dto'
import type { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto'
import type { UpdateMarketConfigDto } from './dto/update-market-config.dto'
import type { GrantPermissionDto } from './dto/grant-permission.dto'

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly accounts: AccountsService,
    private readonly audit: AuditService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly markets: MarketsService,
    private readonly withdrawals: WithdrawalsService,
    private readonly stepUp: StepUpService,
  ) {}

  // ---- Platform overview ---------------------------------------------------

  async getOverview() {
    const [
      totalUsers,
      activeUsers,
      pendingKyc,
      pendingDeposits,
      pendingWithdrawals,
      openPositions,
      filledOrders,
      platformSettings,
      marketConfigs,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      this.prisma.kycVerification.count({ where: { status: 'PENDING' } }),
      this.prisma.deposit.count({ where: { status: 'PENDING' } }),
      this.prisma.withdrawal.count({ where: { status: { in: ['PENDING', 'REVIEW'] } } }),
      this.prisma.position.count({ where: { status: 'OPEN' } }),
      this.prisma.order.findMany({ where: { status: 'FILLED' }, select: { quantity: true } }),
      this.platformSettings.get(),
      this.markets.listMarketConfigs(),
    ])

    const tradingVolume = filledOrders.reduce((sum, o) => sum.plus(o.quantity), new Decimal(0))
    const totalCustomerAssets = await this.getTotalCustomerAssets()

    return {
      totalUsers,
      activeUsers,
      pendingKyc,
      pendingDeposits,
      pendingWithdrawals,
      openPositions,
      tradingVolume: tradingVolume.toString(), // will read as 0 until a broker integration produces real fills — that's correct, not a bug
      totalCustomerAssets: totalCustomerAssets.toString(),
      platform: platformSettings,
      markets: marketConfigs,
    }
  }

  private async getTotalCustomerAssets(): Promise<Decimal> {
    const [cashSum, reservedSum] = await Promise.all([
      this.prisma.ledgerEntry.groupBy({
        by: ['direction'],
        where: { ledgerAccount: { ownerType: 'USER', type: 'CASH' } },
        _sum: { amount: true },
      }),
      this.prisma.ledgerEntry.groupBy({
        by: ['direction'],
        where: { ledgerAccount: { ownerType: 'USER', type: 'RESERVED' } },
        _sum: { amount: true },
      }),
    ])
    const net = (rows: { direction: string; _sum: { amount: Decimal | null } }[]) => {
      const credit = rows.find((r) => r.direction === 'CREDIT')?._sum.amount ?? new Decimal(0)
      const debit = rows.find((r) => r.direction === 'DEBIT')?._sum.amount ?? new Decimal(0)
      return credit.minus(debit)
    }
    return net(cashSum).plus(net(reservedSum))
  }

  // ---- User management -------------------------------------------------------

  async listUsers() {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
    return users.map(toPublicUser)
  }

  async updateUserStatus(targetUserId: string, dto: UpdateUserStatusDto, adminId: string) {
    const target = await this.prisma.user.findUniqueOrThrow({ where: { id: targetUserId } })
    const updated = await this.prisma.user.update({ where: { id: targetUserId }, data: { status: dto.status } })

    await this.recordAdminAction(adminId, dto.status === 'SUSPENDED' ? AuditEvent.USER_SUSPENDED : dto.status === 'ACTIVE' ? AuditEvent.USER_REACTIVATED : AuditEvent.USER_STATUS_CHANGED, targetUserId, dto.reason, { status: target.status }, { status: dto.status })

    return toPublicUser(updated)
  }

  // Role changes are the most sensitive user-management action available —
  // restricted to SUPER_ADMIN at the controller level (@Roles(SUPER_ADMIN))
  // in addition to step-up (password + fresh TOTP) here. This is also how
  // "creating"/"deleting" an administrator works in this design — promoting
  // a USER to ADMIN, or demoting an ADMIN back to USER — there is no
  // separate endpoint, so both are covered by this same guard.
  async updateUserRole(targetUserId: string, dto: UpdateUserRoleDto, adminId: string) {
    await this.stepUp.assertStepUpAuthorized(adminId, dto.confirmPassword, dto.totpCode)
    const target = await this.prisma.user.findUniqueOrThrow({ where: { id: targetUserId } })
    const updated = await this.prisma.user.update({ where: { id: targetUserId }, data: { role: dto.role } })

    await this.recordAdminAction(adminId, AuditEvent.ROLE_CHANGED, targetUserId, dto.reason, { role: target.role }, { role: dto.role })

    return toPublicUser(updated)
  }

  // ---- Financial adjustment ---------------------------------------------------

  async financialAdjustment(dto: FinancialAdjustmentDto, adminId: string) {
    await this.stepUp.assertStepUpAuthorized(adminId, dto.confirmPassword, dto.totpCode)

    const amount = new Decimal(dto.amount)
    if (amount.lte(0)) throw new BadRequestException('Adjustment amount must be positive; use direction to credit or debit.')

    const account = await this.accounts.getPrimaryAccount(dto.userId)
    const { cash } = await this.ledger.getOrCreateUserLedgerAccounts(account.id)
    const revenue = await this.ledger.getSystemLedgerAccount('REVENUE')

    const entries = dto.direction === 'CREDIT'
      ? [
          { ledgerAccountId: revenue.id, direction: 'DEBIT' as const, amount, entryType: 'ADJUSTMENT' as const },
          { ledgerAccountId: cash.id, direction: 'CREDIT' as const, amount, entryType: 'ADJUSTMENT' as const },
        ]
      : [
          { ledgerAccountId: cash.id, direction: 'DEBIT' as const, amount, entryType: 'ADJUSTMENT' as const },
          { ledgerAccountId: revenue.id, direction: 'CREDIT' as const, amount, entryType: 'ADJUSTMENT' as const },
        ]

    const txn = await this.ledger.postTransaction({
      description: `Admin financial adjustment: ${dto.reason}`,
      relatedType: 'ADMIN_ADJUSTMENT',
      relatedId: dto.userId,
      idempotencyKey: dto.idempotencyKey,
      entries,
    })

    await this.recordAdminAction(adminId, AuditEvent.FINANCIAL_ADJUSTMENT, dto.userId, dto.reason, undefined, { direction: dto.direction, amount: dto.amount }, txn.id)

    return { ledgerTransactionId: txn.id, balances: await this.ledger.getAccountBalances(account.id) }
  }

  // ---- Platform-wide controls -------------------------------------------------

  async updatePlatformSettings(dto: UpdatePlatformSettingsDto, adminId: string) {
    await this.stepUp.assertStepUpAuthorized(adminId, dto.confirmPassword, dto.totpCode)
    const before = await this.platformSettings.get()
    const { reason, confirmPassword: _cp, totpCode: _totp, ...patch } = dto
    const updated = await this.platformSettings.update(patch, adminId)

    for (const [key, event] of [
      ['tradingEnabled', ['TRADING_RESUMED', 'TRADING_PAUSED']],
      ['depositsEnabled', ['DEPOSITS_RESUMED', 'DEPOSITS_PAUSED']],
      ['withdrawalsEnabled', ['WITHDRAWALS_RESUMED', 'WITHDRAWALS_PAUSED']],
      ['registrationsEnabled', ['REGISTRATIONS_RESUMED', 'REGISTRATIONS_PAUSED']],
    ] as const) {
      const newVal = (patch as any)[key]
      if (newVal !== undefined && newVal !== (before as any)[key]) {
        await this.recordAdminAction(adminId, newVal ? event[0] : event[1], undefined, reason, { [key]: (before as any)[key] }, { [key]: newVal })
      }
    }

    return updated
  }

  async updateMarketConfig(symbol: string, dto: UpdateMarketConfigDto, adminId: string) {
    const before = await this.markets.getMarketConfig(symbol)
    const { reason, ...patch } = dto
    const updated = await this.markets.setMarketConfig(symbol, patch)

    if (patch.tradingEnabled !== undefined && patch.tradingEnabled !== before.tradingEnabled) {
      await this.recordAdminAction(
        adminId,
        patch.tradingEnabled ? AuditEvent.MARKET_ENABLED : AuditEvent.MARKET_DISABLED,
        undefined,
        reason,
        { symbol, tradingEnabled: before.tradingEnabled },
        { symbol, tradingEnabled: patch.tradingEnabled },
      )
    }

    return updated
  }

  // ---- Admin management (permissions) --------------------------------------

  // ADMIN/SUPER_ADMIN accounts only — "creating/deleting administrators"
  // (role promotion/demotion) happens via updateUserRole above.
  async listAdmins() {
    const admins = await this.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
      orderBy: { createdAt: 'asc' },
      include: { userPermissions: { include: { permission: true } } },
    })
    return admins.map((a) => ({
      ...toPublicUser(a),
      permissions: a.userPermissions.map((p) => p.permission.key),
    }))
  }

  // Step-up required — this is "changing admin permissions" from the spec's
  // MFA list. SUPER_ADMIN-only at the controller level: an ADMIN can never
  // grant permissions, including to themselves, matching "SUPER_ADMIN
  // should remain the highest authority."
  async grantPermission(targetAdminId: string, permissionKey: PermissionKey, dto: GrantPermissionDto, superAdminId: string) {
    await this.stepUp.assertStepUpAuthorized(superAdminId, dto.confirmPassword, dto.totpCode)
    const permission = await this.prisma.permission.findUniqueOrThrow({ where: { key: permissionKey } })

    await this.prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: targetAdminId, permissionId: permission.id } },
      create: { userId: targetAdminId, permissionId: permission.id },
      update: {},
    })

    await this.recordAdminAction(superAdminId, AuditEvent.PERMISSION_CHANGED, targetAdminId, dto.reason, { granted: false }, { granted: true, permission: permissionKey })
    return this.listAdmins()
  }

  async revokePermission(targetAdminId: string, permissionKey: PermissionKey, superAdminId: string, dto: { reason: string; confirmPassword: string; totpCode: string }) {
    await this.stepUp.assertStepUpAuthorized(superAdminId, dto.confirmPassword, dto.totpCode)
    const permission = await this.prisma.permission.findUniqueOrThrow({ where: { key: permissionKey } })

    await this.prisma.userPermission.deleteMany({ where: { userId: targetAdminId, permissionId: permission.id } })

    await this.recordAdminAction(superAdminId, AuditEvent.PERMISSION_CHANGED, targetAdminId, dto.reason, { granted: true, permission: permissionKey }, { granted: false })
    return this.listAdmins()
  }

  // Withdrawal approval requires step-up too (explicitly listed as
  // sensitive) — kept here (rather than in WithdrawalsService, which has no
  // reason to know about password/TOTP re-authentication) so all
  // step-up-gated actions are visible in one place.
  async approveWithdrawalWithStepUp(withdrawalId: string, confirmPassword: string, totpCode: string, adminId: string, reason?: string) {
    await this.stepUp.assertStepUpAuthorized(adminId, confirmPassword, totpCode)
    return this.withdrawals.approve(withdrawalId, adminId, reason)
  }

  // ---- Audit trail -------------------------------------------------------------

  async listAuditLogs(limit?: number) {
    return this.audit.listRecent(limit)
  }

  private async recordAdminAction(
    adminId: string,
    action: string,
    targetUserId: string | undefined,
    reason: string | undefined,
    previousState: Prisma.InputJsonValue | undefined,
    newState: Prisma.InputJsonValue | undefined,
    ledgerTransactionId?: string,
  ) {
    await this.prisma.adminAction.create({
      data: { adminId, action, targetUserId, reason, previousState, newState, ledgerTransactionId },
    })
    await this.audit.record({
      actorId: adminId,
      action,
      targetType: targetUserId ? 'USER' : 'PLATFORM',
      targetId: targetUserId,
      previousState,
      newState,
      reason,
    })
  }
}
