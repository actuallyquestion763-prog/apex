// Fine-grained permission keys, seeded into the Permission table by
// prisma/seed.ts. SUPER_ADMIN bypasses this system entirely (full platform
// control, per the product requirement) — these keys only constrain what an
// ADMIN can do. A freshly-created ADMIN has none of these granted; a
// SUPER_ADMIN must explicitly grant each one via
// PATCH /admin/admins/:id/permissions.
export const PERMISSIONS = [
  'users.read',
  'users.write',
  'kyc.read',
  'kyc.review',
  'deposits.read',
  'deposits.review',
  'withdrawals.read',
  'withdrawals.review',
  'trading.read',
  'trading.control',
  'markets.read',
  'markets.control',
  'ledger.read',
  'ledger.adjust', // not in the original example list — financial adjustments need a distinct permission from read-only ledger.read; added here rather than silently reusing an unrelated key
  'audit.read',
  'platform.read',
  'platform.control',
  'admins.read',
  'admins.manage',
] as const

export type PermissionKey = (typeof PERMISSIONS)[number]
