-- Mine/Profile + KYC checkpoint: real backend-generated referral codes, and
-- KYC submission/document storage extensions. Purely additive — no existing
-- column is dropped, renamed, or narrowed.

-- CreateEnum
CREATE TYPE "KycIdType" AS ENUM ('NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE');

-- CreateEnum
CREATE TYPE "KycDocumentKind" AS ENUM ('FRONT', 'BACK', 'SELFIE');

-- AlterTable: KycVerification — nullable submission-detail columns (existing
-- rows, created before this checkpoint via the old providerReference-only
-- submit(), are left NULL rather than backfilled with invented identity data)
ALTER TABLE "KycVerification" ADD COLUMN     "country" TEXT,
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "fullName" TEXT,
ADD COLUMN     "idNumber" TEXT,
ADD COLUMN     "idType" "KycIdType";

-- AlterTable: User.referralCode — added nullable first, backfilled for every
-- existing row, then tightened to NOT NULL + UNIQUE. Backfill is derived
-- deterministically from each user's own already-unique id (first 8 hex
-- chars with dashes stripped, uppercased) — the exact same scheme the
-- frontend's previous cosmetic-only helper used, so no existing user's
-- displayed code changes as a side effect of this migration. New users
-- registering after this migration get a properly random, uniqueness-checked
-- code instead (see auth.service.ts).
ALTER TABLE "User" ADD COLUMN     "referralCode" TEXT;

UPDATE "User" SET "referralCode" = upper(substr(replace(id::text, '-', ''), 1, 8)) WHERE "referralCode" IS NULL;

ALTER TABLE "User" ALTER COLUMN "referralCode" SET NOT NULL;

-- CreateTable
CREATE TABLE "KycDocument" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "kind" "KycDocumentKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KycDocument_verificationId_idx" ON "KycDocument"("verificationId");

-- CreateIndex
CREATE UNIQUE INDEX "KycDocument_verificationId_kind_key" ON "KycDocument"("verificationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- AddForeignKey
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "KycVerification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- trust_app's blanket grant (from the init migration) only covers tables
-- that existed when it ran — every migration since has had to re-grant its
-- own new table(s) explicitly, same as crypto_deposit_management before it.
GRANT SELECT, INSERT, UPDATE, DELETE ON "KycDocument" TO trust_app;
