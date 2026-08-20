-- Trade Experience checkpoint, Part 8 — platform-wide sandbox test-outcome
-- dial on OptionsSettings. Purely additive: new enum + one new column with
-- a safe default (RANDOM = today's real market-derived behavior, unchanged
-- for every existing row and every environment until an admin explicitly
-- sets it, which the application layer only permits in development/test).

-- CreateEnum
CREATE TYPE "SandboxOutcomeMode" AS ENUM ('RANDOM', 'FORCE_WIN', 'FORCE_LOSS');

-- AlterTable
ALTER TABLE "OptionsSettings" ADD COLUMN     "sandboxOutcomeMode" "SandboxOutcomeMode" NOT NULL DEFAULT 'RANDOM';
