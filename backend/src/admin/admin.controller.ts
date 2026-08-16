import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { IsString, MinLength } from 'class-validator'
import { AdminService } from './admin.service'
import { DepositsService } from '../deposits/deposits.service'
import { WithdrawalsService } from '../withdrawals/withdrawals.service'
import { KycService } from '../kyc/kyc.service'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { RequirePermissions } from '../common/decorators/require-permissions.decorator'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { FinancialAdjustmentDto } from './dto/financial-adjustment.dto'
import { UpdateUserStatusDto } from './dto/update-user-status.dto'
import { UpdateUserRoleDto } from './dto/update-user-role.dto'
import { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto'
import { UpdateMarketConfigDto } from './dto/update-market-config.dto'
import { GrantPermissionDto } from './dto/grant-permission.dto'
import { ApproveWithdrawalDto } from './dto/approve-withdrawal.dto'
import type { PermissionKey } from '../common/permissions'

class ReasonDto {
  @IsString()
  @MinLength(3)
  reason!: string
}

class RevokePermissionDto {
  @IsString()
  @MinLength(3)
  reason!: string

  @IsString()
  confirmPassword!: string

  @IsString()
  totpCode!: string
}

/**
 * Every route requires an authenticated session AND an ADMIN or
 * SUPER_ADMIN role (RolesGuard) AND, per-route, a specific fine-grained
 * permission (PermissionsGuard, @RequirePermissions(...)) — SUPER_ADMIN
 * bypasses the permission check (full platform control); a fresh ADMIN has
 * NO permissions granted by default and sees 403 on everything until a
 * SUPER_ADMIN explicitly grants each one. Role changes and permission
 * grants are SUPER_ADMIN-only regardless of any permission grant — an
 * ADMIN can never escalate itself or anyone else.
 */
@Controller('admin')
@UseGuards(SessionAuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly depositsService: DepositsService,
    private readonly withdrawalsService: WithdrawalsService,
    private readonly kycService: KycService,
  ) {}

  @Get('overview')
  @RequirePermissions('platform.read')
  getOverview() {
    return this.adminService.getOverview()
  }

  @Get('users')
  @RequirePermissions('users.read')
  listUsers() {
    return this.adminService.listUsers()
  }

  @Patch('users/:id/status')
  @RequirePermissions('users.write')
  updateUserStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.adminService.updateUserStatus(id, dto, admin.id)
  }

  // SUPER_ADMIN only — an ADMIN cannot grant themselves or anyone else a
  // higher role, even with every permission granted. This is also how
  // "creating"/"deleting" an administrator works (promote/demote).
  @Patch('users/:id/role')
  @Roles('SUPER_ADMIN')
  updateUserRole(@Param('id') id: string, @Body() dto: UpdateUserRoleDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.adminService.updateUserRole(id, dto, admin.id)
  }

  @Post('financial-adjustment')
  @RequirePermissions('ledger.adjust')
  financialAdjustment(@Body() dto: FinancialAdjustmentDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.adminService.financialAdjustment(dto, admin.id)
  }

  @Get('deposits')
  @RequirePermissions('deposits.read')
  listDeposits(@Query('status') status?: string) {
    return this.depositsService.listAll(status)
  }

  @Post('deposits/:id/confirm')
  @RequirePermissions('deposits.review')
  confirmDeposit(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.depositsService.confirm(id, admin.id, dto.reason)
  }

  @Post('deposits/:id/reject')
  @RequirePermissions('deposits.review')
  rejectDeposit(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.depositsService.reject(id, admin.id, dto.reason)
  }

  @Get('withdrawals')
  @RequirePermissions('withdrawals.read')
  listWithdrawals(@Query('status') status?: string) {
    return this.withdrawalsService.listAll(status)
  }

  // Withdrawal approval is one of the explicitly listed step-up-required
  // actions — password + fresh TOTP, not just the withdrawals.review
  // permission.
  @Post('withdrawals/:id/approve')
  @RequirePermissions('withdrawals.review')
  approveWithdrawal(@Param('id') id: string, @Body() dto: ApproveWithdrawalDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.adminService.approveWithdrawalWithStepUp(id, dto.confirmPassword, dto.totpCode, admin.id, dto.reason)
  }

  @Post('withdrawals/:id/reject')
  @RequirePermissions('withdrawals.review')
  rejectWithdrawal(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.withdrawalsService.reject(id, admin.id, dto.reason)
  }

  @Get('kyc/pending')
  @RequirePermissions('kyc.read')
  listPendingKyc() {
    return this.kycService.listPending()
  }

  @Post('kyc/:id/approve')
  @RequirePermissions('kyc.review')
  approveKyc(@Param('id') id: string, @CurrentUser() admin: AuthenticatedUser) {
    return this.kycService.approve(id, admin.id)
  }

  @Post('kyc/:id/reject')
  @RequirePermissions('kyc.review')
  rejectKyc(@Param('id') id: string, @Body() dto: ReasonDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.kycService.reject(id, admin.id, dto.reason)
  }

  // "Changing platform-wide trading controls" / "disabling security
  // controls" — both map to this one step-up-gated endpoint, the only
  // place platform-wide kill switches live.
  @Patch('platform-settings')
  @RequirePermissions('platform.control')
  updatePlatformSettings(@Body() dto: UpdatePlatformSettingsDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.adminService.updatePlatformSettings(dto, admin.id)
  }

  @Patch('markets/:symbol')
  @RequirePermissions('markets.control')
  updateMarketConfig(@Param('symbol') symbol: string, @Body() dto: UpdateMarketConfigDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.adminService.updateMarketConfig(decodeURIComponent(symbol), dto, admin.id)
  }

  @Get('audit-logs')
  @RequirePermissions('audit.read')
  listAuditLogs(@Query('limit') limit?: string) {
    return this.adminService.listAuditLogs(limit ? Number(limit) : undefined)
  }

  @Get('admins')
  @RequirePermissions('admins.read')
  listAdmins() {
    return this.adminService.listAdmins()
  }

  // SUPER_ADMIN only + step-up — granting/revoking permissions is itself
  // one of the explicitly listed sensitive operations.
  @Patch('admins/:id/permissions/:permission/grant')
  @Roles('SUPER_ADMIN')
  grantPermission(@Param('id') id: string, @Param('permission') permission: string, @Body() dto: GrantPermissionDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.adminService.grantPermission(id, permission as PermissionKey, dto, admin.id)
  }

  @Patch('admins/:id/permissions/:permission/revoke')
  @Roles('SUPER_ADMIN')
  revokePermission(@Param('id') id: string, @Param('permission') permission: string, @Body() dto: RevokePermissionDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.adminService.revokePermission(id, permission as PermissionKey, admin.id, dto)
  }
}
