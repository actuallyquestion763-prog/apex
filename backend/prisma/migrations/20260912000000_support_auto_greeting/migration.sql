-- Support ticket auto-greeting — three new nullable/defaulted columns on
-- the existing PlatformSettings singleton row. No existing column, row,
-- constraint, or enum value is altered or dropped, and PlatformSettings
-- already has its GRANT from its original migration, so no new GRANT is
-- needed here.

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "supportAutoGreetingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supportAutoGreetingMessage" TEXT,
ADD COLUMN     "supportAutoGreetingSenderId" TEXT;
