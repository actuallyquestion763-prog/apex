// TEST-ONLY. Starts a real local S3-compatible HTTP server (via the s3rver
// package, an actual implementation of the S3 API, not a mock/stub) for
// backend e2e tests to upload/retrieve/delete real objects against —
// exercising the genuine @aws-sdk/client-s3 request-signing/wire behavior
// MediaStorageService uses, without needing Docker/MinIO or any real cloud
// credentials. Never used by development or production — see
// src/cms/s3-client.factory.ts, which only ever reads S3_* environment
// variables; .env.test points those at this server (see .env.test's own
// comment). Data directory is gitignored and ephemeral (resetOnClose: true).
const S3rver = require('s3rver')
const path = require('path')

const PORT = 5434
const BUCKET = 'trust-test-uploads'

const server = new S3rver({
  port: PORT,
  address: 'localhost',
  silent: true,
  directory: path.join(__dirname, '..', '.s3rver-test'),
  resetOnClose: true,
  configureBuckets: [{ name: BUCKET, configs: [] }],
})

async function start() {
  await server.run()
  console.log(`READY http://localhost:${PORT} (bucket: ${BUCKET}) — TEST-ONLY, not a real S3/R2 endpoint`)

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
