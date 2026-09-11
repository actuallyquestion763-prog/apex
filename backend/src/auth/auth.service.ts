import { BadRequestException, ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import * as argon2 from 'argon2'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { PlatformSettingsService } from '../platform-settings/platform-settings.service'
import { EmailService } from '../email/email.service'
import { generateSessionToken, hashToken } from './token.util'
import { generateTotpSecret, verifyTotpCode, buildOtpAuthUrl } from './totp.util'
import { issuePendingLoginToken, verifyPendingLoginToken } from './pending-login.util'
import { generateReferralCode } from './referral-code.util'
import { AuditEvent } from '../audit/audit-events'
import type { RegisterDto } from './dto/register.dto'
import type { LoginDto } from './dto/login.dto'
import type { ChangePasswordDto } from './dto/change-password.dto'

const REFERRAL_CODE_MAX_ATTEMPTS = 5

const SESSION_TTL_MS = () => (Number(process.env.SESSION_TTL_HOURS ?? 24)) * 60 * 60 * 1000

// Short-lived on purpose (Part 9/5) — a password-reset link is far more
// sensitive than an ordinary session if intercepted (an inbox compromise or
// a shared/forwarded email is a more realistic exposure than a stolen
// cookie), so this is deliberately much shorter than SESSION_TTL_MS.
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000
const RESET_TOKEN_TTL_MINUTES = RESET_TOKEN_TTL_MS / 60_000

export interface RequestMeta {
  ipAddress?: string
  userAgent?: string
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService')

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly email: EmailService,
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
      let user
      // Collision odds against a 32-char alphabet, 8-char code are
      // astronomically low (~1 in 1e12 per pair) — the retry loop exists
      // purely as a correctness backstop, not because collisions are
      // expected in practice.
      for (let attempt = 1; ; attempt++) {
        try {
          user = await tx.user.create({
            data: {
              email: dto.email.toLowerCase(),
              passwordHash,
              fullName: dto.fullName,
              country: dto.country,
              referralCode: generateReferralCode(),
            },
          })
          break
        } catch (err) {
          const isReferralCodeCollision =
            err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' &&
            Array.isArray((err.meta as { target?: unknown })?.target) &&
            (err.meta!.target as string[]).includes('referralCode')
          if (!isReferralCodeCollision || attempt >= REFERRAL_CODE_MAX_ATTEMPTS) throw err
        }
      }
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

  // Requires the current password (never trusts session presence alone for
  // a credential change) and, on success, revokes every OTHER active
  // session for this user — a changed password should end any session an
  // attacker (or a stale forgotten device) might be holding, without also
  // logging the user out of the device they're changing it from.
  async changePassword(userId: string, currentSessionId: string, dto: ChangePasswordDto, meta: RequestMeta) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } })

    const valid = await argon2.verify(user.passwordHash, dto.currentPassword)
    if (!valid) {
      await this.audit.record({ actorId: userId, action: AuditEvent.LOGIN_FAILED, targetType: 'USER', targetId: userId, reason: 'bad current password on change-password', ipAddress: meta.ipAddress, userAgent: meta.userAgent })
      throw new UnauthorizedException('Current password is incorrect.')
    }

    const passwordHash = await argon2.hash(dto.newPassword)
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null, id: { not: currentSessionId } },
        data: { revokedAt: new Date() },
      }),
    ])

    await this.audit.record({ actorId: userId, action: AuditEvent.PASSWORD_CHANGED, targetType: 'USER', targetId: userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent })
  }

  // Part 3 — the API response and timing profile must never reveal whether
  // `email` belongs to an account: both branches below end the same way
  // (this method returns void either way, and the controller always sends
  // the same generic message regardless of what happened here). Works for
  // ADMIN/SUPER_ADMIN exactly like any other role (Part 7) — nothing here
  // branches on user.role; only whoever holds the emailed link can proceed,
  // so this can never be used to take over an admin account merely by
  // knowing its email.
  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } })
    if (!user) {
      await this.audit.record({ action: AuditEvent.PASSWORD_RESET_REQUESTED, targetType: 'USER', reason: 'unknown email', ipAddress: meta.ipAddress, userAgent: meta.userAgent })
      return
    }

    const token = generateSessionToken() // same CSPRNG (crypto.randomBytes) as session tokens — never Math.random(), a timestamp, or any user-derived value
    const tokenHash = hashToken(token)

    await this.prisma.$transaction([
      // Part 3 — invalidate previous unused reset tokens for this account,
      // so at most one reset link is ever live at a time.
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
      }),
    ])

    await this.audit.record({ actorId: user.id, action: AuditEvent.PASSWORD_RESET_REQUESTED, targetType: 'USER', targetId: user.id, ipAddress: meta.ipAddress, userAgent: meta.userAgent })

    const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'
    const resetUrl = `${frontendOrigin}/reset-password?token=${token}`
    try {
      await this.email.sendPasswordResetEmail(user.email, resetUrl, RESET_TOKEN_TTL_MINUTES)
    } catch (err) {
      // A delivery failure must never surface to the caller (that would be
      // an observable difference from the "email doesn't exist" branch) and
      // must never log the token/URL themselves (Part 3/9) — only that
      // sending failed.
      this.logger.error(`Failed to send password reset email: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Deliberately does not authenticate the caller afterward (Part 6/12) —
  // this only ever changes the password hash; it never touches
  // TwoFactorCredential or User.twoFactorEnabled (Part 8), so an account
  // that had 2FA enabled before a reset still has it enabled after, and
  // still requires it on the very next login.
  async resetPassword(rawToken: string, newPassword: string, meta: RequestMeta): Promise<void> {
    const tokenHash = hashToken(rawToken)
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } })

    // Distinct messages for not-found/used/expired are safe here (unlike
    // forgotPassword's account-existence check): the token itself is a
    // 256-bit secret nobody can guess, so telling its holder which of these
    // three happened leaks nothing about any account.
    if (!record) throw new BadRequestException('This password reset link is invalid.')
    if (record.usedAt) throw new BadRequestException('This password reset link has already been used.')
    if (record.expiresAt < new Date()) throw new BadRequestException('This password reset link has expired. Please request a new one.')

    const passwordHash = await argon2.hash(newPassword)
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // No "current session" exists during an unauthenticated reset (unlike
      // changePassword's "every OTHER session") — every active session for
      // this account is revoked, so a reset always requires a fresh login.
      this.prisma.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ])

    await this.audit.record({ actorId: record.userId, action: AuditEvent.PASSWORD_RESET_COMPLETED, targetType: 'USER', targetId: record.userId, ipAddress: meta.ipAddress, userAgent: meta.userAgent })
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
