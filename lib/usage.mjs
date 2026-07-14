#!/usr/bin/env node
/**
 * Show usage for all free-tier keys, so you can spot abuse.
 *
 * Usage:
 *   DATABASE_URL="your-neon-connection-string" node scripts/check-usage.mjs
 *
 * "Abuse" here means: someone consistently hitting their daily_limit
 * (50/50 used) day after day — a normal person occasionally checking
 * a token or two won't get anywhere near that.
 */

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);

async function main() {
  const rows = await sql`
    SELECT key, owner_email, owner_name, tier, daily_limit,
           calls_today, total_calls, last_reset, active, status, created_at
    FROM api_keys
    WHERE tier = 'free'
    ORDER BY calls_today DESC, total_calls DESC
  `;

  if (!rows.length) {
    console.log('No free-tier keys found.');
    return;
  }

  console.log(`\nFound ${rows.length} free-tier key(s):\n`);

  for (const r of rows) {
    const pctUsed = r.daily_limit ? Math.round((r.calls_today / r.daily_limit) * 100) : 0;
    const flag = pctUsed >= 90 ? ' 🚨 NEAR/AT LIMIT TODAY' : pctUsed >= 60 ? ' ⚠️  heavy use today' : '';

    console.log(`Key:         ${r.key}`);
    console.log(`Issued to:   ${r.owner_email || '(none)'}${r.owner_name ? ' — ' + r.owner_name : ''}`);
    console.log(`Today:       ${r.calls_today}/${r.daily_limit} (${pctUsed}%)${flag}`);
    console.log(`Total ever:  ${r.total_calls}`);
    console.log(`Status:      ${r.status}${r.active ? '' : ' (inactive)'}`);
    console.log(`Minted:      ${new Date(r.created_at).toLocaleDateString()}`);
    console.log('---');
  }
}

main().catch(e => {
  console.error('Failed to fetch usage:', e.message);
  process.exit(1);
});