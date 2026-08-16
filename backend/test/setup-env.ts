// Loaded before the e2e test suite runs (see test/jest-e2e.json setupFiles).
// Points the app at .env.test — a separate, ephemeral, real PostgreSQL
// instance (see scripts/test-db.js) — never .env.
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.join(__dirname, '..', '.env.test'), override: true })
