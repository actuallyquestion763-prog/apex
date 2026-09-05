-- Trade Management "USER CONTROL" (Part 28) — a per-user test/sandbox
-- outcome override, gated on a new isTestUser designation. Purely additive:
-- two new columns on the existing User table, both with safe defaults
-- (isTestUser = false, testOutcomeMode = NORMAL = today's real behavior)
-- unchanged for every existing row. isTestUser is never settable through
-- any endpoint on an existing account — see the User model's doc comment in
-- schema.prisma and OptionsService.createTestUser.

-- CreateEnum
CREATE TYPE "TestUserOutcomeMode" AS ENUM ('NORMAL', 'FORCE_WIN', 'FORCE_LOSS');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isTestUser" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN     "testOutcomeMode" "TestUserOutcomeMode" NOT NULL DEFAULT 'NORMAL';
