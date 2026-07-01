/**
 * TrenchReads B2B API — Key management & rate limiting
 *
 * DDL — run once in your Neon console:
 * ─────────────────────────────────────────────────────
 * CREATE TABLE IF NOT EXISTS api_keys (
 *   id            SERIAL PRIMARY KEY,
 *   key           TEXT UNIQUE NOT NULL,
 *   owner_email   TEXT,
 *   owner_name    TEXT,
 *   tier          TEXT NOT NULL DEFAULT 'free',   -- free | builder | growth | scale
 *   daily_limit   INTEGER NOT NULL DEFAULT 50,
 *   calls_today   INTEGER NOT NULL DEFAULT 0,
 *   total_calls   INTEGER NOT NULL DEFAULT 0,
 *   last_reset    DATE NOT NULL DEFAULT CURRENT_DATE,
 *   active        BOOLEAN NOT NULL DEFAULT TRUE,
 *   created_at    TIMESTAMPTZ DEFAULT NOW()
 * );
 * ─────────────────────────────────────────────────────
 *
 * Tier limits:
 *   free     →    50 calls/day
 *   builder  →  2,000 calls/day  ($29/mo)
 *   growth   → 10,000 calls/day  ($79/mo)
 *   scale    → 50,000 calls/day  ($199/mo)
 */

import { neon } from '@neondatabase/serverless';

function db() {
  return neon(process.env.DATABASE_URL);
}

const TIER_LIMITS = {
  free:    50,
  builder: 2000,
  growth:  10000,
  scale:   50000,
};

// ── Key generation ─────────────────────────────────────────────────────────
// tr_api_ prefix — deliberately different from tr_ Pro keys to avoid collision
function generateApiKey() {
  const chars  = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const random = Array.from({ length: 24 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `tr_api_${random}`;
}

// ── Create a new API key ───────────────────────────────────────────────────
export async function createApiKey({ email, name, tier = 'free' }) {
  const sql   = db();
  const key   = generateApiKey();
  const limit = TIER_LIMITS[tier] ?? TIER_LIMITS.free;

  await sql`
    INSERT INTO api_keys (key, owner_email, owner_name, tier, daily_limit)
    VALUES (${key}, ${email || null}, ${name || null}, ${tier}, ${limit})
  `;

  return { key, tier, daily_limit: limit };
}

// ── Auth guard — call at top of every API route ────────────────────────────
// Returns { allowed: true, keyRow } or { allowed: false, status, error }
export async function withApiKeyAuth(req) {
  // Accept key via header (preferred) or query param
  const key = req.headers?.['x-api-key']
    || req.headers?.['authorization']?.replace('Bearer ', '')
    || (req.query || new URL(req.url, 'http://x').searchParams)?.get?.('api_key')
    || req.body?.api_key;

  if (!key) {
    return { allowed: false, status: 401, error: 'API key required. Pass via X-API-Key header or api_key body param.' };
  }

  if (!key.startsWith('tr_api_')) {
    return { allowed: false, status: 401, error: 'Invalid key format. TrenchReads API keys start with tr_api_' };
  }

  const sql = db();

  // Fetch key row
  const rows = await sql`SELECT * FROM api_keys WHERE key = ${key} AND active = TRUE LIMIT 1`;
  if (!rows.length) {
    return { allowed: false, status: 401, error: 'Invalid or revoked API key.' };
  }

  const keyRow = rows[0];

  // Reset daily counter if it's a new day
  const today     = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const lastReset = keyRow.last_reset instanceof Date
    ? keyRow.last_reset.toISOString().slice(0, 10)
    : String(keyRow.last_reset).slice(0, 10);

  if (lastReset !== today) {
    await sql`
      UPDATE api_keys
      SET calls_today = 0, last_reset = CURRENT_DATE
      WHERE key = ${key}
    `;
    keyRow.calls_today = 0;
  }

  // Check rate limit
  if (keyRow.calls_today >= keyRow.daily_limit) {
    return {
      allowed: false,
      status: 429,
      error: `Daily limit reached (${keyRow.daily_limit} calls/day on ${keyRow.tier} tier). Upgrade at trenchreads.vercel.app/api-access`,
      calls_today:  keyRow.calls_today,
      daily_limit:  keyRow.daily_limit,
      tier:         keyRow.tier,
    };
  }

  // Increment usage
  await sql`
    UPDATE api_keys
    SET calls_today = calls_today + 1,
        total_calls = total_calls + 1
    WHERE key = ${key}
  `;

  return {
    allowed:      true,
    keyRow:       { ...keyRow, calls_today: keyRow.calls_today + 1 },
    remaining:    keyRow.daily_limit - keyRow.calls_today - 1,
    tier:         keyRow.tier,
    daily_limit:  keyRow.daily_limit,
  };
}

// ── Admin: list all keys ───────────────────────────────────────────────────
export async function listApiKeys() {
  const sql = db();
  return sql`
    SELECT key, owner_email, owner_name, tier, daily_limit,
           calls_today, total_calls, last_reset, active, created_at
    FROM api_keys
    ORDER BY created_at DESC
  `;
}

// ── Admin: revoke a key ────────────────────────────────────────────────────
export async function revokeApiKey(key) {
  const sql = db();
  await sql`UPDATE api_keys SET active = FALSE WHERE key = ${key}`;
  return { revoked: true, key };
}

// ── Admin: upgrade tier ────────────────────────────────────────────────────
export async function upgradeApiKey(key, tier) {
  const limit = TIER_LIMITS[tier];
  if (!limit) throw new Error(`Unknown tier: ${tier}. Valid: ${Object.keys(TIER_LIMITS).join(', ')}`);
  const sql = db();
  await sql`UPDATE api_keys SET tier = ${tier}, daily_limit = ${limit} WHERE key = ${key}`;
  return { key, tier, daily_limit: limit };
}