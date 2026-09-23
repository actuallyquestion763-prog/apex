// Regression tests for api-proxy.php — the Namecheap PHP reverse proxy.
//
// Runs the REAL api-proxy.php under real PHP (php -S) in front of a fake
// upstream that records exactly what it receives, so every assertion is about
// the bytes the backend would actually get. The only thing changed in the copy
// under test is its hard-coded $backend URL.
//
//   node --test tests/api-proxy.test.mjs
//
// Needs `php` on PATH (with the curl extension). Skips itself, loudly, if not.
// Every scenario runs under BOTH enable_post_data_reading=1 (what the
// production host locks in) and =0 (a host that honors .user.ini).
import test, { describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROXY_SRC = path.join(HERE, '..', 'api-proxy.php')

// ---- environment ------------------------------------------------------------------------
function findPhp() {
  const bin = spawnSync('php', ['-r', 'echo PHP_BINARY;'], { encoding: 'utf8' })
  if (bin.status !== 0) return null
  const phpBinary = bin.stdout.trim()
  const hasCurl = () => spawnSync('php', ['-m'], { encoding: 'utf8' }).stdout.split(/\r?\n/).includes('curl')
  if (hasCurl()) return { extArgs: [] }
  const extDir = path.join(path.dirname(phpBinary), 'ext') // e.g. a Windows/WinGet install with no php.ini
  if (fs.existsSync(path.join(extDir, 'php_curl.dll'))) return { extArgs: ['-d', `extension_dir=${extDir}`, '-d', 'extension=curl', '-d', 'extension=openssl'] }
  return null
}
const php = findPhp()

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) }) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- fake upstream ------------------------------------------------------------------------
let upstream, upstreamPort
const seen = [] // every request the upstream received, newest last
const last = () => seen[seen.length - 1]

async function startUpstream() {
  upstream = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) })
      if (req.url.startsWith('/__status/400')) {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'x-request-id': 'req-123' })
        return res.end(JSON.stringify({ statusCode: 400, message: ['networkCode must be a string'], error: 'Bad Request' }))
      }
      if (req.url.startsWith('/__cookies')) {
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': ['session=abc; HttpOnly; Path=/', 'csrf=xyz; Path=/'] })
        return res.end('{}')
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
  })
  upstreamPort = await freePort()
  await new Promise((r) => upstream.listen(upstreamPort, '127.0.0.1', r))
}

// ---- proxy under test -----------------------------------------------------------------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-proxy-test-'))
const servers = [] // spawned php processes
const proxies = {} // name -> port

async function startProxy(name, { flag, backend, extraIni = [] }) {
  const src = fs.readFileSync(PROXY_SRC, 'utf8')
  const re = /\$backend = '[^']+';/
  assert.match(src, re, 'api-proxy.php no longer declares $backend in the expected form')
  const file = path.join(tmpDir, `${name}.php`)
  fs.writeFileSync(file, src.replace(re, `$backend = '${backend}';`))
  const port = await freePort()
  const proc = spawn('php', [...php.extArgs, '-d', `enable_post_data_reading=${flag}`, ...extraIni, '-S', `127.0.0.1:${port}`, file], { stdio: 'ignore' })
  servers.push(proc)
  for (let i = 0; i < 40; i++) { // wait until it accepts connections
    try { await fetch(`http://127.0.0.1:${port}/api/__ready`); break } catch { await sleep(150) }
  }
  proxies[name] = port
}

before(async () => {
  if (!php) return
  await startUpstream()
  const backend = `http://127.0.0.1:${upstreamPort}`
  await startProxy('flag1', { flag: 1, backend })
  await startProxy('flag0', { flag: 0, backend })
  await startProxy('flag1-small-upload', { flag: 1, backend, extraIni: ['-d', 'upload_max_filesize=1K'] })
  const dead = await freePort() // nothing listens here
  await startProxy('dead-upstream', { flag: 1, backend: `http://127.0.0.1:${dead}` })
})
after(() => { for (const p of servers) p.kill(); upstream?.close(); fs.rmSync(tmpDir, { recursive: true, force: true }) })

// ---- helpers ----------------------------------------------------------------------------------
const call = (name, method, urlPath, { body, headers } = {}) => fetch(`http://127.0.0.1:${proxies[name]}${urlPath}`, { method, body, headers })

// Serialise a FormData exactly like a browser would, so we know the exact bytes and boundary that left the client.
async function encodeForm(entries) {
  const fd = new FormData()
  for (const [k, v] of entries) fd.append(k, v)
  const r = new Response(fd)
  return { contentType: r.headers.get('content-type'), bytes: Buffer.from(await r.arrayBuffer()) }
}
const parseForm = async (rec) => new Response(rec.body, { headers: { 'content-type': rec.headers['content-type'] } }).formData()
const fields = (fd) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'))

