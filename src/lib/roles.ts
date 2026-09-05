import type { Role } from '../types'

// The single source of truth for "does this role get Admin UI/access" —
// an explicit allow-list (fail-closed) rather than `role !== 'USER'`
// (fail-open: a future role that is neither USER nor an admin tier would
// incorrectly pass a deny-list check). Used by both the Admin nav-item
// visibility (a UX convenience only) and the AdminOnly route guard;
// the real security boundary is still the backend's RolesGuard, which
// makes this exact same ADMIN/SUPER_ADMIN decision independently on every
// request (see backend/src/common/guards/roles.guard.ts).
export function isAdminRole(role: Role): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
}
