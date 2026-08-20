import { BadRequestException, Controller, Get, Param, UseGuards } from '@nestjs/common'
import { CryptoDepositsService } from './crypto-deposits.service'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'

// Signed-in-user read of the currently offered crypto assets/networks
// (Part 4/5/6) and, per asset+network, the currently active receiving
// address for DISPLAY before the user submits a deposit (Part 13 steps
// 4-6 — the address/QR must be shown BEFORE submission, not only
// afterward). A receiving address is not a secret (Part 24) — it is meant
// to be shown to any user who wants to deposit that asset — but this still
// requires a session (never a public/unauthenticated endpoint). The SAME
// resolveForDeposit() call happens again, independently, at actual
// deposit-creation time in DepositsService — this endpoint never
// short-circuits that server-side revalidation.
@Controller('crypto-deposits')
@UseGuards(SessionAuthGuard)
export class CryptoDepositsController {
  constructor(private readonly cryptoDeposits: CryptoDepositsService) {}

  @Get('assets')
  listAssets() {
    return this.cryptoDeposits.listEnabledAssets()
  }

  @Get('assets/:symbol/networks/:networkCode')
  async resolveAddress(@Param('symbol') symbol: string, @Param('networkCode') networkCode: string) {
    const resolved = await this.cryptoDeposits.resolveForDeposit(decodeURIComponent(symbol), decodeURIComponent(networkCode).toUpperCase())
    if (!resolved.ok) throw new BadRequestException(resolved.message)
    return {
      symbol: resolved.asset.symbol,
      networkCode: resolved.network.networkCode,
      networkName: resolved.network.networkName,
      receivingAddress: resolved.network.receivingAddress,
      minimumDeposit: resolved.network.minimumDeposit,
    }
  }
}
