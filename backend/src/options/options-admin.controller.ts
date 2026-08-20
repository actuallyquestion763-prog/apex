import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { OptionsService } from './options.service'
import { OptionsMarketService } from './options-market.service'
import { OptionsSettingsService } from './options-settings.service'
import { isDemoResultModeAllowed } from './sandbox-env'
import { StepUpService } from '../common/security/step-up.service'
import { AuditService } from '../audit/audit.service'
import { AuditEvent } from '../audit/audit-events'
import { CreateOptionMarketDto, UpdateOptionMarketDto, UpdateOptionsSettingsDto, UpsertOptionDurationDto } from './dto/admin-option-dtos'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { RequirePermissions } from '../common/decorators/require-permissions.decorator'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../common/types/authenticated-user'

// Same guard stack and step-up convention as AdminController — a dedicated
// controller (rather than folding into the existing 1000+ line
// admin.controller.ts) so the options domain stays self-contained end to
// end, while still living under /admin/options and requiring the exact same
// ADMIN/SUPER_ADMIN + permission (+ step-up for platform-wide settings)
// checks as every other admin route.
@Controller('admin/options')
@UseGuards(SessionAuthGuard, RolesGuard, PermissionsGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class OptionsAdminController {
  constructor(
    private readonly optionsService: OptionsService,
    private readonly optionsMarkets: OptionsMarketService,
    private readonly optionsSettings: OptionsSettingsService,
    private readonly stepUp: StepUpService,
    private readonly audit: AuditService,
  ) {}

  // ---- Settings (platform-wide options kill switch + risk limits) ---------
  // Step-up gated — same tier as PATCH /admin/platform-settings, since this
  // is exactly that kind of platform-wide financial control (Part 25).

  @Get('settings')
  @RequirePermissions('options.read')
  async getSettings() {
    const settings = await this.optionsSettings.get()
    // sandboxControlsAvailable lets the admin UI hide the outcome-mode
    // control entirely outside development/test — real enforcement is still
    // the write-path rejection below, this is purely so the panel doesn't
    // show a dead control in an environment where it can never do anything.
    return { ...settings, sandboxControlsAvailable: isDemoResultModeAllowed() }
  }

  @Patch('settings')
  @RequirePermissions('options.control')
  async updateSettings(@Body() dto: UpdateOptionsSettingsDto, @CurrentUser() admin: AuthenticatedUser) {
    await this.stepUp.assertStepUpAuthorized(admin.id, dto.confirmPassword, dto.totpCode)

    // Part 8 — "if NODE_ENV=production, the control must not exist and the
    // backend must reject any attempt to use it." Setting it explicitly TO
    // RANDOM (the inert/off state) is always allowed everywhere; only an
    // attempt to actually force an outcome is environment-gated.
    if (dto.sandboxOutcomeMode !== undefined && dto.sandboxOutcomeMode !== 'RANDOM' && !isDemoResultModeAllowed()) {
      throw new ForbiddenException('Sandbox outcome forcing is not available in this environment.')
    }

    const before = await this.optionsSettings.get()
    const { reason, confirmPassword: _cp, totpCode: _totp, ...patch } = dto
    const updated = await this.optionsSettings.update(patch, admin.id)

    if (patch.tradingEnabled !== undefined && patch.tradingEnabled !== before.tradingEnabled) {
      await this.audit.record({
        actorId: admin.id,
        action: patch.tradingEnabled ? AuditEvent.OPTIONS_TRADING_RESUMED : AuditEvent.OPTIONS_TRADING_PAUSED,
        targetType: 'OPTIONS_SETTINGS',
        reason,
      })
    }
    if (patch.sandboxOutcomeMode !== undefined && patch.sandboxOutcomeMode !== before.sandboxOutcomeMode) {
      await this.audit.record({
        actorId: admin.id,
        action: AuditEvent.SANDBOX_OUTCOME_MODE_CHANGED,
        targetType: 'OPTIONS_SETTINGS',
        reason,
        previousState: { sandboxOutcomeMode: before.sandboxOutcomeMode },
        newState: { sandboxOutcomeMode: updated.sandboxOutcomeMode },
      })
    }
    await this.audit.record({
      actorId: admin.id,
      action: AuditEvent.OPTIONS_SETTINGS_CHANGED,
      targetType: 'OPTIONS_SETTINGS',
      reason,
      previousState: { tradingEnabled: before.tradingEnabled, maxActiveTradesPerUser: before.maxActiveTradesPerUser, maxExposurePerUser: before.maxExposurePerUser?.toString() ?? null },
      newState: { tradingEnabled: updated.tradingEnabled, maxActiveTradesPerUser: updated.maxActiveTradesPerUser, maxExposurePerUser: updated.maxExposurePerUser?.toString() ?? null },
    })
    return updated
  }

  // ---- Asset / duration configuration (no step-up — same tier as
  // PATCH /admin/markets/:symbol, a per-instrument config change, not a
  // platform-wide control). -------------------------------------------------

  @Get('markets')
  @RequirePermissions('options.read')
  listMarkets() {
    return this.optionsMarkets.adminListMarkets()
  }

  @Post('markets')
  @RequirePermissions('options.control')
  createMarket(@Body() dto: CreateOptionMarketDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.optionsMarkets.createMarket(admin.id, dto)
  }

  @Patch('markets/:symbol')
  @RequirePermissions('options.control')
  updateMarket(@Param('symbol') symbol: string, @Body() dto: UpdateOptionMarketDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.optionsMarkets.updateMarket(admin.id, decodeURIComponent(symbol), dto)
  }

  @Patch('markets/:symbol/durations')
  @RequirePermissions('options.control')
  upsertDuration(@Param('symbol') symbol: string, @Body() dto: UpsertOptionDurationDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.optionsMarkets.upsertDuration(admin.id, decodeURIComponent(symbol), dto)
  }

  // ---- Visibility / operations ----------------------------------------------

  @Get('unresolved')
  @RequirePermissions('options.read')
  listUnresolved() {
    return this.optionsService.listUnresolvedTrades()
  }

  @Get('stats')
  @RequirePermissions('options.read')
  getStats() {
    return this.optionsService.getStats()
  }

  // On-demand retry sweep — genuinely useful after a price-feed outage
  // recovers, rather than waiting for the next automatic 2s cycle. Mirrors
  // POST /admin/reconciliation/run's shape (an active, on-demand operation,
  // not a passive read) — no step-up (identical read/retry-only tier as
  // that endpoint; never posts a fabricated result, only retries the same
  // safe, idempotent settlement path the automatic sweep already uses).
  @Post('sweep')
  @RequirePermissions('options.control')
  runSweep() {
    return this.optionsService.runExpirySweep()
  }
}
