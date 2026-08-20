-- Fixed-Time Options Trading — a new, separate product alongside the
-- existing spot Order/Position tables (untouched by this migration).
-- Purely additive: four new enums, four new tables, new indexes/FKs. No
-- existing table, column, row, or enum value is altered or dropped.
--
-- OptionTrade.userId/accountId reference the SAME User/Account rows spot
-- trading already uses (reuse, not a parallel identity system). No FK to
-- MarketConfig — OptionMarket.symbol is resolved against MarketConfig at
-- the application layer, the same loose-coupling convention Order.symbol
-- already uses (see options.service.ts).

-- CreateEnum
CREATE TYPE "OptionDirection" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OptionResult" AS ENUM ('WIN', 'LOSS', 'DRAW');

-- CreateEnum
CREATE TYPE "OptionTradeStatus" AS ENUM ('ACTIVE', 'SETTLED', 'UNRESOLVED');

-- CreateEnum
CREATE TYPE "OptionResultMode" AS ENUM ('NORMAL', 'FORCE_WIN', 'FORCE_LOSS', 'FORCE_DRAW');

-- CreateTable
CREATE TABLE "OptionMarket" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'USDT',
    "minInvestment" DECIMAL(20,8) NOT NULL DEFAULT 1,
    "maxInvestment" DECIMAL(20,8),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OptionMarket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptionDuration" (
    "id" TEXT NOT NULL,
    "optionMarketId" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "payoutPercent" DECIMAL(6,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OptionDuration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptionTrade" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" "OptionDirection" NOT NULL,
    "investment" DECIMAL(20,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "payoutPercentSnapshot" DECIMAL(6,3) NOT NULL,
    "entryPrice" DECIMAL(20,8) NOT NULL,
    "entryPriceTimestamp" TIMESTAMP(3) NOT NULL,
    "entrySource" TEXT NOT NULL,
    "expiryAt" TIMESTAMP(3) NOT NULL,
    "expiryPrice" DECIMAL(20,8),
    "expiryPriceTimestamp" TIMESTAMP(3),
    "expirySource" TEXT,
    "result" "OptionResult",
    "profitAmount" DECIMAL(20,8),
    "returnAmount" DECIMAL(20,8),
    "status" "OptionTradeStatus" NOT NULL DEFAULT 'ACTIVE',
    "requestedResultMode" "OptionResultMode" NOT NULL DEFAULT 'NORMAL',
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "OptionTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptionsSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "tradingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maxActiveTradesPerUser" INTEGER,
    "maxExposurePerUser" DECIMAL(20,8),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByAdminId" TEXT,

    CONSTRAINT "OptionsSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OptionMarket_symbol_key" ON "OptionMarket"("symbol");

-- CreateIndex
CREATE INDEX "OptionMarket_enabled_idx" ON "OptionMarket"("enabled");

-- CreateIndex
CREATE INDEX "OptionDuration_optionMarketId_idx" ON "OptionDuration"("optionMarketId");

-- CreateIndex
CREATE UNIQUE INDEX "OptionDuration_optionMarketId_durationSeconds_key" ON "OptionDuration"("optionMarketId", "durationSeconds");

-- CreateIndex
CREATE INDEX "OptionTrade_userId_idx" ON "OptionTrade"("userId");

-- CreateIndex
CREATE INDEX "OptionTrade_status_idx" ON "OptionTrade"("status");

-- CreateIndex
CREATE INDEX "OptionTrade_status_expiryAt_idx" ON "OptionTrade"("status", "expiryAt");

-- CreateIndex
CREATE INDEX "OptionTrade_symbol_idx" ON "OptionTrade"("symbol");

-- AddForeignKey
ALTER TABLE "OptionDuration" ADD CONSTRAINT "OptionDuration_optionMarketId_fkey" FOREIGN KEY ("optionMarketId") REFERENCES "OptionMarket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionTrade" ADD CONSTRAINT "OptionTrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionTrade" ADD CONSTRAINT "OptionTrade_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The trust_app role's original grant only covered tables that existed when
-- it ran — every table created since needs its own explicit grant (same
-- lesson as 20260817135324/20260817061732). None of these four tables is an
-- immutable audit trail, so full CRUD for trust_app is correct here.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "OptionMarket", "OptionDuration", "OptionTrade", "OptionsSettings"
TO trust_app;
