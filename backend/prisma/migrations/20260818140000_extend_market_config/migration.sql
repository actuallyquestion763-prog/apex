-- Phase 6B, Part 4 — extends MarketConfig in place (no new table) so the
-- database becomes the authoritative source for instrument display
-- metadata, precision, market type, and provider/symbol mapping. Every new
-- column is additive with a default, so the 3 existing seeded rows
-- (XAU/USD, BTC/USDT, ETH/USDT) remain valid without a data-migration step.

-- CreateEnum
CREATE TYPE "MarketType" AS ENUM ('CRYPTO_SPOT', 'CFD', 'FOREX', 'OTHER');

-- AlterTable
ALTER TABLE "MarketConfig"
  ADD COLUMN "baseAsset" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "quoteAsset" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "displayName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "marketType" "MarketType" NOT NULL DEFAULT 'CRYPTO_SPOT',
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "pricePrecision" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "quantityPrecision" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "minimumQuantity" DECIMAL(20,8),
  ADD COLUMN "maximumQuantity" DECIMAL(20,8),
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "providerSymbol" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "MarketConfig_enabled_idx" ON "MarketConfig"("enabled");
