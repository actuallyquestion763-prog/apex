import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common'
import * as argon2 from 'argon2'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { PlatformSettingsService } from '../platform-settings/platform-settings.service'
import { generateSessionToken, hashToken } from './token.util'
import { generateTotpSecret, verifyTotpCode, buildOtpAuthUrl } from './totp.util'
import { issuePendingLoginToken, verifyPendingLoginToken } from './pending-login.util'
import { AuditEvent } from '../audit/audit-events'
import type { RegisterDto } from './dto/register.dto'
import type { LoginDto } from './dto/login.dto'

const SESSION_TTL_MS = () => (Number(process.env.SESSION_TTL_HOURS ?? 24)) * 60 * 60 * 1000

export interface RequestMeta {
  ipAddress?: string
  userAgent?: string
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly platformSettings: PlatformSettingsService,
  ) {}

  // Registration creates identity + an empty trading account and NOTHING
  // else — no ledger accounts, no ledger entries, no balance of any kind.
  // Cash/available/reserved are all $0 by construction (there is no other
  // possible value: the User model has no stored balance, and no
  // LedgerAccount row exists yet for this Account — LedgerAccount rows are
  // created lazily, with zero entries, the first time a real financial
  // event touches this account: a deposit confirmation, a withdrawal
  // request, an order reservation, or an admin financial adjustment. See
  // LedgerService.getOrCreateUserLedgerAccounts). Registration must never
  // be the thing that manufactures money, in any environment — this is not
  // an environment-gated behavior, it simply does not exist here.
  async register(dto: RegisterDto, meta: RequestMeta) {
    await this.platformSettings.assertRegistrationsEnabled()

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } })
    if (existing) throw new ConflictException('An account with this email already exists.')

    const passwordHash = await argon2.hash(dto.password)

    const { user } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email.toLowerCase(),
          passwordHash,
          fullName: dto.fullName,
          country: dto.country,
        },
      })
      await tx.account.create({ data: { userId: user.id } })
      return { user }
    })

    await this.audit.record({
      actorId: user.id,
      action: AuditEvent.USER_REGISTERED,
      targetType: 'USER',
      targetId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    })

    return this.createSession(user.id, meta)
  }

  async login(dto: LoginDto, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } })
    const failMessage = 'Invalid email or password.'

    if (!user) {
      await this.audit.record({ action: AuditEvent.LOGIN_FAILED, targetType: 'USER', reason: 'unknown email', ipAddress: meta.ipAddress, userAgent: meta.userAgent })
      throw new UnauthorizedException(failMessage)
    }

    const valid = await argon2.verify(user.passwordHash, dto.password)
    if (!valid) {
      await this.audit.record({ actorId: user.id, action: AuditEvent.LOGIN_FAILED, targetType: 'USER', targetId: user.id, reason: 'bad password', ipAddress: meta.ipAddress, userAgent: meta.userAgent })
      throw new UnauthorizedException(failMessage)
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('This account is not active. Contact support.')
    }

    if (user.twoFactorEnabled) {
      return { needsTwoFactor: true, pendingToken: issuePendingLoginToken(user.id) }
    }

    await this.audit.record({ actorId: user.id, action: AuditEvent.LOGIN_SUCCEEDED, targetType: 'USER', targetId: user.id, ipAddress: meta.ipAddress, userAgent: meta.userAgent })
    return this.createSession(user.id, meta)
  }

  async verifyTwoFactorLogin(pendingToken: string, code: string, meta: RequestMeta) {
    const userId = verifyPendingLoginToken(pendingToken)
    if (!userId) throw new UnauthorizedException('This login attempt has expired. Please sign in again.')

    const credential = await this.prisma.twoFactorCredential.findUnique({ where: { userId } })
    if (!credential || !credential.enabled || !verifyTotpCode(credential.secret, code)) {
      await this.audit.record({ actorId: userId, action: AuditEvent.LOGIN_FAILED, targetType: 'USER', targetId: userId, reason: 'bad 2fa code', ipAddress: meta.ipAddress, userAgent: meta.userAgent })
      throw new UnauthorizedException('Invalid authentication code.')
    }

    await this.audit.record({ actorId: userId, action: AuditEvent.LOGIN_SUCCEEDED, targetType: 'USER', targetId: userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent })
    return this.createSession(userId, meta)
  }

  async logout(sessionId: string, userId: string, meta: RequestMeta) {
    await this.prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } })
    await this.audit.record({ actorId: userId, action: AuditEvent.LOGOUT, targetType: 'USER', targetId: userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent })
  }

  async setupTwoFactor(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
    const secret = generateTotpSecret()
    await this.prisma.twoFactorCredential.upsert({
      where: { userId },
      create: { userId, secret, enabled: false },
      update: { secret, enabled: false }, // re-generating always requires re-verification before it's active
    })
    return { secret, otpAuthUrl: buildOtpAuthUrl(secret, user.email) }
  }

  async confirmTwoFactor(userId: string, code: string) {
    const credential = await this.prisma.twoFactorCredential.findUnique({ where: { userId } })
    if (!credential) throw new BadRequestException('Call setup before confirming two-factor authentication.')
    if (!verifyTotpCode(credential.secret, code)) throw new BadRequestException('Invalid code.')
    await this.prisma.twoFactorCredential.update({ where: { userId }, data: { enabled: true } })
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } })
  }

  private async createSession(userId: string, meta: RequestMeta) {
    const token = generateSessionToken()
    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS()),
      },
    })
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })
    return { token, session, user }
  }
}
