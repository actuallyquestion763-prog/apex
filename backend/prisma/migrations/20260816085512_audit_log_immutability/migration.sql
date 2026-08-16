-- Audit log immutability at the DATABASE level, not just application
-- convention. Creates a least-privilege role that the application should
-- connect as at runtime (separate from the role used to run migrations,
-- which needs DDL/owner privileges these statements deliberately do not
-- grant). This role can INSERT and SELECT on every table, but can never
-- UPDATE or DELETE a row in "AuditLog" — so even a bug or a full
-- application-layer compromise cannot rewrite or erase audit history,
-- only Postgres's own superuser/owner role can.
--
-- This migration deliberately does NOT set a password here — no migration
-- file, in this repo or any other, should ever contain a literal database
-- credential. The role is created WITHOUT a password (LOGIN only), which
-- means it exists and can be granted privileges below, but cannot actually
-- authenticate via password auth until an operator sets one out-of-band,
-- once, per environment:
--   ALTER ROLE trust_app WITH PASSWORD '<generate-a-real-secret-here>';
-- Run that directly against Postgres (psql, or any DB admin tool) as the
-- superuser — never through a migration file, never committed anywhere.
-- Then put the same value in that environment's gitignored DATABASE_URL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'trust_app') THEN
    CREATE ROLE trust_app LOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO trust_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO trust_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO trust_app;

-- The one deliberate restriction: no UPDATE, no DELETE on AuditLog, for the
-- application role specifically.
REVOKE UPDATE, DELETE ON "AuditLog" FROM trust_app;
