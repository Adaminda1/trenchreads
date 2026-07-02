import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

export async function setupDB() {
  // Existing tables
  await sql`
    CREATE TABLE IF NOT EXISTS api_keys (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      email TEXT,
      plan TEXT DEFAULT 'lifetime',
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS free_usage (
      ip TEXT PRIMARY KEY,
      count INTEGER DEFAULT 0,
      date TEXT
    )
  `;
  // NEW: Telegram pro users table
  await sql`
    CREATE TABLE IF NOT EXISTS telegram_users (
      id SERIAL PRIMARY KEY,
      chat_id TEXT UNIQUE NOT NULL,
      pro_key TEXT NOT NULL,
      email TEXT,
      activated_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (pro_key) REFERENCES api_keys(key) ON DELETE CASCADE
    )
  `;
  // Migration: add tx_signature to api_keys for replay protection
  await sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS tx_signature TEXT UNIQUE`;
  // NEW: Telegram free usage (separate from web — per chat_id)
  await sql`
    CREATE TABLE IF NOT EXISTS telegram_free_usage (
      chat_id TEXT PRIMARY KEY,
      count INTEGER DEFAULT 0,
      date TEXT
    )
  `;
}

// ── Key validation ─────────────────────────────────────────────────────────
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
  const rows = await sql`SELECT * FROM free_usage WHERE ip = ${ip}`;
  if (!rows[0] || rows[0].date !== today) {
    await sql`
      INSERT INTO free_usage (ip, count, date)
      VALUES (${ip}, 1, ${today})
      ON CONFLICT (ip) DO UPDATE SET count = 1, date = ${today}
    `;
    return { allowed: true, remaining: 2 };
  }
  if (rows[0].count >= 3) return { allowed: false, remaining: 0 };
  await sql`UPDATE free_usage SET count = count + 1 WHERE ip = ${ip}`;
  return { allowed: true, remaining: 3 - rows[0].count - 1 };
}

// ── Key creation ───────────────────────────────────────────────────────────
export async function createKey(email, plan = 'lifetime') {
  const key = 'tr_' + Math.random().toString(36).slice(2,10) + Math.random().toString(36).slice(2,10);
  // Lifetime = no expiry. Keep yearly/monthly for legacy.
  const expiresAt = plan === 'yearly'
    ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    : plan === 'monthly'
    ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    : null; // lifetime
  await sql`
    INSERT INTO api_keys (key, email, plan, expires_at)
    VALUES (${key}, ${email}, ${plan}, ${expiresAt})
  `;
  return key;
}

// ── Telegram: activate pro key for a chat_id ──────────────────────────────
export async function activateTelegramPro(chatId, proKey, email) {
  // Validate the key first
  const keyRow = await validateKey(proKey);
  if (!keyRow) return { success: false, error: 'Invalid or expired key.' };

  // Link chat_id to key
  await sql`
    INSERT INTO telegram_users (chat_id, pro_key, email)
    VALUES (${String(chatId)}, ${proKey}, ${email || keyRow.email})
    ON CONFLICT (chat_id) DO UPDATE SET pro_key = ${proKey}, activated_at = NOW()
  `;
  return { success: true, email: keyRow.email };
}

// ── Telegram: check if chat_id is pro ─────────────────────────────────────
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

// ── Telegram free usage (3 scans/day per chat_id) ─────────────────────────
export async function checkTelegramFreeLimit(chatId) {
  const today = new Date().toISOString().split('T')[0];
  const id    = String(chatId);
  const rows  = await sql`SELECT * FROM telegram_free_usage WHERE chat_id = ${id}`;

  if (!rows[0] || rows[0].date !== today) {
    await sql`
      INSERT INTO telegram_free_usage (chat_id, count, date)
      VALUES (${id}, 1, ${today})
      ON CONFLICT (chat_id) DO UPDATE SET count = 1, date = ${today}
    `;
    return { allowed: true, remaining: 2 };
  }
  if (rows[0].count >= 3) return { allowed: false, remaining: 0 };
  await sql`UPDATE telegram_free_usage SET count = count + 1 WHERE chat_id = ${id}`;
  return { allowed: true, remaining: 3 - rows[0].count - 1 };
}