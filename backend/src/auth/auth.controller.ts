import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common'
import type { Request, Response } from 'express'
import { AuthService } from './auth.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
import { VerifyTotpDto } from './dto/verify-totp.dto'
import { SESSION_COOKIE_NAME } from './auth.constants'
import { SessionAuthGuard } from '../common/guards/session-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { AuthenticatedUser } from '../common/types/authenticated-user'
import { toPublicUser } from '../users/public-user'
import { UsersService } from '../users/users.service'

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] }
}

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Post('register')
  @HttpCode(201)
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token, user, session } = await this.authService.register(dto, requestMeta(req))
    res.cookie(SESSION_COOKIE_NAME, token, { ...COOKIE_OPTS, expires: session.expiresAt })
    return { user: toPublicUser(user) }
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto, requestMeta(req))
    if ('needsTwoFactor' in result) return result
    res.cookie(SESSION_COOKIE_NAME, result.token, { ...COOKIE_OPTS, expires: result.session.expiresAt })
    return { user: toPublicUser(result.user) }
  }

  @Post('2fa/login-verify')
  @HttpCode(200)
  async verifyTwoFactorLogin(@Body() dto: VerifyTotpDto & { pendingToken: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token, user, session } = await this.authService.verifyTwoFactorLogin(dto.pendingToken, dto.code, requestMeta(req))
    res.cookie(SESSION_COOKIE_NAME, token, { ...COOKIE_OPTS, expires: session.expiresAt })
    return { user: toPublicUser(user) }
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  async logout(@CurrentUser() user: AuthenticatedUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(user.sessionId, user.id, requestMeta(req))
    res.clearCookie(SESSION_COOKIE_NAME, { ...COOKIE_OPTS })
  }

  // Returns the full profile (fullName, kycStatus, twoFactorEnabled, etc.),
  // not just the minimal {id, email, role, status} shape SessionAuthGuard
  // uses internally for authorization decisions — the frontend needs the
  // former to render the UI at all.
  @Get('me')
  @UseGuards(SessionAuthGuard)
  async me(@CurrentUser() user: AuthenticatedUser) {
    return { user: await this.usersService.getPublicProfile(user.id) }
  }

  @Post('2fa/setup')
  @UseGuards(SessionAuthGuard)
  setupTwoFactor(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.setupTwoFactor(user.id)
  }

  @Post('2fa/confirm')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  async confirmTwoFactor(@CurrentUser() user: AuthenticatedUser, @Body() dto: VerifyTotpDto) {
    await this.authService.confirmTwoFactor(user.id, dto.code)
    return { ok: true }
  }
}
