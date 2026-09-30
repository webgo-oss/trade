// Ingestion + API + live push. No polling loops, no cron: pulls are started by boot / the Pull button,
// completion arrives via webhook, and the browser is updated over Server-Sent Events.
const express = require('express');
const path = require('path');
const PORT = process.env.PORT || 3000;
const BSE = process.env.BSE_URL || 'http://localhost:4000';
const AUTO = process.env.AUTO_PULL !== 'false'; // start next pull as soon as one completes
const SELF = process.env.SELF_URL || `http://localhost:${PORT}`;

const trades = [];            // in-memory store (see ARCHITECTURE.md for prod notes)
const seen = new Set();
const state = { pulling: false, startedAt: null, etaAt: null, pulls: 0, lastPullAt: null };
const clients = new Set();

const send = (res, ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
const broadcast = (ev, data) => clients.forEach(c => send(c, ev, data));

function ingest(list) {
  const fresh = list.filter(t => !seen.has(t.tradeId)); // idempotent: webhook retries are safe
  fresh.forEach(t => { seen.add(t.tradeId); trades.push(t); });
  return fresh;
}

async function startPull() {
  if (state.pulling) return false;
  const r = await fetch(`${BSE}/getTrades?callback=${encodeURIComponent(SELF + '/webhook/trades')}`, { signal: AbortSignal.timeout(10000) });
  if (r.status !== 202) throw new Error('BSE did not accept job: ' + r.status);
  const { etaMs } = await r.json(); // returns in milliseconds, well under the 30s limit
  Object.assign(state, { pulling: true, startedAt: Date.now(), etaAt: Date.now() + etaMs });
  broadcast('state', state);
  return true;
}

// Event-driven, not a scheduler: the next pull starts because the previous one just finished.
function chainNext() {
  startPull().catch(e => { console.error('[app] next pull failed, retrying in 5s:', e.message); setTimeout(chainNext, 5000); });
}

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/trades', (req, res) => res.json({ trades, state }));   // instant: reads what's already stored
app.post('/api/pull', async (req, res) => {
  try { res.status(await startPull() ? 202 : 409).json(state); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/webhook/trades', (req, res) => {                            // BSE calls this when the pull is ready
  const fresh = ingest(req.body.trades || []);
  Object.assign(state, { pulling: false, etaAt: null, pulls: state.pulls + 1, lastPullAt: Date.now() });
  console.log(`[app] pull ${req.body.jobId}: +${fresh.length} new trades (total ${trades.length})`);
  broadcast('trades', fresh);
  broadcast('state', state);
  res.sendStatus(200);
  if (AUTO) chainNext();
});
app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  send(res, 'state', state);
  clients.add(res);
  const hb = setInterval(() => res.write(': hb\n\n'), 15000); // keepalive so idle proxies (30s) don't cut us
  req.on('close', () => { clearInterval(hb); clients.delete(res); });
});

app.listen(PORT, async () => {
  console.log(`[app] dashboard on http://localhost:${PORT}`);
  // Boot: instant snapshot (delay=0) so the dashboard has data, then start the slow pull.
  for (let i = 0; i < 10; i++) {
    try {
      const snap = await (await fetch(`${BSE}/getTrades?delay=0`)).json();
      ingest(snap.trades); console.log(`[app] baseline loaded: ${trades.length} trades`);
      await startPull(); console.log('[app] background pull started'); break;
    } catch (e) { await new Promise(r => setTimeout(r, 1000)); }
  }
});
