-- Part 32 — one new enum value on the existing LedgerEntryType, for
-- customer-initiated currency conversion. Purely additive; every existing
-- row/value is unaffected.

-- AlterEnum
ALTER TYPE "LedgerEntryType" ADD VALUE 'CONVERSION';
