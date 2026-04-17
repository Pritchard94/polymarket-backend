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

/**
 * The Gamma API sometimes returns outcomes as:
 *   - A real JS array: ["Yes", "No"]
 *   - A JSON-encoded string: '["Yes","No"]'
 *   - A comma-separated string: "Yes,No"
 *   - null / undefined
 * This function safely normalises all of those into a plain string array.
 */
function parseOutcomes(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    // Try JSON parse first
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch (_) {}
    // Fallback: comma-separated
    return raw.split(',').map((s) => s.trim());
  }
  return [];
}

function isYesNoMarket(market) {
  const outcomes = parseOutcomes(market.outcomes);
  const lower = outcomes.map((o) => o.toLowerCase());
  return lower.includes('yes') && lower.includes('no');
}

function normalizeMarket(market) {
  return {
    id: market.id || market.conditionId,
    title: market.question || market.title || 'Untitled Market',
    slug: market.slug || market.marketSlug || market.id || 'unknown',
    createdAt: market.createdAt || new Date().toISOString(),
    outcomes: parseOutcomes(market.outcomes),
  };
}

function processMarket(raw) {
  try {
    const id = raw.id || raw.conditionId;
    if (!id || seenMarketIds.has(id)) return; // In-session dedup guard
    if (!isYesNoMarket(raw)) return;           // Must have Yes/No outcomes

    seenMarketIds.add(id);
    const market = normalizeMarket(raw);
    console.log(`[MONITOR] 🆕 NEW SIGNAL DETECTED: ${market.title}`);
    if (onNewMarket) onNewMarket(market);
  } catch (err) {
    console.error('[MONITOR] ❌ Error processing market:', err.message);
  }
}

// ─── REST Polling ─────────────────────────────────────────────────────────────

async function pollMarkets() {
  try {
    // Query the Gamma API for all active markets, ordered by creation date
    const url = `${GAMMA_API_URL}?active=true&closed=false&limit=30&order=createdAt&ascending=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const markets = Array.isArray(data) ? data : (data.markets || []);
    console.log(`[MONITOR] ♻️  Poll complete — checking ${markets.length} recent markets`);
    markets.forEach(processMarket);
  } catch (err) {
    console.error('[MONITOR] ❌ Poll failed:', err.message);
  }
}

async function fetchInitialMarkets() {
  try {
    // 1. Fetch the 100 most recent active markets
    const url = `${GAMMA_API_URL}?active=true&closed=false&limit=100&order=createdAt&ascending=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // 2. Identify markets that are Yes/No and NOT in our initial seed
    const initialNewMarkets = allMarkets
      .filter(m => isYesNoMarket(m))
      .map(normalizeMarket)
      .slice(0, 20); // Just take the top 20 most recent for the initial feed

    // 3. Mark all 100 as 'seen'
    allMarkets.forEach((m) => {
      const id = m.id || m.conditionId;
      if (id) seenMarketIds.add(id);
    });

    console.log(`[MONITOR] ✅ Seeded ${seenMarketIds.size} market IDs. Displaying top ${initialNewMarkets.length} in feed.`);
    return initialNewMarkets;
  } catch (err) {
    console.error('[MONITOR] ❌ Failed to seed initial markets:', err.message);
    return [];
  }
}

// ─── WebSocket ────────────────────────────────────────────────────────────────

function connectWebSocket(tokenIds) {
  try {
    ws = new WebSocket(CLOB_WS_URL);
  } catch (err) {
    console.error('[WS] ❌ Failed to create WebSocket:', err.message);
    setTimeout(() => connectWebSocket(tokenIds), 10000);
    return;
  }

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
    // Log but don't crash — the 'close' event will trigger reconnect
    console.error('[WS] ❌ Error:', err.message);
  });
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

async function startMarketMonitor(callback) {
  onNewMarket = callback;

  console.log('[MONITOR] 🚀 Starting Polymarket monitor...');

  // 1. Fetch initial markets (returns the filtered 'new' ones)
  const initialNewMarkets = await fetchInitialMarkets();

  // 2. Fetch some active markets just for WebSocket asset tracking
  // (We need raw tokens/ids which were hidden inside fetchInitialMarkets before)
  // Let's just return the new ones for now.
  
  connectWebSocket([]); // We'll rely more on polling for 'new' markets as per request
  pollInterval = setInterval(pollMarkets, POLL_INTERVAL_MS);

  return initialNewMarkets;
}

module.exports = { startMarketMonitor };
