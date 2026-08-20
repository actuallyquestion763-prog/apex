-- Phase 6F Checkpoint C — the fields needed to represent a REAL,
-- provider-confirmed trade settlement, none of which existed before this
-- checkpoint (every prior order was PENDING -> REJECTED, no fill was ever
-- possible). Purely additive: every new column is nullable, every new enum
-- value is appended, nothing existing is altered or dropped.
--
-- IMPORTANT (PostgreSQL constraint): ALTER TYPE ... ADD VALUE cannot be
-- used in the same transaction as a statement that USES the new value —
-- this migration only ADDS the value, it never references it, so it is
-- safe to run standalone here.
ALTER TYPE "LedgerEntryType" ADD VALUE 'TRADE_SETTLEMENT';

-- Order.feeAsset / Fill.feeAsset — a fee amount with no currency is
-- ambiguous once fees can be charged in the base asset, quote asset, or a
-- third asset (Phase 6E Part 9/28 finding). Order.clientOrderId persists
-- the provider-facing execution idempotency key so a timeout/lost response
-- can be resolved later by re-querying the SAME id (Phase 6E Part 22).
ALTER TABLE "Order" ADD COLUMN "feeAsset" TEXT;
ALTER TABLE "Order" ADD COLUMN "clientOrderId" TEXT;
ALTER TABLE "Fill" ADD COLUMN "feeAsset" TEXT;
