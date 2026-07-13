#!/usr/bin/env node
/**
 * Mint a single free-tier (50 calls/day) B2B API key for one person.
 *
 * Usage:
 *   node scripts/mint-free-key.mjs "@telegram_handle"
 *   node scripts/mint-free-key.mjs "someone@email.com" "Jane Doe"
 *
 * Requires DATABASE_URL (or POSTGRES_URL) in the environment — same
 * connection string used by db.js / Vercel.
 *
 * Uses owner_email / owner_name / active — the columns your live
 * verify-payment.js flow actually writes to, not the stale schema
 * in db.js's CREATE TABLE.
 */

import { neon } from '@neondatabase/serverless';

const identifier = process.argv[2];
const name       = process.argv[3] || null;

if (!identifier) {
  console.error('Usage: node scripts/mint-free-key.mjs "<telegram handle or email>" ["display name"]');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);

function generateKey() {
  const chars  = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const random = Array.from({ length: 24 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `tr_api_${random}`;
}

async function main() {
  const key = generateKey();

  // Guard against a freak collision
  const dup = await sql`SELECT id FROM api_keys WHERE key = ${key} LIMIT 1`;
  if (dup.length) {
    console.error('Key collision, run again.');
    process.exit(1);
  }

  await sql`
    INSERT INTO api_keys (
      key, owner_email, owner_name, tier, daily_limit,
      active, status, expires_at
    ) VALUES (
      ${key}, ${identifier}, ${name}, 'free', 50,
      TRUE, 'active', NULL
    )
  `;

  console.log('✅ Free key minted');
  console.log('   Key:       ', key);
  console.log('   Issued to: ', identifier);
  console.log('   Tier:      free (50 calls/day, no expiry)');
}

main().catch(e => {
  console.error('Failed to mint key:', e.message);
  process.exit(1);
});