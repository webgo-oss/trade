# BSE Trades: async pull + live dashboard

Mock BSE API (15 min pull) and a dashboard that shows pulled trades instantly and updates live when a pull completes. See [ARCHITECTURE.md](ARCHITECTURE.md) for the diagram and reasoning.

## Setup
Requires Node 18+.
```
npm install
npm run demo     # 20 s pull delay, good for a video
npm start        # real 15 min delay
```
Open http://localhost:3000. Mock BSE runs on :4000.

Windows PowerShell for a custom delay: `node start.js --delay=45000`

## How it works (short)
1. On boot the app takes an instant snapshot (`/getTrades?delay=0`) so the dashboard has data, then requests a real pull with `callback=/webhook/trades`. BSE answers `202` right away.
2. The dashboard loads `/api/trades` (instant) and subscribes to `/events` (SSE).
3. After the delay, BSE POSTs the trades to the webhook. The app dedupes, stores, and pushes only the new rows to open dashboards, which highlight them.
4. As soon as a pull completes, the app starts the next one automatically (event-driven chaining, not a scheduler). Set `AUTO_PULL=false` to stop after the first pull. No cron, no polling, no clicking.

## Config (env vars)
| Var | Default | Meaning |
|---|---|---|
| `PULL_DELAY_MS` | 900000 | Mock BSE pull time |
| `AUTO_PULL` | true | Start next pull when one completes |
| `TRADE_COUNT` | 3000 | Trades per pull |
| `PORT` / `BSE_PORT` | 3000 / 4000 | Ports |

## Endpoints
- Mock: `GET /getTrades[?callback=url][&delay=ms]`
- App: `GET /api/trades`, `POST /api/pull`, `POST /webhook/trades`, `GET /events` (SSE)

## Try the failure mode
`curl "localhost:4000/getTrades?delay=40000"` holds the connection 40 s. That is the pattern a 30 s network cut would kill.
