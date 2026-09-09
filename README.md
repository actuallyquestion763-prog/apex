# TRUST

A trading-platform demo with a real, backend-authoritative account/ledger
system. **This is a development foundation — not connected to real customer
money, a payment provider, a broker/exchange, or a KYC provider.** See
`backend/README.md` for the full backend architecture writeup.

Two independent npm packages:
- **Frontend** — this directory (`vaultex-trading`): React + TypeScript + Vite.
- **Backend** — `backend/` (`trust-backend`): NestJS + PostgreSQL + Prisma. The
  sole source of truth for identity, balances, the ledger, orders, deposits,
  withdrawals, KYC status, and admin/permissions. The frontend never computes
  or stores any of that itself.

## Prerequisites

- Node.js 20+ and npm.
- A PostgreSQL instance for the backend (a local install, Docker, or — if
  neither is available — the `embedded-postgres` dev scripts described in
  `backend/README.md`).

## 1. Install dependencies

```bash
npm install               # frontend, at the repo root
npm --prefix backend install   # backend
```

## 2. Set up the backend (database, environment, first admin)

Full detail in `backend/README.md`. Summary:

```bash
cd backend
cp .env.example .env
# edit .env: set DATABASE_URL (pointing at the trust_app role, not the
# superuser) and a freshly-generated SESSION_SECRET. Leave MARKET_API_KEY
# blank unless you have a real GoldAPI key.

# Apply migrations as the Postgres superuser:
DATABASE_URL="postgresql://postgres:<superuser-pw>@localhost:5432/trust_dev?schema=public" npx prisma migrate deploy

# The migration creates the trust_app role WITHOUT a password (no migration
# file ever contains a literal credential) — set one now, once, directly
# against Postgres, then put the same value in .env's DATABASE_URL:
psql "postgresql://postgres:<superuser-pw>@localhost:5432/trust_dev" -c "ALTER ROLE trust_app WITH PASSWORD '<generate-a-real-secret>';"

npm run seed            # permissions + platform settings + market configs only — no user, no money
npm run start:dev       # listens on PORT (default 4100), uses .env's DATABASE_URL (trust_app)
```

Then, in a separate terminal, create your first Super Admin — interactive
only, password never echoed, TOTP 2FA mandatory, never reads a credential
from any file or env var:

```bash
npm run admin:create-superadmin        # from the repo root (proxies into backend/)
# or: npm --prefix backend run admin:create-superadmin
```

Refuses to run if a Super Admin already exists in the database — additional
admins are created afterward via the Admin Control Center's role-promotion
(itself step-up re-authentication gated), not this script.

## 3. Run the frontend

```bash
npm run dev
```

Opens on `http://localhost:5173` (or the next free port). The dev server
proxies `/api/*` to the backend (`vite.config.ts`) and `/market/*` to the
legacy standalone market proxy (`server/market.js`, optional — see below),
so both stay same-origin in the browser.

## Environment files

Copy `.env.example` → `.env` in both the repo root and `backend/` before
running anything. Never commit the real `.env` files — see each
`.env.example` for what every variable is for. No real credential (API key,
database password, session secret, admin password, TOTP secret) belongs in
an example file or anywhere in source control.

## Tests

```bash
# Backend unit tests (no database required)
npm --prefix backend test

# Backend integration/e2e tests (spins up a real, disposable PostgreSQL
# instance and a real local S3-compatible server, both on separate
# ports — neither touches your dev database or dev object storage)
npm --prefix backend run test:db:start   # in one terminal, leave running
npm --prefix backend run test:s3:start   # in another terminal, leave running
# in another terminal:
DATABASE_URL="postgresql://postgres:devpassword@localhost:5433/trust_test?schema=public" npx prisma --schema backend/prisma/schema.prisma migrate deploy
# the migration creates trust_app without a password (see above) — set the
# same value backend/.env.test already expects for local test runs:
psql "postgresql://postgres:devpassword@localhost:5433/trust_test" -c "ALTER ROLE trust_app WITH PASSWORD '<value from backend/.env.test>';"
# seed permissions/platform settings/market configs — several e2e suites
# (market-data, options, etc.) expect real seeded instrument config, not
# just an empty schema:
DATABASE_URL="postgresql://trust_app:<value from backend/.env.test>@localhost:5433/trust_test?schema=public" npm --prefix backend run seed
npm --prefix backend run test:e2e
```

## Legacy market proxy (optional, not required)

`server/market.js` is a minimal standalone GoldAPI proxy from an earlier
version of this project. The backend (`backend/src/markets/`) now
re-implements the same GoldAPI fetch server-side, so the frontend doesn't
need this legacy server. It's kept only because it still works standalone;
see its own setup notes if you want to run it directly (`MARKET_API_KEY` in
the root `.env`, `npm run market:start`).

## Project status

See `backend/README.md` for the full, up-to-date architecture writeup —
authentication, the double-entry ledger, RBAC/permissions, step-up
re-authentication, audit-log immutability, deposits/withdrawals, and what
is/isn't runtime-verified against a real PostgreSQL instance.
