
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

export async function setupDB() {
  await sql`
    CREATE TABLE IF NOT EXISTS api_keys (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      email TEXT,
      plan TEXT DEFAULT 'monthly',
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
}

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

export async function checkFreeLimit(ip) {
  const today = new Date().toISOString().split('T')[0];
  const rows = await sql`
    SELECT * FROM free_usage WHERE ip = ${ip}
  `;
  if (!rows[0] || rows[0].date !== today) {
    await sql`
      INSERT INTO free_usage (ip, count, date)
      VALUES (${ip}, 1, ${today})
      ON CONFLICT (ip) DO UPDATE SET count = 1, date = ${today}
    `;
    return { allowed: true, remaining: 2 };
  }
  if (rows[0].count >= 3) {
    return { allowed: false, remaining: 0 };
  }
  await sql`
    UPDATE free_usage SET count = count + 1 WHERE ip = ${ip}
  `;
  return { allowed: true, remaining: 3 - rows[0].count - 1 };
}

export async function createKey(email, plan) {
  const key = 'tr_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const expiresAt = plan === 'yearly' 
    ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await sql`
    INSERT INTO api_keys (key, email, plan, expires_at)
    VALUES (${key}, ${email}, ${plan}, ${expiresAt})
  `;
  return key;
}
