-- Phase 6F Checkpoint F, Part 6 — pre-trade risk configuration capacity.
-- Purely additive: every new column is nullable, no existing row, table,
-- constraint, or enum value is altered or dropped. Same "nullable = not
-- enforced" pattern already established by MarketConfig.minimumQuantity/
-- maximumQuantity (Phase 6B) and left deliberately unset by Checkpoint E
-- Part 16, which found no authoritative numeric value anywhere in the
-- product spec — this migration creates the CAPABILITY to configure these
-- limits later; it does not itself set any value or enable any limit.
ALTER TABLE "MarketConfig" ADD COLUMN "maxOrderNotional" DECIMAL(20, 8);
ALTER TABLE "MarketConfig" ADD COLUMN "maxPositionQuantity" DECIMAL(20, 8);
ALTER TABLE "PlatformSettings" ADD COLUMN "maxOpenOrdersPerUser" INTEGER;
