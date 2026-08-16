import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common'
import * as argon2 from 'argon2'
import { PrismaService } from '../../prisma/prisma.service'
import { verifyTotpCode } from '../../auth/totp.util'

/**
 * Step-up re-authentication for the platform's most sensitive operations:
 * financial adjustments, withdrawal approval, admin permission changes,
 * role changes, and platform-wide control changes.
 *
 * Two independent factors, both checked against the ACTING admin's own
 * credentials (never trusted from the request body beyond the values being
 * verified) — the existing open session alone is never sufficient for these:
 *   1. Current password (argon2.verify)
 *   2. A fresh TOTP code (RFC 6238, ±30s window)
 *
 * If the admin hasn't enabled 2FA yet, these operations are blocked
 * entirely with a clear message rather than silently skipping the second
 * factor — "do not rely only on the frontend" extends to "do not silently
 * degrade a two-factor requirement to one factor."
 */
@Injectable()
export class StepUpService {
  constructor(private readonly prisma: PrismaService) {}

  async assertStepUpAuthorized(adminId: string, confirmPassword: string, totpCode: string) {
    const admin = await this.prisma.user.findUniqueOrThrow({ where: { id: adminId } })

    const passwordValid = await argon2.verify(admin.passwordHash, confirmPassword)
    if (!passwordValid) throw new UnauthorizedException('Re-authentication failed: incorrect password.')

    const credential = await this.prisma.twoFactorCredential.findUnique({ where: { userId: adminId } })
    if (!credential || !credential.enabled || !admin.twoFactorEnabled) {
      throw new BadRequestException('Two-factor authentication must be enabled on this admin account before performing this action.')
    }
    if (!verifyTotpCode(credential.secret, totpCode)) {
      throw new UnauthorizedException('Re-authentication failed: invalid authentication code.')
    }
  }
}
