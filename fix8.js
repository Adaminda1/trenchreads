const fs = require('fs');

// Create api/db.mjs — database setup
fs.writeFileSync('api/db.mjs', `
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

export async function setupDB() {
  await sql\`
    CREATE TABLE IF NOT EXISTS api_keys (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      email TEXT,
      plan TEXT DEFAULT 'monthly',
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP
    )
  \`;
  await sql\`
    CREATE TABLE IF NOT EXISTS free_usage (
      ip TEXT PRIMARY KEY,
      count INTEGER DEFAULT 0,
      date TEXT
    )
  \`;
}

export async function validateKey(key) {
  if (!key) return null;
  const rows = await sql\`
    SELECT * FROM api_keys 
    WHERE key = \${key} 
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > NOW())
  \`;
  return rows[0] || null;
}

export async function checkFreeLimit(ip) {
  const today = new Date().toISOString().split('T')[0];
  const rows = await sql\`
    SELECT * FROM free_usage WHERE ip = \${ip}
  \`;
  if (!rows[0] || rows[0].date !== today) {
    await sql\`
      INSERT INTO free_usage (ip, count, date)
      VALUES (\${ip}, 1, \${today})
      ON CONFLICT (ip) DO UPDATE SET count = 1, date = \${today}
    \`;
    return { allowed: true, remaining: 2 };
  }
  if (rows[0].count >= 3) {
    return { allowed: false, remaining: 0 };
  }
  await sql\`
    UPDATE free_usage SET count = count + 1 WHERE ip = \${ip}
  \`;
  return { allowed: true, remaining: 3 - rows[0].count - 1 };
}

export async function createKey(email, plan) {
  const key = 'tr_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const expiresAt = plan === 'yearly' 
    ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await sql\`
    INSERT INTO api_keys (key, email, plan, expires_at)
    VALUES (\${key}, \${email}, \${plan}, \${expiresAt})
  \`;
  return key;
}
`);

console.log('api/db.mjs created');

// Create api/activate.mjs — generates key after payment
fs.writeFileSync('api/activate.mjs', `
import { setupDB, createKey } from './db.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    await setupDB();
    const { email, plan, secret } = req.body || {};
    
    // Verify secret to prevent abuse
    if (secret !== process.env.ACTIVATE_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    
    if (!email || !plan) {
      return res.status(400).json({ error: 'email and plan required' });
    }
    
    const key = await createKey(email, plan);
    return res.status(200).json({ key, plan, email });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
`);

console.log('api/activate.mjs created');

// Update api/check.mjs to enforce free tier limits
let c = fs.readFileSync('api/check.mjs', 'utf8');

// Add imports at top
c = c.replace(
  'export default async function handler(req, res) {',
  `import { setupDB, validateKey, checkFreeLimit } from './db.mjs';

export default async function handler(req, res) {`
);

// Add tier check after address validation
c = c.replace(
  "if (!address || address === 'test') return res.status(200).json({ status: 'ok' });",
  `if (!address || address === 'test') return res.status(200).json({ status: 'ok' });

  // Check tier
  await setupDB();
  const apiKey = req.headers['x-api-key'] || req.body?.apiKey;
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  
  let isPaid = false;
  if (apiKey) {
    const keyData = await validateKey(apiKey);
    isPaid = !!keyData;
  }
  
  if (!isPaid) {
    const limit = await checkFreeLimit(ip);
    if (!limit.allowed) {
      return res.status(429).json({ 
        error: 'free_limit_reached',
        message: 'You have used your 3 free checks today. Upgrade to TrenchReads Pro for unlimited access.',
        upgradeUrl: 'https://trenchreads.vercel.app/#upgrade'
      });
    }
  }`
);

// Add tier info to response
c = c.replace(
  'res.status(200).json({dex:d, sec:s, chain, ai, score, smartWallets});',
  'res.status(200).json({dex:d, sec:s, chain, ai, score, smartWallets, isPaid});'
);

fs.writeFileSync('api/check.mjs', c);
console.log('api/check.mjs updated');
console.log('All done');