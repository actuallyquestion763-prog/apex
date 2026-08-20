-- Checkpoint K — Crypto Deposit Management. Purely additive: new nullable
-- columns on the existing Deposit table (never populated for pre-existing
-- rows, whose `method` predates this feature), plus two new tables. No
-- existing column, row, constraint, or enum value is altered or dropped.

-- AlterTable
ALTER TABLE "Deposit" ADD COLUMN     "cryptoAssetSymbol" TEXT,
ADD COLUMN     "networkCode" TEXT,
ADD COLUMN     "proofFilename" TEXT,
ADD COLUMN     "proofMimeType" TEXT,
ADD COLUMN     "proofSize" INTEGER,
ADD COLUMN     "proofStorageKey" TEXT,
ADD COLUMN     "receivingAddress" TEXT;

-- CreateTable
CREATE TABLE "CryptoAsset" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CryptoAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CryptoDepositAddress" (
    "id" TEXT NOT NULL,
    "cryptoAssetId" TEXT NOT NULL,
    "networkCode" TEXT NOT NULL,
    "networkName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "receivingAddress" TEXT NOT NULL,
    "minimumDeposit" DECIMAL(20,8),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CryptoDepositAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CryptoAsset_symbol_key" ON "CryptoAsset"("symbol");

-- CreateIndex
CREATE INDEX "CryptoAsset_enabled_idx" ON "CryptoAsset"("enabled");

-- CreateIndex
CREATE INDEX "CryptoDepositAddress_enabled_idx" ON "CryptoDepositAddress"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "CryptoDepositAddress_cryptoAssetId_networkCode_key" ON "CryptoDepositAddress"("cryptoAssetId", "networkCode");

-- AddForeignKey
ALTER TABLE "CryptoDepositAddress" ADD CONSTRAINT "CryptoDepositAddress_cryptoAssetId_fkey" FOREIGN KEY ("cryptoAssetId") REFERENCES "CryptoAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The trust_app role's original grant only covered tables that existed when
-- it ran — every table created since needs its own explicit grant (same
-- lesson as every prior additive migration in this project). Neither new
-- table is an immutable audit trail, so full CRUD for trust_app is correct.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "CryptoAsset", "CryptoDepositAddress"
TO trust_app;
