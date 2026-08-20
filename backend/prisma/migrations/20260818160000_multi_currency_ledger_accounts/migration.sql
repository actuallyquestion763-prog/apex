-- Phase 6F, Part 2 — widen LedgerAccount's uniqueness constraint to include
-- currency. This is the schema fix Phase 6E identified as a hard blocker
-- for spot crypto holdings: @@unique([accountId, type]) previously allowed
-- only ONE CASH and ONE RESERVED ledger account per user Account,
-- regardless of currency — a customer could never hold a BTC balance
-- alongside a USD balance. Widening to (accountId, type, currency) lets
-- each currency have its own CASH/RESERVED pair.
--
-- Additive in effect, not in mechanism: every existing row already has
-- currency='USD' (the column's default), so no existing (accountId, type)
-- pair can collide under the wider index — this migration cannot fail on
-- data that already exists, it only permits rows that were previously
-- rejected (a second CASH row for the same account with a different
-- currency).
DROP INDEX "LedgerAccount_accountId_type_key";
CREATE UNIQUE INDEX "LedgerAccount_accountId_type_currency_key" ON "LedgerAccount"("accountId", "type", "currency");
