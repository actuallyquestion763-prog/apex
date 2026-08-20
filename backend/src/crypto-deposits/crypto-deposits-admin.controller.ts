import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { CryptoDepositsService } from './crypto-deposits.service'
import { StepUpService } from '../common/security/step-up.service'
import { CreateCryptoAssetDto, UpdateCryptoAssetDto, UpsertCryptoDepositAddressDto } from './dto/admin-crypto-dtos'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { RequirePermissions } from '../common/decorators/require-permissions.decorator'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../common/types/authenticated-user'

// Admin Deposit Management (Part 7/8) — same guard stack as every other
// admin controller. Asset create/enable/disable uses the `markets.control`-
// tier permission gate only (crypto_deposits.control, no step-up — a
// per-instrument listing toggle, not a fund-safety-critical change).
// Receiving-address create/edit IS step-up gated (Part 25) — it is the one
// operation in this module that can misdirect real customer funds.
@Controller('admin/crypto-deposits')
@UseGuards(SessionAuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class CryptoDepositsAdminController {
  constructor(
    private readonly cryptoDeposits: CryptoDepositsService,
    private readonly stepUp: StepUpService,
  ) {}

  @Get('assets')
  @RequirePermissions('crypto_deposits.read')
  listAssets() {
    return this.cryptoDeposits.adminListAssets()
  }

  @Post('assets')
  @RequirePermissions('crypto_deposits.control')
  createAsset(@Body() dto: CreateCryptoAssetDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.cryptoDeposits.createAsset(admin.id, dto)
  }

  @Patch('assets/:symbol')
  @RequirePermissions('crypto_deposits.control')
  updateAsset(@Param('symbol') symbol: string, @Body() dto: UpdateCryptoAssetDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.cryptoDeposits.updateAsset(admin.id, decodeURIComponent(symbol), dto)
  }

  // Step-up gated (Part 25) — this is the endpoint that sets/changes the
  // address real customer funds get sent to.
  @Patch('assets/:symbol/networks')
  @RequirePermissions('crypto_deposits.control')
  async upsertNetwork(@Param('symbol') symbol: string, @Body() dto: UpsertCryptoDepositAddressDto, @CurrentUser() admin: AuthenticatedUser) {
    await this.stepUp.assertStepUpAuthorized(admin.id, dto.confirmPassword, dto.totpCode)
    return this.cryptoDeposits.upsertNetworkAddress(admin.id, decodeURIComponent(symbol), dto)
  }
}
