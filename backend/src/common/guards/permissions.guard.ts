import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PrismaService } from '../../prisma/prisma.service'
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator'
import type { AuthenticatedUser } from '../types/authenticated-user'
import type { PermissionKey } from '../permissions'

// Must run after SessionAuthGuard + RolesGuard. SUPER_ADMIN always passes —
// "full platform control" per the product requirement. An ADMIN must hold
// every permission the route declares via @RequirePermissions(...); there
// is no implicit grant from the ADMIN role alone.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required || required.length === 0) return true

    const request = context.switchToHttp().getRequest()
    const user: AuthenticatedUser | undefined = request.user
    if (!user) throw new ForbiddenException('Not authenticated.')
    if (user.role === 'SUPER_ADMIN') return true

    const granted = await this.prisma.userPermission.findMany({
      where: { userId: user.id, permission: { key: { in: required as unknown as string[] } } },
      include: { permission: true },
    })
    const grantedKeys = new Set(granted.map((g) => g.permission.key))
    const missing = required.filter((k) => !grantedKeys.has(k))
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing required permission(s): ${missing.join(', ')}`)
    }
    return true
  }
}
