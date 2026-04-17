// server.js — PolyNexus Backend
// Express HTTP server + persistent Polymarket WebSocket monitor.
// Designed to run 24/7 on Railway.

const express = require('express');
const cors = require('cors');
const { startMarketMonitor } = require('./marketMonitor');
const { sendDiscordWebhook } = require('./discord');

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  // In production, restrict to your Vercel frontend URL
  origin: process.env.FRONTEND_URL || '*',
}));
app.use(express.json());

// ─── In-Memory Store ──────────────────────────────────────────────────────────
// NOTE: This resets on server restart. For persistence, add a Railway PostgreSQL
// or MongoDB addon and replace these maps with database queries.
const users = new Map();     // username -> { username, hashedPassword, discordWebhook }
const recentMarkets = [];    // last 100 detected markets

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

  // Return safe user data (never return raw password in production — use JWT)
  res.json({
    success: true,
    user: { username: user.username, discordWebhook: user.discordWebhook },
  });
});

// ─── Market Routes ────────────────────────────────────────────────────────────

app.get('/api/markets', (_req, res) => {
  res.json({ markets: recentMarkets.slice(0, 50) });
});

// ─── Health Check (Railway uses this to confirm the service is alive) ─────────

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
app.listen(PORT, () => {
  console.log(`[SERVER] 🚀 PolyNexus backend listening on port ${PORT}`);

  startMarketMonitor((newMarket) => {
    // Store recent market
    recentMarkets.unshift(newMarket);
    if (recentMarkets.length > 100) recentMarkets.pop();

    // Notify every registered user via their Discord webhook
    const allUsers = [...users.values()];
    console.log(`[NOTIFY] 📣 Alerting ${allUsers.length} user(s) about: "${newMarket.title}"`);

    allUsers.forEach((user) => {
      if (user.discordWebhook) {
        sendDiscordWebhook(user.discordWebhook, newMarket);
      }
    });
  });
});
