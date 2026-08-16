import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

const SINGLETON_ID = 'singleton'

// Server-enforced kill switches. Every module that guards an action behind
// one of these (registration, deposits, withdrawals, trading) must call the
// corresponding assert*Enabled() method BEFORE performing the action — this
// is what makes it a real switch instead of a UI-only toggle. The row is
// created lazily with safe defaults (everything enabled) if it doesn't exist
// yet, so a fresh database doesn't accidentally start locked out.
@Injectable()
export class PlatformSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    const existing = await this.prisma.platformSettings.findUnique({ where: { id: SINGLETON_ID } })
    if (existing) return existing
    return this.prisma.platformSettings.create({ data: { id: SINGLETON_ID } })
  }

  async update(patch: Partial<{ tradingEnabled: boolean; depositsEnabled: boolean; withdrawalsEnabled: boolean; registrationsEnabled: boolean }>, updatedByAdminId: string) {
    await this.get() // ensure row exists
    return this.prisma.platformSettings.update({
      where: { id: SINGLETON_ID },
      data: { ...patch, updatedByAdminId },
    })
  }

  async assertTradingEnabled() {
    const s = await this.get()
    if (!s.tradingEnabled) throw new ServiceUnavailableException('Trading is temporarily paused platform-wide.')
  }

  async assertDepositsEnabled() {
    const s = await this.get()
    if (!s.depositsEnabled) throw new ServiceUnavailableException('Deposits are temporarily paused platform-wide.')
  }

  async assertWithdrawalsEnabled() {
    const s = await this.get()
    if (!s.withdrawalsEnabled) throw new ServiceUnavailableException('Withdrawals are temporarily paused platform-wide.')
  }

  async assertRegistrationsEnabled() {
    const s = await this.get()
    if (!s.registrationsEnabled) throw new ServiceUnavailableException('New registrations are temporarily paused.')
  }
}
