# TRUST — Operations Guide

Checkpoint I.1 deliverable (Parts 6-8). Describes what backup/restore,
deployment, and monitoring look like TODAY in this repository, and what a
real staging/production deployment still needs on top of it. Nothing in
this document was executed against a real hosting account, a real domain,
or `trust_dev` — see the Checkpoint I.1 report for what was actually run
(disposable-database drills only).

## 1. Backup & Restore

### What exists

- `scripts/backup-db.ts` — logical (JSON) backup of every table via
  Prisma's `$queryRawUnsafe`, Decimal-safe serialization.
- `scripts/restore-db.ts` — restores into an **empty** target database only
  (refuses if any target table already has rows); refuses outright if the
  `DATABASE_URL` looks like `trust_dev`.
- `scripts/backup-restore-drill.ts` — end-to-end drill against a disposable
  database (`trust_backup_drill` on the same disposable Postgres the test
  suite uses): backup → destroy → recreate → restore → verify schema, row
  counts, ledger integrity, CMS/Support/idempotency/audit-log survival, and
  a real `ReconciliationService` run. This is what "the restore process has
  been tested" means in this repository — re-run it any time with
  `npx ts-node scripts/backup-restore-drill.ts`.
- **Checksum (unchanged, mandatory):** every backup gets a `.sha256`
  sidecar; `restore-db.ts` refuses to restore without a matching one.
- **Encryption (Checkpoint I.1, new, opt-in):** set `BACKUP_ENCRYPTION_KEY`
  (64 hex chars — `openssl rand -hex 32`) before running `backup-db.ts` and
  the artifact written to disk is AES-256-GCM ciphertext, never plaintext.
  `restore-db.ts` auto-detects an encrypted backup and requires the same
  key to decrypt; GCM's auth tag makes tampering or a wrong key a hard
  failure, not silent corruption. Without the key set, `backup-db.ts` still
  runs (so local/disposable-DB drills keep working) but prints an explicit
  warning that the artifact is unencrypted.
- **Metadata sidecar (new):** every backup also gets a `.meta.json` file
  (`{format, generatedAt, tableCount, totalRows, encrypted, checksumFile}`)
  so an operator can see backup provenance without decrypting or parsing
  the backup itself.

### What does NOT exist (operational deployment tasks, not built here)

- **Automated scheduling.** Nothing in this repository runs `backup-db.ts`
  on a timer. A real deployment needs a cron job / scheduled task / managed
  Postgres provider's own snapshot schedule.
- **Offsite / redundant storage.** Backups land on local disk only. A real
  deployment must copy them to separate storage (object storage in a
  different region/account, at minimum) — this repository intentionally
  does not add cloud credentials or upload logic (out of scope, and
  explicitly disallowed by the Checkpoint I.1 safety rules).
- **Retention policy automation.** No pruning job exists. Recommended
  policy for a real deployment (not enforced anywhere yet): keep daily
  backups for 14 days, weekly for 8 weeks, monthly for 12 months — a
  standard grandfather-father-son rotation — implemented via whatever the
  eventual offsite storage layer offers (e.g. object-storage lifecycle
  rules), not a custom TRUST script.
- **A real `pg_dump`/`pg_restore`.** This environment has no such binary
  available; a production deployment on real PostgreSQL should prefer
  native `pg_dump -Fc` / your managed provider's snapshot feature over this
  repository's JSON logical backup, which exists primarily so the round
  trip could be genuinely tested here.

### RPO / RTO (as currently implemented, not yet a real SLA)

- **RPO:** unbounded — equal to however long since the last **manually
  triggered** backup, since no schedule exists yet. A real deployment must
  fix this by scheduling backups (see above) before an RPO number means
  anything.
- **RTO:** the drill (`backup-restore-drill.ts`) restores a small synthetic
  dataset (18 rows / 32 tables) in well under a minute. Restore time for a
  real production-sized dataset has not been measured — the JSON logical
  restore approach here does row-by-row parameterized inserts (see
  `restore-db.ts`), which will not scale the way a real `pg_restore` does;
  this is exactly why a real deployment should use `pg_dump`/`pg_restore`
  or a managed snapshot restore instead.

### Restore procedure (manual, current state)

1. Locate the backup file, its `.sha256`, and its `.meta.json`.
2. If `.meta.json` says `"encrypted": true`, obtain `BACKUP_ENCRYPTION_KEY`
   from wherever it is stored (never the backup file itself, never a repo).
3. Point `DATABASE_URL` at the **target** database (must be empty of the
   tables being restored; never `trust_dev`).
4. `DATABASE_URL=... [BACKUP_ENCRYPTION_KEY=...] npx ts-node scripts/restore-db.ts <file>`
5. Run `npx prisma migrate status` to confirm the schema matches, then spot
   -check row counts and ledger balance per currency before declaring the
   restore complete.

## 2. Deployment Configuration

