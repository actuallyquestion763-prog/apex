import { SetMetadata } from '@nestjs/common'
import type { PermissionKey } from '../permissions'

export const PERMISSIONS_KEY = 'permissions'

// Marks a route as requiring one or more fine-grained permissions, checked
// by PermissionsGuard. SUPER_ADMIN always passes (full platform control).
// ADMIN must have every listed permission explicitly granted via
// UserPermission — there is no default grant.
export const RequirePermissions = (...permissions: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, permissions)
