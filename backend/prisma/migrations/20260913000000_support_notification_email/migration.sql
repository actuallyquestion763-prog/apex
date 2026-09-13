-- Admin support-notification email (ADMIN NOTIFICATIONS feature) — one new
-- nullable column on the existing PlatformSettings singleton row. No
-- existing column, row, constraint, or enum value is altered or dropped,
-- and PlatformSettings already has its GRANT from its original migration,
-- so no new GRANT is needed here (same reasoning as the auto-greeting
-- migration immediately before this one).

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "supportNotificationEmail" TEXT;
