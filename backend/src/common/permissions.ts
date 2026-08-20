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
  'crypto_deposits.read',
  'crypto_deposits.control', // receiving-address/asset/network configuration — a distinct, more sensitive capability than day-to-day deposit approval (deposits.review)
  'withdrawals.read',
  'withdrawals.review',
  'trading.read',
  'trading.control',
  'markets.read',
  'markets.control',
  'options.read',
  'options.control',
  'ledger.read',
  'ledger.adjust', // not in the original example list — financial adjustments need a distinct permission from read-only ledger.read; added here rather than silently reusing an unrelated key
  'audit.read',
  'platform.read',
  'platform.control',
  'admins.read',
  'admins.manage',

  // ---- CMS (Phase 3) --------------------------------------------------------
  'cms.pages.read',
  'cms.pages.create',
  'cms.pages.update',
  'cms.pages.publish',
  'cms.pages.archive',
  'cms.announcements.read',
  'cms.announcements.create',
  'cms.announcements.update',
  'cms.announcements.publish',
  'cms.announcements.archive',
  'cms.faqs.read',
  'cms.faqs.create',
  'cms.faqs.update',
  'cms.faqs.publish',
  'cms.faqs.archive',
  'cms.media.read',
  'cms.media.upload',
  'cms.media.delete',
  'cms.navigation.read',
  'cms.navigation.update',

  // ---- Customer Support (Phase 3) --------------------------------------------
  // A deliberately separate permission domain from the financial ones above —
  // granting every one of these to an admin still gives them zero ability to
  // touch a balance, approve a withdrawal, or change a role (see
  // backend/src/support/*.controller.ts — none of them ever call
  // LedgerService/AdminService's financial methods).
  'support.tickets.read',
  'support.tickets.create', // reserved for a future "staff opens a ticket on behalf of a customer" admin action — not wired to any endpoint yet; customers create their own tickets without this permission
  'support.tickets.assign',
  'support.tickets.update',
  'support.tickets.reply',
  'support.tickets.internal_note',
  'support.tickets.resolve',
  'support.tickets.close',
  'support.categories.manage',
] as const

export type PermissionKey = (typeof PERMISSIONS)[number]
