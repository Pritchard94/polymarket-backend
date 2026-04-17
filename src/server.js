// server.js — PolyNexus Backend
// Express HTTP server + persistent Polymarket WebSocket monitor.
// Designed to run 24/7 on Railway.

// ─── Global crash protection (must be FIRST) ──────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[PROCESS] ❌ Uncaught exception (recovered):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[PROCESS] ❌ Unhandled rejection (recovered):', reason);
});

const express = require('express');
const cors = require('cors');
const { startMarketMonitor } = require('./marketMonitor');
const { sendDiscordWebhook } = require('./discord');

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
const allowedOrigins = [
  (process.env.FRONTEND_URL || '').replace(/\/$/, ''),
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:3001'
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
// Handle preflight OPTIONS requests for all routes
app.options('*', cors());
app.use(express.json());

// ─── In-Memory Store ──────────────────────────────────────────────────────────
const users = new Map();
const recentMarkets = [];

// ─── Auth Routes ──────────────────────────────────────────────────────────────

app.post('/api/register', (req, res) => {
  const { username, password, discordWebhook } = req.body;

  if (!username || !password || !discordWebhook) {
    return res.status(400).json({ error: 'username, password and discordWebhook are required' });
  }
  if (users.has(username)) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  users.set(username, { username, password, discordWebhook });
  console.log(`[AUTH] ✅ New user registered: ${username}`);
  res.status(201).json({ success: true, message: 'Registration successful' });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.get(username);

  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  res.json({
    success: true,
    user: { username: user.username, discordWebhook: user.discordWebhook },
  });
});

// ─── Market Routes ────────────────────────────────────────────────────────────

app.get('/api/markets', (_req, res) => {
  res.json({ markets: recentMarkets.slice(0, 50) });
});

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'alive',
    usersRegistered: users.size,
    marketsTracked: recentMarkets.length,
    uptime: Math.round(process.uptime()) + 's',
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] 🚀 PolyNexus backend listening on 0.0.0.0:${PORT}`);
  console.log(`[SERVER] Primary CORS allowed origin: ${allowedOrigins[0]}`);

  startMarketMonitor((newMarket) => {
    recentMarkets.unshift(newMarket);
    if (recentMarkets.length > 100) recentMarkets.pop();

    const allUsers = [...users.values()];
    console.log(`[NOTIFY] 📣 Alerting ${allUsers.length} user(s) about: "${newMarket.title}"`);

    allUsers.forEach((user) => {
      if (user.discordWebhook) {
        sendDiscordWebhook(user.discordWebhook, newMarket);
      }
    });
  });
});
