#!/usr/bin/env node
/**
 * Free test for the B2B paid-tier key INSERT — no real payment needed.
 *
 * This runs the EXACT same INSERT statement that api/v1/activate-api-key.js
 * uses after payment is verified, so you can confirm the fixed column names
 * (owner_email, active, status, etc.) actually work against your live Neon
 * table — then deletes the test row so nothing fake stays in your database.
 *
 * Usage:
 *   DATABASE_URL="your-neon-connection-string" node scripts/test-b2b-insert.mjs
 */

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);

function generateKey() {
  const chars  = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const random = Array.from({ length: 24 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `tr_api_TEST_${random}`;
}

async function main() {
  const key         = generateKey();
  const expiresAt   = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const fakeTx      = 'TEST_' + Date.now();

  console.log('Attempting INSERT with the fixed column set...');

  try {
    await sql`
      INSERT INTO api_keys (
        key, owner_email, owner_name, tier, daily_limit,
        active, status, expires_at, tx_signature, renewed_at
      ) VALUES (
        ${key}, 'test@example.com', 'Test Insert', 'builder', 2000,
        TRUE, 'active', ${expiresAt}, ${fakeTx}, NOW()
      )
    `;
    console.log('✅ INSERT succeeded — the column fix works against your live schema.');

    const rows = await sql`SELECT * FROM api_keys WHERE key = ${key}`;
    console.log('   Row saved as:', rows[0]);

  } catch (e) {
    console.error('❌ INSERT failed:', e.message);
    console.error('   This tells us the exact column that\'s still wrong — read the error above.');
    process.exit(1);
  } finally {
    // Clean up the test row either way
    await sql`DELETE FROM api_keys WHERE key = ${key}`;
    console.log('🧹 Test row deleted — nothing fake left in your database.');
  }
}

main().catch(e => {
  console.error('Script error:', e.message);
  process.exit(1);
});