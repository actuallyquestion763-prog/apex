import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Throttle } from '@nestjs/throttler'
import { CryptoDepositsService } from './crypto-deposits.service'
import { StepUpService } from '../common/security/step-up.service'
import { CreateCryptoAssetDto, UpdateCryptoAssetDto, UpsertCryptoDepositAddressDto } from './dto/admin-crypto-dtos'
import { DeleteNetworkDto } from './dto/delete-network.dto'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { RequirePermissions } from '../common/decorators/require-permissions.decorator'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { MEDIA_UPLOAD_THROTTLE } from '../common/rate-limits'
import type { AuthenticatedUser } from '../common/types/authenticated-user'

interface UploadedFileLike {
  originalname: string
  mimetype: string
  buffer: Buffer
}

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
  // address real customer funds get sent to. multipart/form-data so an
  // optional QR image ("qr" field) can travel alongside the JSON-ish body
  // fields in one request — see UpsertCryptoDepositAddressDto's own comment
  // on why its boolean/int fields use explicit @Transform() for this.
  @Patch('assets/:symbol/networks')
  @RequirePermissions('crypto_deposits.control')
  @Throttle(MEDIA_UPLOAD_THROTTLE)
  @UseInterceptors(FileInterceptor('qr'))
  async upsertNetwork(
    @Param('symbol') symbol: string,
    @Body() dto: UpsertCryptoDepositAddressDto,
    @UploadedFile() qr: UploadedFileLike | undefined,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    await this.stepUp.assertStepUpAuthorized(admin.id, dto.confirmPassword)
    return this.cryptoDeposits.upsertNetworkAddress(admin.id, decodeURIComponent(symbol), dto, qr)
  }

  // Step-up gated — same tier as changing a receiving address (Part 25).
  // Safe to hard-delete: see CryptoDepositsService.deleteNetworkAddress's
  // own comment on why this can never orphan a historical deposit record.
  @Delete('assets/:symbol/networks/:networkCode')
  @RequirePermissions('crypto_deposits.control')
  async deleteNetwork(
    @Param('symbol') symbol: string,
    @Param('networkCode') networkCode: string,
    @Body() dto: DeleteNetworkDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    await this.stepUp.assertStepUpAuthorized(admin.id, dto.confirmPassword)
    return this.cryptoDeposits.deleteNetworkAddress(admin.id, decodeURIComponent(symbol), decodeURIComponent(networkCode), dto.reason)
  }
}
