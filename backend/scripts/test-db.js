// Starts a REAL PostgreSQL server (via the embedded-postgres package, which
// bundles actual PostgreSQL binaries) for local integration testing in
// environments without Docker or a system PostgreSQL install. This is not a
// mock or an in-memory emulator — it is the genuine postgres server binary,
// just launched by Node instead of a system service. Data directory is
// gitignored and ephemeral (persistent: false).
const EmbeddedPostgres = require('embedded-postgres').default
const path = require('path')

const pg = new EmbeddedPostgres({
  databaseDir: path.join(__dirname, '..', '.pgdata-test'),
  user: 'postgres',
  password: 'devpassword',
  port: 5433,
  persistent: false,
})

async function start() {
  await pg.initialise()
  await pg.start()
  await pg.createDatabase('trust_test')
  console.log('READY postgresql://postgres:devpassword@localhost:5433/trust_test?schema=public')

  const shutdown = async () => {
    try { await pg.stop() } catch { /* already stopped */ }
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  // Keep the process (and therefore the child postgres process) alive.
  setInterval(() => {}, 60_000)
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})
