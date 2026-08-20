-- Phase 6F Checkpoint D — LIMIT order lifecycle. Purely additive: new enum
-- values appended (never reordering/removing existing ones), one new
-- unique index. No existing column, row, or constraint is altered.
--
-- IMPORTANT (PostgreSQL constraint, same as the Checkpoint C migration):
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction as a
-- statement that USES the new value — this migration only ADDS values, it
-- never references them, so it is safe to run standalone here.
ALTER TYPE "OrderStatus" ADD VALUE 'OPEN' AFTER 'SUBMITTED';
ALTER TYPE "OrderStatus" ADD VALUE 'CANCEL_PENDING' AFTER 'OPEN';
ALTER TYPE "OrderStatus" ADD VALUE 'EXPIRED' AFTER 'CANCEL_PENDING';

-- Real, DB-enforced fill deduplication (Part 11/13) — a provider fill ID
-- must never be applied twice to the same order. Postgres treats each NULL
-- as distinct in a unique index, so existing/legacy rows with no
-- externalFillId are unaffected; only a genuine repeat is ever rejected.
CREATE UNIQUE INDEX "Fill_orderId_externalFillId_key" ON "Fill"("orderId", "externalFillId");
