import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

const SINGLETON_ID = 'singleton'

// Kept as its own singleton table (not folded into PlatformSettings) so the
// options product's config can evolve independently of spot/deposits/
// withdrawals/registrations — same pattern as platform-settings.service.ts,
// deliberately duplicated rather than shared, per the product requirement
// that this be a separate, clean domain. `tradingEnabled` defaults to false
// at the schema level (a brand-new financial product must never silently go
// live) — this service does not override that default, it only enforces it.
@Injectable()
export class OptionsSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    const existing = await this.prisma.optionsSettings.findUnique({ where: { id: SINGLETON_ID } })
    if (existing) return existing
    return this.prisma.optionsSettings.create({ data: { id: SINGLETON_ID } })
  }

  async update(
    patch: Partial<{
      tradingEnabled: boolean
      maxActiveTradesPerUser: number | null
      maxExposurePerUser: string | null
      sandboxOutcomeMode: 'RANDOM' | 'FORCE_WIN' | 'FORCE_LOSS'
    }>,
    updatedByAdminId: string,
  ) {
    await this.get()
    return this.prisma.optionsSettings.update({
      where: { id: SINGLETON_ID },
      data: { ...patch, updatedByAdminId },
    })
  }

  async assertTradingEnabled() {
    const s = await this.get()
    if (!s.tradingEnabled) throw new ServiceUnavailableException('Options trading is temporarily paused platform-wide.')
  }
}
