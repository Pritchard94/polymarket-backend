// server.js — PolyNexus Backend
require('dotenv').config();

// ─── Global crash protection ──────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[PROCESS] ❌ Uncaught exception (recovered):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[PROCESS] ❌ Unhandled rejection (recovered):', reason);
});

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { startMarketMonitor } = require('./marketMonitor');
const { sendDiscordWebhook } = require('./discord');

const app = express();

// ─── Database Configuration ───────────────────────────────────────────────────
const dbUrl = process.env.DATABASE_URL?.trim();
if (!dbUrl) {
  console.warn('[DB] ⚠️  DATABASE_URL is missing! Auth will fail locally.');
}

const pool = new Pool({
  connectionString: dbUrl,
  // Automatically handle SSL based on whether we are connecting to a local or remote DB
  ssl: (dbUrl && !dbUrl.includes('localhost') && !dbUrl.includes('railway.internal')) 
    ? { rejectUnauthorized: false } 
    : false
});

async function initDb() {
  try {
    const client = await pool.connect();
    console.log('[DB] ✅ Connected to PostgreSQL');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT NOT NULL,
        discord_webhook TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    client.release();
    console.log('[DB] ✅ Users table ready');
  } catch (err) {
    console.error('[DB] ❌ Database connection/init failed:', err.message);
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
const allowedOrigins = [
  (process.env.FRONTEND_URL || '').replace(/\/$/, ''),
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:3001'
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
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
app.options('*', cors());
app.use(express.json());

// ─── Shared State ─────────────────────────────────────────────────────────────
const recentMarkets = [];

// ─── Auth Routes ──────────────────────────────────────────────────────────────

app.post('/api/register', async (req, res) => {
  const { username, password, discordWebhook } = req.body;

  if (!username || !password || !discordWebhook) {
    return res.status(400).json({ error: 'username, password and discordWebhook are required' });
  }

  try {
    // Check if user exists
    const check = await pool.query('SELECT username FROM users WHERE username = $1', [username]);
    if (check.rows.length > 0) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // Insert user
    await pool.query(
      'INSERT INTO users (username, password, discord_webhook) VALUES ($1, $2, $3)',
      [username, password, discordWebhook]
    );

    console.log(`[AUTH] ✅ New user registered: ${username}`);
    
    sendDiscordWebhook(discordWebhook, {
      title: '🚀 PolyNexus Connection Established!',
      slug: 'nexus-welcome',
      createdAt: new Date().toISOString()
    });

    res.status(201).json({ success: true, message: 'Registration successful' });
  } catch (err) {
    console.error('[AUTH] ❌ Registration error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];

    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    res.json({
      success: true,
      user: { username: user.username, discordWebhook: user.discord_webhook },
    });
  } catch (err) {
    console.error('[AUTH] ❌ Login error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Market Routes ────────────────────────────────────────────────────────────

app.get('/api/markets', (_req, res) => {
  res.json({ markets: recentMarkets.slice(0, 50) });
});

// ─── Health Check ─────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  try {
    const userCount = await pool.query('SELECT COUNT(*) FROM users');
    res.json({
      status: 'alive',
      db: 'connected',
      usersRegistered: parseInt(userCount.rows[0].count),
      marketsTracked: recentMarkets.length,
      uptime: Math.round(process.uptime()) + 's',
    });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected', message: err.message });
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[SERVER] 🚀 PolyNexus backend listening on 0.0.0.0:${PORT}`);
  
  await initDb();

  const initialMarkets = await startMarketMonitor(async (newMarket) => {
    recentMarkets.unshift(newMarket);
    if (recentMarkets.length > 100) recentMarkets.pop();

    try {
      const result = await pool.query('SELECT discord_webhook FROM users');
      const webhooks = result.rows.map(r => r.discord_webhook);
      
      console.log(`[NOTIFY] 📣 Alerting ${webhooks.length} user(s) about: "${newMarket.title}"`);
      webhooks.forEach(url => sendDiscordWebhook(url, newMarket));
    } catch (err) {
      console.error('[NOTIFY] ❌ Database query failed during notification:', err.message);
    }
  });

  if (initialMarkets && initialMarkets.length > 0) {
    recentMarkets.push(...initialMarkets);
  }
});
