// Starts a REAL PostgreSQL server (via the embedded-postgres package, which
// bundles actual PostgreSQL binaries) for local development in an
// environment without Docker or a system PostgreSQL install. Unlike
// scripts/test-db.js, this data directory is PERSISTENT (survives restarts)
// so it behaves like a normal local dev database. Gitignored.
const EmbeddedPostgres = require('embedded-postgres').default
const fs = require('fs')
const path = require('path')

const dataDir = path.join(__dirname, '..', '.pgdata-dev')

// Port 5432 is occupied by an unrelated, pre-existing Windows PostgreSQL
// service on this machine (installed outside this project, auto-starts on
// boot) — using 5435 instead avoids depending on that foreign service being
// stopped every time this machine restarts. Purely a network-binding
// change; the actual data directory/cluster is untouched.
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'devpassword',
  port: 5435,
  persistent: true,
})

async function start() {
  // initdb (pg.initialise()) refuses to run against a non-empty directory —
  // correct the FIRST time this ever runs (fresh dir), but this data
  // directory is persistent by design, so every subsequent restart must
  // skip re-init and only start the existing cluster. PG_VERSION is the
  // standard marker Postgres itself uses to know a data directory already
  // holds an initialized cluster. Never delete/recreate this directory here
  // — that would be a real database reset, which this script must not do.
  const alreadyInitialised = fs.existsSync(path.join(dataDir, 'PG_VERSION'))
  if (!alreadyInitialised) await pg.initialise()
  await pg.start()
  try {
    await pg.createDatabase('trust_dev')
  } catch {
    // already exists from a previous run — fine.
  }
  console.log('READY postgresql://postgres:devpassword@localhost:5435/trust_dev?schema=public')

  const shutdown = async () => {
    try { await pg.stop() } catch { /* already stopped */ }
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  setInterval(() => {}, 60_000)
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})
