-- The trust_app role's table grants (prisma/migrations/20260816085512_audit_log_immutability)
-- were issued via "GRANT ... ON ALL TABLES IN SCHEMA public", which only
-- applies to tables that existed at the time that statement ran. IdempotencyKey
-- was added later (20260817054421_add_idempotency_key) and therefore has NO
-- grants for trust_app until this migration runs. Unlike AuditLog, this table
-- legitimately needs UPDATE/DELETE from the app role — it is operational
-- bookkeeping for in-flight/completed idempotent requests, not an immutable
-- audit trail.
GRANT SELECT, INSERT, UPDATE, DELETE ON "IdempotencyKey" TO trust_app;
