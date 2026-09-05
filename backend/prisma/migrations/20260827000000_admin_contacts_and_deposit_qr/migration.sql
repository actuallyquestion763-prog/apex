-- Admin Panel redesign — purely additive: one new nullable column on the
-- existing CryptoDepositAddress table (optional admin-uploaded QR image,
-- never populated for pre-existing rows), plus one new table for
-- admin-managed customer support contact links (LINE/Telegram/etc). No
-- existing column, row, constraint, or enum value is altered or dropped.

-- AlterTable
ALTER TABLE "CryptoDepositAddress" ADD COLUMN     "qrStorageKey" TEXT;

-- CreateTable
CREATE TABLE "AdminContact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "iconStorageKey" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminContact_enabled_idx" ON "AdminContact"("enabled");

-- The trust_app role's original grant only covered tables that existed when
-- it ran — every table created since needs its own explicit grant (same
-- lesson as every prior additive migration in this project). Not an
-- immutable audit trail, so full CRUD for trust_app is correct.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "AdminContact"
TO trust_app;
