# TRUST backend — secure foundation (through Phase 1.4)

**This is a foundation, not a production system.** It is not connected to a
real payment provider, broker/exchange, or KYC provider, and it must not be
treated as ready for real customer money. See "What this phase deliberately
does NOT do" below, and the main project's real-money architecture audit for
the full list of non-technical prerequisites (legal, licensing, broker
agreements, etc.) that have to happen before any of that changes.

## What's new in Phase 1.1

Phase 1 built the foundation but couldn't run it against a real database
(no Docker/Postgres in that environment). Phase 1.1 got a **real PostgreSQL
17/18 instance running** (via the `embedded-postgres` package — genuine
Postgres binaries, not a mock — since the EDB installer download was
blocked by this sandbox's network policy) and ran the actual migrations and
a full integration/concurrency test suite against it. It also closed three
gaps Phase 1 had explicitly flagged as follow-up:
- Withdrawal/order fund reservation now uses a real PostgreSQL advisory
  lock instead of the earlier check-then-reverse mitigation.
- Fine-grained permissions are now enforced (`PermissionsGuard`), not just
  present as unused schema.
- The most sensitive admin actions now require a fresh TOTP code in
  addition to the password re-confirmation (step-up, not just re-auth).
- The audit log's append-only property is now a database-level grant
  restriction, verified by actually trying to UPDATE/DELETE a row as the
  app's own runtime role and confirming Postgres rejects it.

## What this is

A NestJS + PostgreSQL + Prisma backend that makes the frontend's account/
balance/trading state **backend-authoritative** instead of browser-authoritative.
The core principle, enforced in code, not just documented: the browser is
never trusted for balance, deposits, withdrawals, trade settlement, admin
permissions, or KYC status. Every one of those lives in Postgres behind
session-authenticated, role-and-permission-guarded API endpoints.

## Setup

1. **Postgres.** Needs a real PostgreSQL instance.
   ```
   docker run --name trust-postgres -e POSTGRES_PASSWORD=devpassword -e POSTGRES_DB=trust_dev -p 5432:5432 -d postgres:16
   ```
   Or install natively. (If Docker/native install isn't available in your
   environment either, `npm i -D embedded-postgres` and adapt
   `scripts/test-db.js` — that's exactly how this was verified here.)

2. **Environment.** Copy `.env.example` to `.env` and fill in `DATABASE_URL`
   (pointing at the **`trust_app`** role — see Security below — not the
   superuser) and a freshly-generated `SESSION_SECRET`. There is no admin
   credential to fill in — see step 4.

3. **Migrate as the superuser, set the app role's password, then run as
   `trust_app`:**
   ```
   DATABASE_URL="postgresql://postgres:<superuser-pw>@localhost:5432/trust_dev?schema=public" npx prisma migrate deploy
   ```
   The second migration (`20260816085512_audit_log_immutability`) creates
   the `trust_app` role **without a password** — no migration file, in this
   repo or any other, should ever contain a literal database credential.
   The role exists but cannot authenticate yet. Set one now, once per
   environment, directly against Postgres (never through a migration, never
   committed anywhere):
   ```
   psql "postgresql://postgres:<superuser-pw>@localhost:5432/trust_dev" -c "ALTER ROLE trust_app WITH PASSWORD '<generate-a-real-secret>';"
   ```
   Put that same value in `.env`'s `DATABASE_URL`, then:
   ```
   npm run seed          # permissions, platform settings, market configs only — no user account
   npm run start:dev     # uses .env's DATABASE_URL, which should point at trust_app
   ```

4. **Create your first Super Admin** (once, per database — with the API
   running or stopped, either works since this talks to Postgres directly):
   ```
   npm run admin:create-superadmin
   ```
   Interactive only: prompts for email, a password (never echoed to the
   terminal, never read from an env var/file/CLI argument), and requires you
   to confirm a TOTP code from an authenticator app before the account is
   created — two-factor authentication cannot be skipped or added later as
   an afterthought for this account. Refuses to run if a SUPER_ADMIN already
   exists in this database; use the admin panel's role-promotion (itself
   step-up-gated) to create additional admins after that. See
   `scripts/create-superadmin.ts`.

5. The API listens on `PORT` (default 4100) and expects the frontend at
   `FRONTEND_ORIGIN` (default `http://localhost:5173`).

## Architecture

```
Controllers (route + guards) → Services (business logic) → PrismaService (Postgres, as trust_app)
                                     ↓
                              LedgerService (the only place a balance is computed)
```

Modules: `auth`, `users`, `accounts`, `ledger`, `orders`, `positions`,
`markets`, `deposits`, `withdrawals`, `kyc`, `admin`, `audit`,
`platform-settings`; `common/security` (step-up re-auth), `common/` (guards,
decorators, filters, permission keys).

### Authentication

Session-based, not JWT: opaque random token to the client, only its SHA-256
hash stored server-side (`Session` table) — a DB dump alone can't
authenticate as anyone. `argon2` password hashing. Real RFC 6238 TOTP
(`src/auth/totp.util.ts`, Node's built-in `crypto` only). 2FA-enabled users
get a short-lived signed "pending login" ticket, not a session, until
`POST /auth/2fa/login-verify` succeeds.

**RUNTIME VERIFIED against real PostgreSQL** (`test/auth-session.e2e-spec.ts`,
8/8 passing): registration sets an httpOnly/SameSite=Lax cookie and never
returns `passwordHash`; wrong password rejected; `/auth/me` rejects a
missing/expired/revoked session; logout revokes the specific session row;
full password → 2FA-required → TOTP-verify → session flow works end to end.

### Authorization: roles + fine-grained permissions

`RolesGuard` (`USER`/`ADMIN`/`SUPER_ADMIN`, on the `User` row, never the
client) runs first — role changes are `@Roles('SUPER_ADMIN')`-only, so an
ADMIN can never escalate itself or anyone else. `PermissionsGuard` +
`@RequirePermissions(...)` (`src/common/permissions.ts`) then enforce
fine-grained access on top: **a freshly-created ADMIN has zero permissions
granted by default** and gets 403 on every `/admin` route until a
SUPER_ADMIN explicitly grants each one (`PATCH
/admin/admins/:id/permissions/:permission/grant`, itself SUPER_ADMIN-only
and step-up-gated). SUPER_ADMIN bypasses the permission check entirely
(full platform control, per the product requirement). Permission keys match
the requested list (`users.read`, `kyc.review`, `withdrawals.review`,
`platform.control`, etc.) plus one addition, `ledger.adjust` — the original
list had `ledger.read` but nothing for *making* an adjustment, and reusing
an unrelated key for that felt worse than naming it explicitly; noted here
rather than silently added.

**RUNTIME VERIFIED against real PostgreSQL**
(`test/authorization.e2e-spec.ts`, 5/5 passing): USER blocked from all
`/admin`; fresh ADMIN blocked from everything; granting one permission
unlocks exactly that route and nothing else; ADMIN cannot self-grant
permissions or roles (403 from RolesGuard before permission/step-up logic
even runs); SUPER_ADMIN passes every check with zero explicit grants.

### The ledger (`src/ledger/ledger.service.ts`)

Still the most important file. No balance stored directly — every balance
is `SUM(credits) - SUM(debits)` over `LedgerEntry` rows. `postTransaction()`
rejects unbalanced entries, runs in one Prisma `$transaction`, and is
idempotent via `idempotencyKey`.

**New in 1.1 — `postTransactionWithAccountLock()`**: for the specific case
of "check a balance, then post an entry that depends on it" (withdrawals,
order fund reservation), this acquires a PostgreSQL
**transaction-scoped advisory lock** (`pg_advisory_xact_lock(hashtext(lockKey))`)
before running an optional `precondition` callback and before inserting
entries — all inside one DB transaction. A second concurrent call with the
same lock key (the ledger account being protected) blocks at lock
acquisition until the first transaction commits or rolls back. There is no
window where two requests can both read the same pre-reservation balance
and both proceed — this replaced the earlier check-then-reverse mitigation
entirely, it isn't layered on top of it.

**RUNTIME VERIFIED against real PostgreSQL**
(`test/ledger.e2e-spec.ts`, 5/5; `test/financial-invariants.e2e-spec.ts`,
5/5 — **including the exact scenario requested**: a $1000 balance, two
concurrent $800 withdrawal requests, and confirmation that exactly one
reserves funds while the other is honestly rejected, with the account
balance verified non-negative and exactly $200 afterward, read back from
the real database). Also verified: a concurrent order + withdrawal for the
same funds never both succeed; idempotency holds under genuine
`Promise.all` concurrency (not just sequential calls), confirmed via the
real unique-constraint race path, not just the fast pre-check.

### Super Admin & sensitive-action step-up

`admin.controller.ts` — every route: `SessionAuthGuard` → `RolesGuard`
(`ADMIN`/`SUPER_ADMIN`) → `PermissionsGuard` (per-route
`@RequirePermissions`). Overview, user management, deposit/withdrawal/KYC
review, platform kill switches, per-market config, audit log, and (new)
admin/permission management (`GET /admin/admins`,
`PATCH /admin/admins/:id/permissions/:permission/grant|revoke`).

**Step-up (password + fresh TOTP), not just password re-confirmation**,
now gates: financial adjustments, role changes, withdrawal approval,
granting/revoking admin permissions, and platform-wide setting changes
(`src/common/security/step-up.service.ts`). If the acting admin hasn't
enabled 2FA, these operations are blocked outright with a clear message —
the system does not silently fall back to password-only for a
2FA-incapable admin account.

**RUNTIME VERIFIED against real PostgreSQL**: wrong password rejected
(401), wrong TOTP code rejected (401), missing permission rejected (403) —
and confirmed the target account's balance was untouched by any of the
three failed attempts (`financial-invariants.e2e-spec.ts`). A successful
adjustment's `AdminAction` and `AuditLog` rows were read back from the real
database and confirmed to reference the actual `LedgerTransaction` id,
actor, target, and reason.

### Platform-wide and per-market kill switches

`PlatformSettingsService` singleton row, checked at the *start* of the
gated service method — flipping a switch via the (now step-up-gated) admin
endpoint really makes the corresponding API reject with 503.

**RUNTIME VERIFIED against real PostgreSQL**
(`test/platform-controls.e2e-spec.ts`, 7/7): pausing trading via the real
admin API and then hitting `POST /orders` directly returns 503, not just a
disabled frontend button; same confirmed independently for deposits,
withdrawals, and registrations, with each restored afterward and a
follow-up request confirmed successful. Market config confirmed:
`XAU/USD` → `LIVE`, `BTC/USDT`/`ETH/USDT` → `SIMULATED`; a market with
trading disabled rejects orders with an honest reason; a never-configured
symbol defaults to `SIMULATED` + trading **disabled** (fails closed).

### Orders / Positions — foundation only, no broker connected

Unchanged in shape from Phase 1 (see below), now additionally using the
advisory-lock reservation path. Positions remain read-only — no write path
exists until a real broker produces a `Fill`.

### Deposits / Withdrawals — foundation only, no payment provider connected

Deposits: `PENDING` until `POST /admin/deposits/:id/confirm`; idempotent,
re-verified against real Postgres (confirming the same deposit twice
credits the account exactly once, transaction count checked directly
against the table). Withdrawals: now use the advisory-lock reservation
(see Ledger above) instead of the earlier mitigation.

### KYC — status tracking only, no verification provider connected

Unchanged from Phase 1 — no document storage, admin-driven approve/reject
today, designed for a provider webhook to call the same methods later.

### Audit log — now immutable at the database level, not just convention

`prisma/migrations/20260816085512_audit_log_immutability` creates a
least-privilege `trust_app` role: full SELECT/INSERT/UPDATE/DELETE on every
table **except** `AuditLog`, where UPDATE/DELETE are explicitly revoked.
The application connects as this role at runtime (migrations still run as
the Postgres superuser, which needs DDL privileges this role doesn't have).

**RUNTIME VERIFIED against real PostgreSQL, twice**: once with a raw `pg`
client connected directly as `trust_app` attempting `UPDATE`/`DELETE` on a
real row (rejected with "permission denied for table AuditLog"; `INSERT`
still succeeds, confirmed), and again through the app's own `PrismaService`
instance in `security.e2e-spec.ts` — confirming the *actual runtime
connection the app uses* is the restricted one, not just that the role
exists somewhere.

### Market data (`src/markets/markets.service.ts`)

Unchanged from Phase 1 — re-implements `server/market.js`'s GoldAPI proxy
server-side.

**RUNTIME VERIFIED against real PostgreSQL/app**
(`security.e2e-spec.ts`): `MARKET_API_KEY` never appears in any API
response body even when set; with no key configured, the endpoint returns
an honest `market_api_key_missing` error with no `price` field — never a
fabricated quote.

### Security

Unchanged mechanisms from Phase 1 (`helmet`, global `ValidationPipe`,
`AllExceptionsFilter`, `@nestjs/throttler`, locked-down CORS) plus the new
`trust_app` DB role restriction above.

**RUNTIME VERIFIED against real PostgreSQL**: a 403 error body was checked
and contains no stack trace shape, no `node_modules` paths, no connection
strings, no secret material; no API response anywhere (registration, login,
`/auth/me`) ever contains `passwordHash` or an argon2 hash prefix; session
cookies confirmed `httpOnly` + `SameSite=Lax` on a real response.

## What this phase deliberately does NOT do

- Connect a real payment provider, broker/exchange, or KYC provider.
- Let a frontend "success" message move any money.
- Migrate existing `localStorage` demo data into this database.
- Claim compliance, licensing, or production readiness.
- Restore the fixed-duration/fixed-payout trading concept — declined for
  real money pending licensing review in an earlier session.
- Automatically credit a registration bonus of any kind — removed entirely
  (see "Registration is financially inert" below); a new user's cash,
  available, and reserved balances are all exactly $0 until a real deposit
  or admin action changes them.

## Frontend

**Wired up as of Phase 1.2.** The existing Vite/React app (`../src`) now
talks to this backend exclusively for identity, balance, ledger, orders,
positions, deposits, withdrawals, KYC status, and the Super Admin Control
Center — `localStorage` holds nothing but non-financial notification
preferences. See `src/lib/api.ts` for the fetch wrapper and `vite.config.ts`
for the dev-server proxy (`/api` → this backend, prefix stripped).

## Registration is financially inert

`AuthService.register()` creates a `User` and an empty `Account` and
nothing else — no `LedgerAccount`, no `LedgerEntry`, no starting balance, in
any environment. This isn't `NODE_ENV`-gated; the code path that used to
grant a demo starting balance was removed outright. See
`test/registration-financial-safety.e2e-spec.ts`.

## Testing

- **RUNTIME VERIFIED, real PostgreSQL 18 (via `embedded-postgres`, genuine
  Postgres binaries — Docker/native install were unavailable in this
  sandbox; `scripts/test-db.js`)**: `npm run test:e2e` — **40/40 passing**
  across 7 suites (`auth-session`, `authorization`, `ledger`,
  `financial-invariants`, `platform-controls`, `security`,
  `registration-financial-safety`), including the exact concurrent-withdrawal
  scenario requested, real database-level audit-log immutability, and
  registration-creates-$0 across two independent users plus a forced
  `NODE_ENV=production` run.
- **RUNTIME VERIFIED, no database required**: `npm test` — 13/13 unit tests
  (ledger invariants against mocked Prisma, TOTP against real crypto).
- **RUNTIME VERIFIED, no database required**: `npx tsc --noEmit` (0 errors),
  `npx nest build` (succeeds).
- **RUNTIME VERIFIED, real PostgreSQL**: both migrations applied
  successfully (`npx prisma migrate deploy`); all 19 expected tables
  confirmed present via `information_schema.tables`.
- **NOT TESTED**: anything involving a real payment provider, broker, or
  KYC provider (none exist to test against — by design, this phase). The
  frontend integration is also not tested, since it doesn't exist yet.
- **Reproducing this locally**: `npm run test:db:start` (starts the same
  ephemeral real Postgres on port 5433), then in another terminal apply
  migrations with `DATABASE_URL=postgresql://postgres:devpassword@localhost:5433/trust_test npx prisma migrate deploy`,
  then `npm run test:e2e`.
