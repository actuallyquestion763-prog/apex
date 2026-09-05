import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import { PrismaService } from '../prisma/prisma.service'
import { MarketsService } from '../markets/markets.service'
import { AuditService } from '../audit/audit.service'
import { AuditEvent } from '../audit/audit-events'

// Admin CRUD for OptionMarket/OptionDuration, plus the read path the public
// trading UI uses to know which assets/durations/payouts are currently
// offered (Part 1/4/5 — never hardcoded in React). OptionMarket.symbol is
// resolved against MarketConfig by plain string equality (the same loose
// coupling Order.symbol already uses against MarketConfig — no FK) so this
// service is also where "does a MarketConfig with this symbol exist"
// validation happens, once, rather than at every call site.
@Injectable()
export class OptionsMarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly markets: MarketsService,
    private readonly audit: AuditService,
  ) {}

  // ---- Public read path (trading UI) ---------------------------------------

  async listEnabledMarkets() {
    const optionMarkets = await this.prisma.optionMarket.findMany({
      where: { enabled: true, durations: { some: { enabled: true } } },
      include: { durations: { where: { enabled: true }, orderBy: { durationSeconds: 'asc' } } },
      orderBy: { symbol: 'asc' },
    })
    // Enrich with the underlying MarketConfig's display metadata — never
    // duplicated into OptionMarket itself, always read fresh.
    const results = []
    for (const m of optionMarkets) {
      // getMarketConfig() never throws — it auto-creates a fail-closed
      // default row for a never-seen symbol (see markets.service.ts) —
      // this call is purely for display metadata, never a validity gate.
      const config = await this.markets.getMarketConfig(m.symbol)
      results.push({
        symbol: m.symbol,
        displayName: config.displayName || m.symbol,
        currency: m.currency,
        minInvestment: m.minInvestment,
        maxInvestment: m.maxInvestment,
        durations: m.durations.map((d) => ({ durationSeconds: d.durationSeconds, payoutPercent: d.payoutPercent, minAmount: d.minAmount })),
      })
    }
    return results
  }

  // Resolves and validates one asset+duration combination for trade
  // creation — the single place OptionsService asks "is this a legal
  // (symbol, durationSeconds) pair right now, and if so what's its payout."
  async resolveForTrade(symbol: string, durationSeconds: number) {
    const market = await this.prisma.optionMarket.findUnique({ where: { symbol }, include: { durations: true } })
    if (!market || !market.enabled) {
      return { ok: false as const, reason: 'ASSET_DISABLED', message: `Options trading is not available for ${symbol}.` }
    }
    const duration = market.durations.find((d) => d.durationSeconds === durationSeconds)
    if (!duration || !duration.enabled) {
      return { ok: false as const, reason: 'DURATION_DISABLED', message: `The ${durationSeconds}s duration is not available for ${symbol}.` }
    }
    return { ok: true as const, market, duration }
  }

  // ---- Admin CRUD -----------------------------------------------------------

  async adminListMarkets() {
    return this.prisma.optionMarket.findMany({ include: { durations: { orderBy: { durationSeconds: 'asc' } } }, orderBy: { symbol: 'asc' } })
  }

  async createMarket(
    adminId: string,
    input: { symbol: string; currency?: string; minInvestment?: string; maxInvestment?: string | null },
  ) {
    // getMarketConfig() never throws — it auto-creates a fail-closed default
    // (SIMULATED, no provider, trading disabled) if this symbol has never
    // been configured. That is a legitimate starting point for an
    // OptionMarket too: the asset simply won't have a usable price (and
    // therefore can't accept a trade) until an admin separately configures
    // its provider mapping via Admin > Markets — never a fabricated price.
    await this.markets.getMarketConfig(input.symbol)
    const existing = await this.prisma.optionMarket.findUnique({ where: { symbol: input.symbol } })
    if (existing) throw new BadRequestException(`An OptionMarket for "${input.symbol}" already exists.`)

    const created = await this.prisma.optionMarket.create({
      data: {
        symbol: input.symbol,
        currency: input.currency ?? 'USDT',
        minInvestment: new Decimal(input.minInvestment ?? '1'),
        maxInvestment: input.maxInvestment ? new Decimal(input.maxInvestment) : null,
      },
    })
    await this.audit.record({ actorId: adminId, action: AuditEvent.OPTION_MARKET_CHANGED, targetType: 'OPTION_MARKET', targetId: created.id, newState: { symbol: created.symbol, created: true } })
    return created
  }

  async updateMarket(
    adminId: string,
    symbol: string,
    patch: Partial<{ enabled: boolean; currency: string; minInvestment: string; maxInvestment: string | null }>,
  ) {
    const before = await this.prisma.optionMarket.findUnique({ where: { symbol } })
    if (!before) throw new NotFoundException(`No OptionMarket for symbol "${symbol}".`)

    const data: Record<string, unknown> = {}
    if (patch.enabled !== undefined) data.enabled = patch.enabled
    if (patch.currency !== undefined) data.currency = patch.currency
    if (patch.minInvestment !== undefined) data.minInvestment = new Decimal(patch.minInvestment)
    if (patch.maxInvestment !== undefined) data.maxInvestment = patch.maxInvestment === null ? null : new Decimal(patch.maxInvestment)

    const updated = await this.prisma.optionMarket.update({ where: { symbol }, data })
    await this.audit.record({
      actorId: adminId,
      action: AuditEvent.OPTION_MARKET_CHANGED,
      targetType: 'OPTION_MARKET',
      targetId: updated.id,
      previousState: { enabled: before.enabled, currency: before.currency, minInvestment: before.minInvestment.toString(), maxInvestment: before.maxInvestment?.toString() ?? null },
      newState: { enabled: updated.enabled, currency: updated.currency, minInvestment: updated.minInvestment.toString(), maxInvestment: updated.maxInvestment?.toString() ?? null },
    })
    return updated
  }

  async upsertDuration(
    adminId: string,
    symbol: string,
    input: { durationSeconds: number; enabled?: boolean; payoutPercent: string; minAmount?: string },
  ) {
    const market = await this.prisma.optionMarket.findUnique({ where: { symbol } })
    if (!market) throw new NotFoundException(`No OptionMarket for symbol "${symbol}".`)
    if (input.durationSeconds <= 0) throw new BadRequestException('durationSeconds must be positive.')

    const before = await this.prisma.optionDuration.findUnique({
      where: { optionMarketId_durationSeconds: { optionMarketId: market.id, durationSeconds: input.durationSeconds } },
    })

    const updated = await this.prisma.optionDuration.upsert({
      where: { optionMarketId_durationSeconds: { optionMarketId: market.id, durationSeconds: input.durationSeconds } },
      create: {
        optionMarketId: market.id,
        durationSeconds: input.durationSeconds,
        enabled: input.enabled ?? true,
        payoutPercent: new Decimal(input.payoutPercent),
        minAmount: new Decimal(input.minAmount ?? '0'),
      },
      update: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        payoutPercent: new Decimal(input.payoutPercent),
        ...(input.minAmount !== undefined ? { minAmount: new Decimal(input.minAmount) } : {}),
      },
    })

    await this.audit.record({
      actorId: adminId,
      action: AuditEvent.OPTION_DURATION_CHANGED,
      targetType: 'OPTION_DURATION',
      targetId: updated.id,
      previousState: before ? { enabled: before.enabled, payoutPercent: before.payoutPercent.toString(), minAmount: before.minAmount.toString() } : undefined,
      newState: { symbol, durationSeconds: updated.durationSeconds, enabled: updated.enabled, payoutPercent: updated.payoutPercent.toString(), minAmount: updated.minAmount.toString() },
    })
    return updated
  }
}
