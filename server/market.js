// ⚠️ DEPRECATED / SUPERSEDED (Phase 6B) — this standalone Express proxy
// predates the NestJS backend and is no longer used by the frontend or any
// other part of the application. It has been fully superseded by the
// centralized Market Data Service (backend/src/markets/), which reimplements
// the same GoldAPI XAU/USD logic behind a normalized, provider-agnostic API
// (GET /markets, /markets/:symbol/quote, /markets/quotes) with proper
// validation, staleness handling, and multi-instrument support this file
// never had. Nothing currently imports, runs, or points at this file — no
// script in package.json invokes it, and src/store/priceFeed.ts now talks
// only to the NestJS backend's /api/markets/* routes.
//
// It has NOT been deleted this phase (destructive cleanup wasn't necessary
// to complete Phase 6B) — recommended for removal in a future cleanup pass
// once confirmed nothing external still depends on it. Left functionally
// unchanged below for reference/audit purposes only.
import 'dotenv/config'
import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())

const PORT = process.env.MARKET_PORT ? Number(process.env.MARKET_PORT) : 4001
const GOLDAPI_URL = 'https://www.goldapi.io/api/XAU/USD'
const API_KEY = process.env.MARKET_API_KEY

let lastValid = null
let lastFetch = 0
const TTL_MS = 30_000 // conservative cache TTL to avoid excessive requests

function makeResp(price, bid, ask, providerTs, stale) {
  return {
    price,
    bid: bid ?? null,
    ask: ask ?? null,
    timestamp: providerTs ? new Date(providerTs * 1000).toISOString() : new Date().toISOString(),
    source: 'GoldAPI',
    stale: !!stale,
  }
}

app.get('/market/xau', async (req, res) => {
  if (!API_KEY) {
    res.setHeader('Content-Type', 'application/json')
    return res.status(503).json({ error: 'market_api_key_missing', message: 'Market API key not configured on server' })
  }

  const now = Date.now()
  // If last fetch is fresh, return cached value (not stale)
  if (lastValid && now - lastFetch < TTL_MS) {
    res.setHeader('X-Market-Cache-TTL', String(TTL_MS))
    res.setHeader('X-Market-Last-Fetch', String(lastFetch))
    return res.json(makeResp(lastValid.price, lastValid.bid, lastValid.ask, lastValid.timestamp, false))
  }

  try {
    const resp = await fetch(GOLDAPI_URL, { headers: { 'x-access-token': API_KEY } })
    if (!resp.ok) throw new Error(`provider status ${resp.status}`)
    const body = await resp.json()

    const price = Number(body.price)
    const bid = body.bid != null ? Number(body.bid) : null
    const ask = body.ask != null ? Number(body.ask) : null
    const providerTs = body.timestamp ? Number(body.timestamp) : Math.floor(Date.now() / 1000)

    if (!Number.isFinite(price) || price <= 0) {
      throw new Error('invalid price from provider')
    }

    lastValid = { price, bid, ask, timestamp: providerTs }
    lastFetch = Date.now()
    res.setHeader('X-Market-Cache-TTL', String(TTL_MS))
    res.setHeader('X-Market-Last-Fetch', String(lastFetch))
    return res.json(makeResp(price, bid, ask, providerTs, false))
  } catch (err) {
    // On failure, return last valid with stale=true if available
    if (lastValid) {
      res.setHeader('X-Market-Cache-TTL', String(TTL_MS))
      res.setHeader('X-Market-Last-Fetch', String(lastFetch))
      return res.json(makeResp(lastValid.price, lastValid.bid, lastValid.ask, lastValid.timestamp, true))
    }
    return res.status(502).json({ error: 'market_unavailable', message: 'Market data unavailable', detail: String(err) })
  }
})

app.listen(PORT, () => {
  // Do not log API key
  console.log(`market server listening on http://localhost:${PORT}`)
})