// The exact fields DepositWalletPage.tsx sends when Save is confirmed for the ETH wallet.
const WALLET_FIELDS = [
  ['networkCode', 'ETHERIUM'], ['networkName', 'Etherium'], ['receivingAddress', '0x4545e58dd75f65486fc9553277f76f178781bda2'],
  ['sortOrder', '0'], ['enabled', 'false'], ['reason', 'disable the wrong network'], ['confirmPassword', 'correct horse battery'],
]
const WALLET_PATH = '/api/admin/crypto-deposits/assets/ETH/networks'
// Bytes that would corrupt under any text handling: NUL, CR/LF pairs, 0xFF, a fake boundary.
const NASTY = Buffer.concat([Buffer.from([0, 1, 2, 255, 254, 13, 10, 13, 10]), Buffer.from('--not-a-boundary--\r\n'), crypto.randomBytes(2048)])

describe('api-proxy.php', { skip: php ? false : 'php with the curl extension is not available on this machine' }, () => {
  for (const [name, label] of [['flag1', 'enable_post_data_reading=1 (production host)'], ['flag0', 'enable_post_data_reading=0']]) {
    describe(label, () => {
      // ---------------- multipart PATCH / PUT : the production failure ----------------
      for (const method of ['PATCH', 'PUT']) {
        test(`multipart ${method} arrives complete and BYTE-IDENTICAL, with the browser's own boundary`, async () => {
          const { contentType, bytes } = await encodeForm(WALLET_FIELDS)
          const res = await call(name, method, WALLET_PATH, { body: bytes, headers: { 'content-type': contentType, cookie: 'session=abc' } })
          assert.equal(res.status, 200)
          const rec = last()
          assert.equal(rec.method, method) // method preserved
          assert.equal(rec.url, '/admin/crypto-deposits/assets/ETH/networks') // /api/ stripped, rest intact
          assert.equal(rec.headers['content-type'], contentType) // original Content-Type, boundary and all
          assert.equal(Buffer.compare(rec.body, bytes), 0, 'body was altered in transit')
          assert.deepEqual(fields(await parseForm(rec)), Object.fromEntries(WALLET_FIELDS)) // every wallet field present
          assert.equal(rec.headers['cookie'], 'session=abc')
        })

        test(`multipart ${method} with a QR image keeps the file bytes exactly`, async () => {
          const fd = new FormData()
          for (const [k, v] of WALLET_FIELDS) fd.append(k, v)
          fd.append('qr', new Blob([NASTY], { type: 'image/png' }), 'qr.png')
          const r = new Response(fd)
          const contentType = r.headers.get('content-type')
          const bytes = Buffer.from(await r.arrayBuffer())
          const res = await call(name, method, WALLET_PATH, { body: bytes, headers: { 'content-type': contentType } })
          assert.equal(res.status, 200)
          const rec = last()
          assert.equal(Buffer.compare(rec.body, bytes), 0)
          const parsed = await parseForm(rec)
          const file = parsed.get('qr')
          assert.equal(file.name, 'qr.png')
          assert.equal(file.type, 'image/png')
          assert.equal(Buffer.compare(Buffer.from(await file.arrayBuffer()), NASTY), 0)
          assert.equal(parsed.get('reason'), 'disable the wrong network')
        })
      }

      // ---------------- multipart POST : uploads (KYC, deposit proof, Support, CMS media) ----------------
      test('multipart POST with text fields and a binary file arrives complete (file bytes identical)', async () => {
        const fd = new FormData()
        fd.append('body', 'Here is my receipt')
        fd.append('visibility', 'PUBLIC')
        fd.append('file', new Blob([NASTY], { type: 'application/pdf' }), 'receipt.pdf')
        const r = new Response(fd)
        const res = await call(name, 'POST', '/api/support/tickets/t1/attachments', { body: Buffer.from(await r.arrayBuffer()), headers: { 'content-type': r.headers.get('content-type') } })
        assert.equal(res.status, 200)
        const rec = last()
        assert.equal(rec.method, 'POST')
        assert.equal(rec.url, '/support/tickets/t1/attachments')
        assert.match(rec.headers['content-type'], /^multipart\/form-data; boundary=/)
        const parsed = await parseForm(rec)
        assert.equal(parsed.get('body'), 'Here is my receipt')
        assert.equal(parsed.get('visibility'), 'PUBLIC')
        const file = parsed.get('file')
        assert.equal(file.name, 'receipt.pdf')
        assert.equal(file.type, 'application/pdf')
        assert.equal(Buffer.compare(Buffer.from(await file.arrayBuffer()), NASTY), 0)
        assert.equal(Number(rec.headers['content-length']), rec.body.length) // curl computed a correct length
      })

      test('multipart POST with several files (KYC front/back) keeps each one', async () => {
        const front = crypto.randomBytes(3000), back = crypto.randomBytes(1500)
        const fd = new FormData()
        fd.append('idType', 'NATIONAL_ID'); fd.append('idNumber', 'AB1234567890')
        fd.append('front', new Blob([front], { type: 'image/jpeg' }), 'front.jpg')
        fd.append('back', new Blob([back], { type: 'image/png' }), 'back.png')
        const r = new Response(fd)
        assert.equal((await call(name, 'POST', '/api/kyc/submit', { body: Buffer.from(await r.arrayBuffer()), headers: { 'content-type': r.headers.get('content-type') } })).status, 200)
        const parsed = await parseForm(last())
        assert.equal(parsed.get('idType'), 'NATIONAL_ID')
        assert.equal(parsed.get('idNumber'), 'AB1234567890')
        assert.equal(Buffer.compare(Buffer.from(await parsed.get('front').arrayBuffer()), front), 0)
        assert.equal(Buffer.compare(Buffer.from(await parsed.get('back').arrayBuffer()), back), 0)
        assert.equal(parsed.get('back').name, 'back.png')
      })

      // ---------------- JSON must be untouched, every method ----------------
      for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
        test(`JSON ${method} body and Content-Type are forwarded unchanged`, async () => {
          const body = Buffer.from(JSON.stringify({ reason: 'because', confirmPassword: 'pw with "quotes" \\ and ünïcode', n: 1 }))
          const res = await call(name, method, '/api/admin/crypto-deposits/assets/ETH', { body, headers: { 'content-type': 'application/json' } })
          assert.equal(res.status, 200)
          const rec = last()
          assert.equal(rec.method, method)
          assert.equal(rec.headers['content-type'], 'application/json')
          assert.equal(Buffer.compare(rec.body, body), 0)
        })
      }

      test('bodiless GET keeps the query string and a percent-encoded path segment (XAU%2FUSD) exactly', async () => {
        await call(name, 'GET', '/api/markets/XAU%2FUSD/quote?depth=5&x=a%20b')
        const rec = last()
        assert.equal(rec.method, 'GET')
        assert.equal(rec.url, '/markets/XAU%2FUSD/quote?depth=5&x=a%20b')
        assert.equal(rec.body.length, 0)
      })

      // ---------------- headers and upstream responses ----------------
      test('request headers are forwarded; Host/Content-Length reflect the upstream hop', async () => {
        await call(name, 'POST', '/api/x', { body: '{"a":1}', headers: { 'content-type': 'application/json', cookie: 'session=abc; other=1', 'x-custom-header': 'kept', authorization: 'Bearer t' } })
        const h = last().headers
        assert.equal(h['cookie'], 'session=abc; other=1')
        assert.equal(h['x-custom-header'], 'kept')
        assert.equal(h['authorization'], 'Bearer t')
        assert.equal(h['host'], `127.0.0.1:${upstreamPort}`)
        assert.equal(Number(h['content-length']), 7)
      })

      test('an upstream 400 keeps its status, JSON body and headers (so the UI can show the real validation message)', async () => {
        const res = await call(name, 'PATCH', '/api/__status/400', { body: '{}', headers: { 'content-type': 'application/json' } })
        assert.equal(res.status, 400)
        assert.match(res.headers.get('content-type'), /application\/json/)
        assert.equal(res.headers.get('x-request-id'), 'req-123')
        assert.deepEqual(await res.json(), { statusCode: 400, message: ['networkCode must be a string'], error: 'Bad Request' })
      })

      test('every Set-Cookie line from the backend reaches the browser', async () => {
        const res = await call(name, 'GET', '/api/__cookies')
        assert.deepEqual(res.headers.getSetCookie().sort(), ['csrf=xyz; Path=/', 'session=abc; HttpOnly; Path=/'])
      })
    })
  }

  // ---------------- behavior specific to the rebuild path (multipart POST on the locked-on host) ----------------
  describe('multipart POST on a host that locks enable_post_data_reading on (rebuild path)', () => {
    test('is rebuilt with a NEW boundary that matches the forwarded Content-Type', async () => {
      const { contentType, bytes } = await encodeForm([['a', '1'], ['b', 'two']])
      await call('flag1', 'POST', '/api/x', { body: bytes, headers: { 'content-type': contentType } })
      const rec = last()
      const clientBoundary = /boundary=(.+)$/.exec(contentType)[1]
      const sentBoundary = /boundary=(.+)$/.exec(rec.headers['content-type'])[1]
      assert.notEqual(sentBoundary, clientBoundary)
      assert.ok(rec.body.toString('latin1').startsWith(`--${sentBoundary}\r\n`))
      assert.ok(rec.body.toString('latin1').endsWith(`--${sentBoundary}--\r\n`))
      assert.deepEqual(fields(await parseForm(rec)), { a: '1', b: 'two' })
    })

    test('array-shaped and unicode/newline field values survive', async () => {
      const { contentType, bytes } = await encodeForm([['tags[]', 'x'], ['tags[]', 'y'], ['meta[k]', 'v'], ['note', 'línea 1\nlínea 2 — ✓']])
      await call('flag1', 'POST', '/api/x', { body: bytes, headers: { 'content-type': contentType } })
      const parsed = await parseForm(last())
      // What the client actually put on the wire (a real client turns "\n" into "\r\n"), parsed independently of the proxy.
      const sent = await new Response(bytes, { headers: { 'content-type': contentType } }).formData()
      assert.deepEqual(parsed.getAll('tags[]'), ['x', 'y'])
      assert.equal(parsed.get('meta[k]'), 'v')
      assert.equal(parsed.get('note'), sent.get('note'))
      assert.ok(parsed.get('note').includes('línea 2 — ✓'))
    })

    test('an empty file input is skipped rather than sent as a bogus empty file', async () => {
      const b = '----T'
      const raw = `--${b}\r\nContent-Disposition: form-data; name="idType"\r\n\r\nPASSPORT\r\n--${b}\r\nContent-Disposition: form-data; name="back"; filename=""\r\nContent-Type: application/octet-stream\r\n\r\n\r\n--${b}--\r\n`
      await call('flag1', 'POST', '/api/x', { body: raw, headers: { 'content-type': `multipart/form-data; boundary=${b}` } })
      const parsed = await parseForm(last())
      assert.equal(parsed.get('idType'), 'PASSPORT')
      assert.equal(parsed.has('back'), false)
    })

    // (PHP's own upload parser treats a backslash as a path separator and drops everything before it, so a
    // backslash is altered by PHP before the proxy sees it — a limit of this path, not testable here.)
    test('a quote in a client-supplied filename is escaped, never able to break out of the header', async () => {
      const b = '----T'
      const raw = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="say \\"hi\\".txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--${b}--\r\n`
      await call('flag1', 'POST', '/api/x', { body: raw, headers: { 'content-type': `multipart/form-data; boundary=${b}` } })
      const wire = last().body.toString('latin1')
      assert.ok(wire.includes('filename="say \\"hi\\".txt"'), wire)
      assert.equal(wire.split('\r\n').filter((l) => /^X-Injected/i.test(l)).length, 0)
    })

    test('a file over the PHP upload limit is refused with a clear 413 JSON message (not silently dropped)', async () => {
      const fd = new FormData()
      fd.append('kind', 'IMAGE')
      fd.append('file', new Blob([crypto.randomBytes(20 * 1024)], { type: 'image/png' }), 'big.png') // limit is 1K in this proxy
      const r = new Response(fd)
      const before = seen.length
      const res = await call('flag1-small-upload', 'POST', '/api/admin/cms/media', { body: Buffer.from(await r.arrayBuffer()), headers: { 'content-type': r.headers.get('content-type') } })
      assert.equal(res.status, 413)
      assert.match((await res.json()).message, /larger than this server allows/)
      assert.equal(seen.length, before, 'the request must not have been forwarded upstream')
    })
  })

  describe('when php://input is intact (host honors enable_post_data_reading=0)', () => {
    test('multipart POST is forwarded byte-identical — the rebuild path is not used at all', async () => {
      const fd = new FormData()
      fd.append('kind', 'IMAGE')
      fd.append('file', new Blob([NASTY], { type: 'image/png' }), 'logo.png')
      const r = new Response(fd)
      const contentType = r.headers.get('content-type')
      const bytes = Buffer.from(await r.arrayBuffer())
      await call('flag0', 'POST', '/api/admin/cms/media', { body: bytes, headers: { 'content-type': contentType } })
      const rec = last()
      assert.equal(rec.headers['content-type'], contentType)
      assert.equal(Buffer.compare(rec.body, bytes), 0)
    })
  })

  describe('upstream failure', () => {
    test('an unreachable backend still produces a JSON 502 with a message', async () => {
      const res = await call('dead-upstream', 'GET', '/api/health')
      assert.equal(res.status, 502)
      assert.match(res.headers.get('content-type'), /application\/json/)
      assert.match((await res.json()).message, /^Could not reach the backend: /)
    })
  })
})
