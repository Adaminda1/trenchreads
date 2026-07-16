/**
 * Token History — remembers the highest market cap TrenchReads has ever
 * recorded for a given token, across all scans (web, bot, API).
 *
 * Why this exists: DexScreener's priceChange24h is a ROLLING window. If a
 * token crashed yesterday and has been flat since, today's 24h window shows
 * almost no movement — even though the token is still sitting at a fraction
 * of what it used to be worth. A single-scan snapshot can't catch that.
 *
 * This module gives calculateScore() something to compare against: not
 * "did it move a lot in the last 24h" but "is it down big from the highest
 * point WE have ever actually seen for this specific token."
 */

import { neon } from '@neondatabase/serverless';

function db() {
  return neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
}

export async function setupTokenHistory() {
  const sql = db();
  await sql`
    CREATE TABLE IF NOT EXISTS token_history (
      address         TEXT PRIMARY KEY,
      chain           TEXT,
      ath_mcap        NUMERIC,
      ath_mcap_at     TIMESTAMP,
      ath_liquidity   NUMERIC,
      first_seen_at   TIMESTAMP DEFAULT NOW(),
      last_scanned_at TIMESTAMP DEFAULT NOW(),
      last_mcap       NUMERIC
    )
  `;
}

/**
 * Records this scan and returns the token's all-time-high mcap as TrenchReads
 * has observed it. Call this BEFORE calculateScore() so the ATH can be passed
 * in and used as a hard-cap signal.
 */
export async function getAndUpdateTokenHistory(address, chain, currentMcap) {
  if (!currentMcap || currentMcap <= 0) return null;

  const sql = db();
  const existing = await sql`SELECT * FROM token_history WHERE address = ${address}`;

  if (!existing.length) {
    // First time we've ever scanned this token — it becomes its own baseline.
    // Nothing to compare against yet, so no crash penalty on a first scan.
    await sql`
      INSERT INTO token_history (address, chain, ath_mcap, ath_mcap_at, last_scanned_at, last_mcap)
      VALUES (${address}, ${chain}, ${currentMcap}, NOW(), NOW(), ${currentMcap})
    `;
    return { athMcap: currentMcap, isFirstScan: true };
  }

  const row      = existing[0];
  const priorAth = parseFloat(row.ath_mcap) || 0;

  if (currentMcap > priorAth) {
    // New high — update the recorded ATH
    await sql`
      UPDATE token_history
      SET ath_mcap = ${currentMcap}, ath_mcap_at = NOW(), last_scanned_at = NOW(), last_mcap = ${currentMcap}
      WHERE address = ${address}
    `;
    return { athMcap: currentMcap, isFirstScan: false };
  }

  // Not a new high — keep the recorded ATH, just log this scan happened
  await sql`
    UPDATE token_history
    SET last_scanned_at = NOW(), last_mcap = ${currentMcap}
    WHERE address = ${address}
  `;
  return { athMcap: priorAth, isFirstScan: false };
}