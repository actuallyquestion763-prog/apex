-- Amount-tier trading ticket (Part 29) — one new column on the existing
-- OptionDuration table, defaulted to 0 (always qualifies), unchanged for
-- every existing row until an admin explicitly configures a real threshold.

-- AlterTable
ALTER TABLE "OptionDuration" ADD COLUMN     "minAmount" DECIMAL(20,8) NOT NULL DEFAULT 0;
