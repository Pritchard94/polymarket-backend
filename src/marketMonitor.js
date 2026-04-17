// marketMonitor.js
// Connects to Polymarket's WebSocket and polls the Gamma REST API.
// Detects truly NEW Yes/No markets and triggers the onNewMarket callback.

const WebSocket = require('ws');

const CLOB_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const GAMMA_API_URL = 'https://gamma-api.polymarket.com/markets';
const POLL_INTERVAL_MS = 60 * 1000; // 1 minute

const seenMarketIds = new Set();
let onNewMarket = null;
let ws = null;
let pollInterval = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isYesNoMarket(market) {
  const outcomes = market.outcomes || [];
  const lower = outcomes.map((o) => (typeof o === 'string' ? o.toLowerCase() : ''));
  return lower.includes('yes') && lower.includes('no');
}

function normalizeMarket(market) {
  return {
    id: market.id || market.conditionId,
    title: market.question || market.title || 'Untitled Market',
    slug: market.slug || market.marketSlug || market.id || 'unknown',
    createdAt: market.createdAt || new Date().toISOString(),
    outcomes: market.outcomes || ['Yes', 'No'],
  };
}

function processMarket(raw) {
  const id = raw.id || raw.conditionId;
  if (!id || seenMarketIds.has(id)) return;
  if (!isYesNoMarket(raw)) return;

  seenMarketIds.add(id);
  const market = normalizeMarket(raw);
  console.log(`[MONITOR] 🆕 NEW MARKET: ${market.title}`);
  if (onNewMarket) onNewMarket(market);
}

// ─── REST Polling (Primary + Fallback) ────────────────────────────────────────

async function pollMarkets() {
  try {
    const url = `${GAMMA_API_URL}?active=true&closed=false&limit=20&order=createdAt&ascending=false`;
    const res = await fetch(url);
    const data = await res.json();
    const markets = Array.isArray(data) ? data : data.markets || [];
    markets.forEach(processMarket);
    console.log(`[MONITOR] ♻️ Polled REST API — ${seenMarketIds.size} markets tracked`);
  } catch (err) {
    console.error('[MONITOR] ❌ Poll failed:', err.message);
  }
}

async function fetchInitialMarkets() {
  try {
    const url = `${GAMMA_API_URL}?active=true&closed=false&limit=100&order=createdAt&ascending=false`;
    const res = await fetch(url);
    const data = await res.json();
    const markets = Array.isArray(data) ? data : data.markets || [];
    markets.forEach((m) => {
      const id = m.id || m.conditionId;
      if (id) seenMarketIds.add(id);
    });
    console.log(`[MONITOR] ✅ Seeded ${seenMarketIds.size} existing markets (won't re-alert)`);
    return markets;
  } catch (err) {
    console.error('[MONITOR] ❌ Failed to fetch initial markets:', err.message);
    return [];
  }
}

// ─── WebSocket (Real-time Layer) ──────────────────────────────────────────────

function connectWebSocket(tokenIds) {
  ws = new WebSocket(CLOB_WS_URL);

  ws.on('open', () => {
    console.log('[WS] ✅ Connected to Polymarket WebSocket');
    const ids = tokenIds.length > 0 ? tokenIds.slice(0, 50) : ['placeholder'];
    ws.send(
      JSON.stringify({
        assets_ids: ids,
        type: 'market',
        custom_feature_enabled: true,
      })
    );
  });

  ws.on('message', (data) => {
    try {
      const events = JSON.parse(data.toString());
      const arr = Array.isArray(events) ? events : [events];
      arr.forEach((evt) => {
        if (evt.event_type === 'new_market') {
          processMarket(evt.market || evt);
        } else if (evt.market) {
          processMarket(evt.market);
        }
      });
    } catch (_) {
      // Ignore non-JSON ping frames
    }
  });

  ws.on('close', () => {
    console.warn('[WS] ⚠️  Disconnected. Reconnecting in 5s...');
    setTimeout(() => connectWebSocket(tokenIds), 5000);
  });

  ws.on('error', (err) => {
    console.error('[WS] ❌ Error:', err.message);
  });
}

// ─── Public Entry Point ────────────────────────────────────────────────────────

async function startMarketMonitor(callback) {
  onNewMarket = callback;

  console.log('[MONITOR] 🚀 Starting Polymarket monitor...');
  const initialMarkets = await fetchInitialMarkets();

  // Extract token IDs for WebSocket subscription
  const tokenIds = initialMarkets
    .flatMap((m) => m.tokens || m.clobTokenIds || [])
    .map((t) => (typeof t === 'string' ? t : t.token_id))
    .filter(Boolean);

  // Real-time WebSocket layer
  connectWebSocket(tokenIds);

  // REST polling fallback (every 60s)
  pollInterval = setInterval(pollMarkets, POLL_INTERVAL_MS);
}

module.exports = { startMarketMonitor };
