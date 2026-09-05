// Starts a real local S3-compatible HTTP server (via the s3rver package) for
// local development in an environment without Docker/MinIO or any real cloud
// credentials — the dev-hosting counterpart to scripts/dev-db.js. Unlike
// scripts/test-s3.js, this data directory is PERSISTENT (resetOnClose:
// false, survives restarts) so uploaded files (QR codes, CMS media, KYC
// documents, deposit proofs, support attachments) behave like a normal local
// dev environment instead of disappearing every run. Never used in
// production — src/cms/s3-client.factory.ts only ever reads S3_* environment
// variables; .env points those at this server for local dev hosting.
const S3rver = require('s3rver')
const path = require('path')

const PORT = 5436
const BUCKET = 'trust-dev-uploads'

const server = new S3rver({
  port: PORT,
  address: 'localhost',
  silent: true,
  directory: path.join(__dirname, '..', '.s3rver-dev'),
  resetOnClose: false,
  configureBuckets: [{ name: BUCKET, configs: [] }],
})

async function start() {
  await server.run()
  console.log(`READY http://localhost:${PORT} (bucket: ${BUCKET}) — LOCAL DEV ONLY, not a real S3/R2 endpoint`)

  const shutdown = () => {
    server.close(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  // Keep the process (and therefore the child HTTP server) alive.
  setInterval(() => {}, 60_000)
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})
