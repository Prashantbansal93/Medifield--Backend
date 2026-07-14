# Medifield API

Node.js / Express / MongoDB backend for the Medifield pharmaceutical supply-chain platform.

Full architecture, role lifecycle, Docker Compose, and setup instructions live in the monorepo root:

[`../README.md`](../README.md)

## Quick start

```bash
cp .env.example .env
npm install
npm run dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start API with watch mode |
| `npm test` | Jest unit tests |
| `npm run lint` | ESLint |
| `npm run seed:demo` | Seed demo accounts and data |

## Key modules

- `src/utils/orderHelpers.js` — geo nearest-wholesaler routing, atomic inventory
- `src/utils/geo.js` — haversine distance + ETA
- `src/utils/notifications.js` — persisted + socket notifications
- `src/utils/transactions.js` — Mongo sessions with standalone fallback
- `src/realtime.js` — Socket.IO (+ optional Redis adapter via `REDIS_URL`)
