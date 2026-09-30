// Mock BSE Exchange API.
// GET /getTrades
//   ?callback=<url>  -> 202 immediately; after PULL_DELAY_MS the trades are POSTed to <url> (webhook).
//   (no callback)    -> holds the connection for the delay, like the real BSE. Anything >30s gets
//                       killed by our network, which is exactly the problem this design avoids.
//   ?delay=<ms>      -> overrides the configured delay (0 = instant snapshot).
const express = require('express');
const PORT = process.env.BSE_PORT || 4000;
const DEFAULT_DELAY = Number(process.env.PULL_DELAY_MS ?? 15 * 60 * 1000);
const COUNT = Number(process.env.TRADE_COUNT || 3000);

const CLIENTS = ['Zerodha-PB', 'Motilal Oswal', 'Kotak Sec', 'HDFC Sec', 'ICICI Direct', 'Angel One', 'Edelweiss', 'Sharekhan'];
const SYMBOLS = { RELIANCE: 2900, TCS: 4100, INFY: 1750, HDFCBANK: 1650, ICICIBANK: 1200, SBIN: 820, ITC: 470, LT: 3600, BHARTIARTL: 1500, TATAMOTORS: 980 };
const NAMES = Object.keys(SYMBOLS);

let nextId = 1; // global so trade IDs never repeat across pulls
function rng(seed) { // mulberry32: deterministic seeded PRNG
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
let batchNo = 0;
function makeBatch() {
  const r = rng(1000 + batchNo++), now = Date.now(), out = [];
  for (let i = 0; i < COUNT; i++) {
    const sym = NAMES[Math.floor(r() * NAMES.length)];
    out.push({
      tradeId: 'BSE' + String(nextId++).padStart(8, '0'),
      client: CLIENTS[Math.floor(r() * CLIENTS.length)],
      symbol: sym,
      quantity: (1 + Math.floor(r() * 50)) * 10,
      price: +(SYMBOLS[sym] * (0.97 + r() * 0.06)).toFixed(2),
      timestamp: new Date(now - Math.floor(r() * 6 * 3600e3)).toISOString(),
    });
  }
  return out;
}

async function deliver(url, body) {
  for (let a = 1; a <= 5; a++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) return console.log(`[bse] job ${body.jobId} delivered (${body.trades.length} trades)`);
    } catch (e) { /* retry */ }
    await new Promise(r => setTimeout(r, 2000 * a));
  }
  console.error(`[bse] job ${body.jobId} delivery failed`);
}

const app = express();
app.get('/getTrades', (req, res) => {
  const delay = req.query.delay !== undefined ? Number(req.query.delay) : DEFAULT_DELAY;
  const { callback } = req.query;
  const jobId = 'job-' + Date.now();
  if (!callback) return setTimeout(() => res.json({ jobId, trades: makeBatch() }), delay);
  console.log(`[bse] job ${jobId} accepted, ready in ${delay}ms`);
  res.status(202).json({ jobId, status: 'processing', etaMs: delay });
  setTimeout(() => deliver(callback, { jobId, trades: makeBatch() }), delay);
});
app.listen(PORT, () => console.log(`[bse] mock listening on :${PORT} (delay ${DEFAULT_DELAY}ms, ${COUNT} trades/pull)`));
