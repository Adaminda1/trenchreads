import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

// ── Tier config ────────────────────────────────────────────────────────────
export const API_TIERS = {
  free:    { price: 0,   calls: 50,    label: 'Free'    },
  builder: { price: 29,  calls: 2000,  label: 'Builder' },
  growth:  { price: 79,  calls: 10000, label: 'Growth'  },
  scale:   { price: 199, calls: 50000, label: 'Scale'   },
};

// ── Setup all tables ───────────────────────────────────────────────────────
export async function setupDB() {
  // Pro keys (web + telegram + B2B)
  await sql`
    CREATE TABLE IF NOT EXISTS api_keys (
      id           SERIAL PRIMARY KEY,
      key          TEXT UNIQUE NOT NULL,
      email        TEXT,
      plan         TEXT DEFAULT 'lifetime',
      status       TEXT DEFAULT 'active',
      created_at   TIMESTAMP DEFAULT NOW(),
      expires_at   TIMESTAMP,
      tx_signature TEXT UNIQUE,
      -- B2B API fields
      tier         TEXT DEFAULT 'free',
      daily_limit  INTEGER DEFAULT 50,
      calls_today  INTEGER DEFAULT 0,
      total_calls  INTEGER DEFAULT 0,
      last_reset   DATE DEFAULT CURRENT_DATE,
      owner_name   TEXT,
      renewed_at   TIMESTAMP DEFAULT NOW()
    )
  `;

  // Migrations for existing installs
  await sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'free'`;
  await sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS daily_limit INTEGER DEFAULT 50`;
  await sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS calls_today INTEGER DEFAULT 0`;
  await sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS total_calls INTEGER DEFAULT 0`;
  await sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_reset DATE DEFAULT CURRENT_DATE`;
  await sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS owner_name TEXT`;
  await sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS renewed_at TIMESTAMP DEFAULT NOW()`;
  await sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS tx_signature TEXT`;

  // Web free usage
  await sql`
    CREATE TABLE IF NOT EXISTS free_usage (
      ip    TEXT PRIMARY KEY,
      count INTEGER DEFAULT 0,
      date  TEXT
    )
  `;

  // Telegram users
  await sql`
    CREATE TABLE IF NOT EXISTS telegram_users (
      id           SERIAL PRIMARY KEY,
      chat_id      TEXT UNIQUE NOT NULL,
      pro_key      TEXT NOT NULL,
      email        TEXT,
      activated_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (pro_key) REFERENCES api_keys(key) ON DELETE CASCADE
    )
  `;

  // Telegram free usage
  await sql`
    CREATE TABLE IF NOT EXISTS telegram_free_usage (
      chat_id TEXT PRIMARY KEY,
      count   INTEGER DEFAULT 0,
      date    TEXT
    )
  `;
}

// ── Web Pro key validation ─────────────────────────────────────────────────
export async function validateKey(key) {
  if (!key) return null;
  const rows = await sql`
    SELECT * FROM api_keys
    WHERE key = ${key}
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > NOW())
  `;
  return rows[0] || null;
}

// ── Web free usage ─────────────────────────────────────────────────────────
export async function checkFreeLimit(ip) {
  const today = new Date().toISOString().split('T')[0];
  const rows  = await sql`SELECT * FROM free_usage WHERE ip = ${ip}`;
  if (!rows[0] || rows[0].date !== today) {
    await sql`
      INSERT INTO free_usage (ip, count, date) VALUES (${ip}, 1, ${today})
      ON CONFLICT (ip) DO UPDATE SET count = 1, date = ${today}
    `;
    return { allowed: true, remaining: 0 };
  }
  return { allowed: false, remaining: 0 };
}

