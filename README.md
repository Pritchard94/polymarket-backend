# PolyNexus Backend

Always-alive Node.js backend for the PolyNexus Polymarket Tracker. Runs 24/7 on Railway, monitoring the Polymarket WebSocket feed for new Yes/No markets and sending Discord notifications to all registered users.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Railway Server                        │
│                                                         │
│  ┌─────────────────┐    ┌────────────────────────────┐  │
│  │  Express API    │    │   Market Monitor           │  │
│  │                 │    │                            │  │
│  │  POST /register │    │  WebSocket (real-time)     │  │
│  │  POST /login    │    │  REST Polling (1 min)      │  │
│  │  GET  /markets  │    │                            │  │
│  │  GET  /health   │    │  → Filters Yes/No markets  │  │
│  └────────┬────────┘    └─────────────┬──────────────┘  │
│           │                           │                  │
│           └───────────────────────────┘                  │
│                         │                                │
│               Discord Webhook Sender                     │
│               (notifies all users)                       │
└─────────────────────────────────────────────────────────┘
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/register` | Register a new user with a Discord Webhook |
| `POST` | `/api/login` | Login with username and password |
| `GET` | `/api/markets` | Get the last 50 detected markets |
| `GET` | `/health` | Health check for Railway |

### Register Body
```json
{
  "username": "alice",
  "password": "secret123",
  "discordWebhook": "https://discord.com/api/webhooks/..."
}
```

## Running Locally

```bash
npm install
npm run dev
```

## Deploying to Railway

1. Push this folder to a separate GitHub repository (e.g. `polymarket-backend`).
2. Go to [railway.app](https://railway.app) and click **New Project → Deploy from GitHub Repo**.
3. Select your backend repository.
4. Railway will auto-detect Node.js and run `npm start`.
5. Add environment variables in the Railway dashboard:
   - `FRONTEND_URL` → your Vercel frontend URL (e.g. `https://polynexus.vercel.app`)
6. Copy the **Railway public URL** (e.g. `https://polymarket-backend.railway.app`).
7. Add it to your **Vercel frontend** as `VITE_API_URL`.

## Notes
- User data is currently in-memory and **resets on server restart**. For production, add a Railway PostgreSQL or MongoDB addon.
- The server connects to `wss://ws-subscriptions-clob.polymarket.com/ws/market` on startup and auto-reconnects on disconnect.
- It also polls `https://gamma-api.polymarket.com/markets` every 60 seconds as a fallback.
