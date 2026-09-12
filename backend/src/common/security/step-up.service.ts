import { Injectable, UnauthorizedException } from '@nestjs/common'
import * as argon2 from 'argon2'
import { PrismaService } from '../../prisma/prisma.service'

/**
 * Step-up re-authentication for the platform's most sensitive operations:
 * financial adjustments, withdrawal approval, crypto receiving-address
 * changes, admin permission/role changes, admin management, and
 * platform-wide control changes.
 *
 * Password-only, by explicit product decision: the acting admin's own
 * current password is verified fresh (argon2.verify) for every one of
 * these actions — the existing open session alone is never sufficient.
 * This intentionally does NOT check TOTP/2FA at all, for any admin
 * action — a prior design required a fresh TOTP code here too, but that
 * requirement has been removed platform-wide at the operator's explicit
 * request. Ordinary account 2FA (setup/confirm/login-verify — see
 * src/auth/auth.service.ts and src/auth/totp.util.ts) is completely
 * unrelated and untouched: an admin who has 2FA enabled still needs it to
 * log in, this only concerns re-authenticating for a sensitive action once
 * already logged in.
 */
@Injectable()
export class StepUpService {
  constructor(private readonly prisma: PrismaService) {}

  async assertStepUpAuthorized(adminId: string, confirmPassword: string) {
    const admin = await this.prisma.user.findUniqueOrThrow({ where: { id: adminId } })
    const passwordValid = await argon2.verify(admin.passwordHash, confirmPassword)
    if (!passwordValid) throw new UnauthorizedException('Re-authentication failed: incorrect password.')
  }
}