// ── Key creation (web Pro — lifetime/monthly/yearly) ───────────────────────
export async function createKey(email, plan = 'lifetime') {
  const key       = 'tr_' + Math.random().toString(36).slice(2,10) + Math.random().toString(36).slice(2,10);
  const expiresAt = plan === 'yearly'
    ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    : plan === 'monthly'
    ? new Date(Date.now() + 30  * 24 * 60 * 60 * 1000)
    : null;
  await sql`
    INSERT INTO api_keys (key, email, plan, expires_at)
    VALUES (${key}, ${email}, ${plan}, ${expiresAt})
  `;
  return key;
}

// ── B2B API key creation ───────────────────────────────────────────────────
export async function createApiKey({ email, name, tier = 'free' }) {
  const tierConfig = API_TIERS[tier] || API_TIERS.free;
  const chars      = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const random     = Array.from({ length: 24 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const key        = `tr_api_${random}`;
  const expiresAt  = tier === 'free'
    ? null
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days for paid tiers

  await sql`
    INSERT INTO api_keys (key, owner_email, owner_name, tier, daily_limit, status, expires_at)
    VALUES (${key}, ${email || null}, ${name || null}, ${tier}, ${tierConfig.calls}, 'active', ${expiresAt})
  `;
  return { key, tier, daily_limit: tierConfig.calls, expires_at: expiresAt };
}

// ── B2B API key auth + rate limit ──────────────────────────────────────────
export async function withApiKeyAuth(req) {
  const key = req.headers?.['x-api-key']
    || req.headers?.['authorization']?.replace('Bearer ', '')
    || req.body?.api_key;

  if (!key) return { allowed: false, status: 401, error: 'API key required. Pass via X-API-Key header.' };
  if (!key.startsWith('tr_api_')) return { allowed: false, status: 401, error: 'Invalid key format. B2B keys start with tr_api_' };

  const rows = await sql`SELECT * FROM api_keys WHERE key = ${key} AND status = 'active' LIMIT 1`;
  if (!rows.length) return { allowed: false, status: 401, error: 'Invalid or revoked API key.' };

  const keyRow = rows[0];

  // Check monthly expiry for paid tiers
  if (keyRow.tier !== 'free' && keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
    await sql`UPDATE api_keys SET status = 'expired' WHERE key = ${key}`;
    return {
      allowed: false, status: 402,
      error: `Your ${keyRow.tier} plan expired on ${new Date(keyRow.expires_at).toDateString()}. Renew at trenchreads.vercel.app or DM @Web3Abdull`,
      tier: keyRow.tier,
    };
  }

  // Reset daily counter if new day
  const today     = new Date().toISOString().slice(0, 10);
  const lastReset = keyRow.last_reset instanceof Date
    ? keyRow.last_reset.toISOString().slice(0, 10)
    : String(keyRow.last_reset).slice(0, 10);

  if (lastReset !== today) {
    await sql`UPDATE api_keys SET calls_today = 0, last_reset = CURRENT_DATE WHERE key = ${key}`;
    keyRow.calls_today = 0;
  }

  // Check daily rate limit
  if (keyRow.calls_today >= keyRow.daily_limit) {
    return {
      allowed: false, status: 429,
      error: `Daily limit reached (${keyRow.daily_limit} calls/day on ${keyRow.tier} tier). Upgrade at trenchreads.vercel.app`,
      calls_today: keyRow.calls_today,
      daily_limit: keyRow.daily_limit,
      tier: keyRow.tier,
    };
  }

  // Increment usage
  await sql`
    UPDATE api_keys
    SET calls_today = calls_today + 1, total_calls = total_calls + 1
    WHERE key = ${key}
  `;

  return {
    allowed:     true,
    keyRow:      { ...keyRow, calls_today: keyRow.calls_today + 1 },
    remaining:   keyRow.daily_limit - keyRow.calls_today - 1,
    tier:        keyRow.tier,
    daily_limit: keyRow.daily_limit,
  };
}

// ── B2B renewal — extend subscription 30 days ─────────────────────────────
export async function renewApiKey(key, txSignature) {
  const rows = await sql`SELECT * FROM api_keys WHERE key = ${key} LIMIT 1`;
  if (!rows.length) return { success: false, error: 'Key not found.' };

  const keyRow    = rows[0];
  const tierConfig = API_TIERS[keyRow.tier] || API_TIERS.free;

  // Check tx not already used
  const dupCheck = await sql`SELECT id FROM api_keys WHERE tx_signature = ${txSignature} LIMIT 1`;
  if (dupCheck.length) return { success: false, error: 'Transaction already used for a renewal.' };

  // Extend from now or from current expiry (whichever is later)
  const base      = keyRow.expires_at && new Date(keyRow.expires_at) > new Date()
    ? new Date(keyRow.expires_at)
    : new Date();
  const newExpiry = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);

  await sql`
    UPDATE api_keys
    SET status = 'active', expires_at = ${newExpiry}, tx_signature = ${txSignature}, renewed_at = NOW()
    WHERE key = ${key}
  `;

  return {
    success:    true,
    key,
    tier:       keyRow.tier,
    expires_at: newExpiry,
    price:      tierConfig.price,
  };
}

// ── Telegram: activate pro ─────────────────────────────────────────────────
export async function activateTelegramPro(chatId, proKey) {
  const keyRow = await validateKey(proKey);
  if (!keyRow) return { success: false, error: 'Invalid or expired Pro key.' };
  await sql`
    INSERT INTO telegram_users (chat_id, pro_key, email)
    VALUES (${String(chatId)}, ${proKey}, ${keyRow.owner_email || null})
    ON CONFLICT (chat_id) DO UPDATE SET pro_key = ${proKey}, activated_at = NOW()
  `;
  return { success: true, email: keyRow.owner_email };
}

// ── Telegram: check pro status ─────────────────────────────────────────────
export async function isTelegramPro(chatId) {
  const rows = await sql`
    SELECT tu.chat_id, ak.status, ak.expires_at
    FROM telegram_users tu
    JOIN api_keys ak ON tu.pro_key = ak.key
    WHERE tu.chat_id = ${String(chatId)}
    AND ak.status = 'active'
    AND (ak.expires_at IS NULL OR ak.expires_at > NOW())
  `;
  return rows.length > 0;
}

// ── Telegram: free usage (3 scans/day per chat_id) ────────────────────────
export async function checkTelegramFreeLimit(chatId) {
  const today = new Date().toISOString().split('T')[0];
  const id    = String(chatId);
  const rows  = await sql`SELECT * FROM telegram_free_usage WHERE chat_id = ${id}`;
  if (!rows[0] || rows[0].date !== today) {
    await sql`
      INSERT INTO telegram_free_usage (chat_id, count, date) VALUES (${id}, 1, ${today})
      ON CONFLICT (chat_id) DO UPDATE SET count = 1, date = ${today}
    `;
    return { allowed: true, remaining: 0 };
  }
  return { allowed: false, remaining: 0 };
}

// ── Admin helpers ──────────────────────────────────────────────────────────
export async function listApiKeys() {
  return sql`SELECT key, email, owner_name, tier, daily_limit, calls_today, total_calls, status, expires_at, created_at FROM api_keys ORDER BY created_at DESC`;
}

export async function revokeApiKey(key) {
  await sql`UPDATE api_keys SET status = 'revoked' WHERE key = ${key}`;
  return { revoked: true, key };
}

export async function upgradeApiKey(key, tier) {
  const tierConfig = API_TIERS[tier];
  if (!tierConfig) throw new Error(`Unknown tier: ${tier}`);
  const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await sql`
    UPDATE api_keys
    SET tier = ${tier}, daily_limit = ${tierConfig.calls}, status = 'active', expires_at = ${newExpiry}
    WHERE key = ${key}
  `;
  return { key, tier, daily_limit: tierConfig.calls, expires_at: newExpiry };
}