| Concern | Local development | Staging | Production |
|---|---|---|---|
| Frontend → API calls | `src/lib/api.ts` calls same-origin `/api/*`; Vite dev server proxies `/api` → `http://localhost:4100`, stripping the `/api` prefix (`vite.config.ts`) | Same relative `/api/*` calls — **there is no `VITE_API_URL`/absolute-URL config anywhere in the frontend.** A reverse proxy in front of the deployed frontend build must route `/api/*` to the backend, stripping the prefix, exactly like the Vite dev proxy does | Same requirement as staging, over HTTPS |
| Backend PORT | `4100` (default in `main.ts` if `PORT` unset) | Set `PORT` explicitly per your host's convention | Same |
| `FRONTEND_ORIGIN` | defaults to `http://localhost:5173` if unset (`env.validation.ts`) | **Required**, must be `https://...`, must not be `localhost` — boot fails otherwise (`validateEnv`) | Same requirement, enforced identically |
| CORS | Reflects `FRONTEND_ORIGIN` via `resolveCorsOrigin` — single fixed origin, credentials enabled, never a wildcard | Same | Same |
| Cookies | Not `Secure`-flagged (plain HTTP in dev) | `Secure`-flagged (`getCookieOptions`) — requires the deployment to actually terminate HTTPS in front of the app | Same |
| Static frontend build | Served by the Vite dev server itself | `npx vite build` output (`dist/`) must be served by a static file host / CDN / reverse proxy — **the NestJS backend does not serve the frontend build; nothing in this repository wires that up** | Same — plus a real CDN/cache strategy is a product decision, not built here |
| Health checks | `GET /health`, `GET /health/ready` (Checkpoint I.1, Part 1) | Point the orchestrator's readiness probe at `/health/ready`, liveness probe at `/health` | Same |
| DB migrations | `prisma migrate dev` | `prisma migrate deploy` against the staging DB, run as a separate release step before the new backend version starts serving traffic | Same, with a documented rollback plan (out of scope here — no down-migrations exist for any migration in this repo, per Part 11 of the Checkpoint I audit) |
| Startup | `npm run start:dev` | Node process running the `nest build` output (`dist/src/main.js`), env vars injected by the platform, never a `.env` file committed anywhere | Same |
| Shutdown | Ctrl+C (SIGINT) — now handled gracefully (Checkpoint I.1, Part 2) | Orchestrator sends SIGTERM on redeploy/scale-down — handled by the same `enableShutdownHooks()` call | Same |
| Logging | Console, human-readable Nest logger | Structured JSON lines (Checkpoint I.1, Part 5) — pipe stdout to whatever log aggregation the platform offers | Same, plus a real retention/aggregation choice (product decision, §3 below) |
| Env var docs | `.env.example` | `.env.staging.example` (already present in this repo) | No `.env.production.example` exists yet — creating one is a small, safe follow-up; it was not added this checkpoint since production secrets/topology are still undecided (see Checkpoint I report Part 14) |

**Nothing in this checkpoint deployed anything.** This table describes the
intended topology so a future deploy step has a concrete checklist, not a
record of an actual deployment.

## 3. Monitoring Hooks

### What's available today

| Signal | Where to get it right now |
|---|---|
| Application process alive | `GET /health` |
| Database connectivity | `GET /health/ready` → `checks.database` |
| Execution provider configuration | `GET /health/ready` → `checks.executionProvider` (`FAKE` / `BINANCE_SANDBOX` / `DISABLED` — never credentials) |
| Unresolved orders (ambiguous provider outcomes) | `GET /admin/orders/unresolved` (Checkpoint I.1, Part 4) — count + list, permission-gated (`trading.read`) |
| Failed/ambiguous executions | `EXECUTION_UNRESOLVED`, `EXECUTION_REJECTED` audit events (`GET /admin/audit-logs`); also surfaced live via `POST /admin/reconciliation/run` |
| Authentication / security failures | Audit log events (login failures, step-up failures, permission denials all go through `AuditService` — see `src/audit/audit-events.ts`) |
| Withdrawal / deposit failures | Withdrawal/deposit status transitions + associated audit events (`WITHDRAWALS_*`, deposit review events) |
| System errors (unhandled exceptions) | Structured log line from `AllExceptionsFilter` (server-side, includes `requestId`) — Checkpoint I.1, Part 5 |
| Per-request timing/tracing | `X-Request-Id` response header + one structured JSON log line per request (method, path, status, duration, environment) — Checkpoint I.1, Part 5 |

### What this is NOT

None of the above is wired to an external monitoring/alerting service. There
is no APM agent, no metrics exporter (Prometheus/StatsD/etc.), no log
shipper, and no on-call paging integration anywhere in this repository. A
real deployment needs to:

1. Ship stdout (the structured JSON log lines) to a log aggregator.
2. Poll `GET /health/ready` from the orchestrator/load balancer AND from an
   external uptime monitor.
3. Poll or subscribe to `GET /admin/orders/unresolved`'s count and alert
   above a threshold (e.g. "any unresolved order older than 15 minutes").
4. Alert on `EXECUTION_UNRESOLVED`/`EXECUTION_REJECTED` audit-event rates
   and on authentication-failure spikes.
5. Choose and wire an actual monitoring vendor/stack — a product decision,
   not something this checkpoint selects on the team's behalf.
