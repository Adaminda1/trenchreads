/**
 * POST /api/v1/billing/renew
 * Body: { key: "tr_api_xxx", txSignature: "solana_tx_sig" }
 *
 * Verifies a USDC payment on-chain and extends the API key subscription 30 days.
 * Same wallet as Pro key: HNtyVRDXSsAWJbWVoZEgokFQKsXaFoqM9CiicWgRF2FR
 */

import { renewApiKey, API_TIERS } from '../../lib/api-usage.js';

const RECEIVE_WALLET = 'HNtyVRDXSsAWJbWVoZEgokFQKsXaFoqM9CiicWgRF2FR';
const USDC_MINT      = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Expected USDC amounts per tier (in USDC, 6 decimals)
const TIER_PRICES = {
  builder: 29,
  growth:  79,
  scale:   199,
};

async function verifyUsdcTx(txSignature, expectedAmount) {
  try {
    const r = await fetch(
      `https://api.helius.xyz/v0/transactions/?api-key=${process.env.HELIUS_API_KEY}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ transactions: [txSignature] }),
      }
    );
    const txs = await r.json();
    const tx  = txs?.[0];
    if (!tx) return { valid: false, error: 'Transaction not found.' };

    // Check token transfers
    const transfer = tx.tokenTransfers?.find(t =>
      t.mint === USDC_MINT &&
      t.toUserAccount === RECEIVE_WALLET &&
      t.tokenAmount >= expectedAmount * 0.99 // allow 1% tolerance
    );

    if (!transfer) return { valid: false, error: `No USDC transfer of ~$${expectedAmount} to TrenchReads wallet found.` };
    return { valid: true, amount: transfer.tokenAmount };
  } catch (e) {
    return { valid: false, error: 'Could not verify transaction: ' + e.message };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' });

  const { key, txSignature } = req.body || {};

  if (!key)          return res.status(400).json({ error: 'key is required' });
  if (!txSignature)  return res.status(400).json({ error: 'txSignature is required' });
  if (!key.startsWith('tr_api_')) return res.status(400).json({ error: 'Must be a B2B API key (tr_api_...)' });

  try {
    // Get key info to know tier and expected price
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
    const rows = await sql`SELECT * FROM api_keys WHERE key = ${key} LIMIT 1`;

    if (!rows.length) return res.status(404).json({ error: 'API key not found.' });

    const keyRow = rows[0];
    const tier   = keyRow.tier;

    if (tier === 'free') {
      return res.status(400).json({ error: 'Free tier does not require payment. Upgrade your tier first — DM @Web3Abdull' });
    }

    const expectedAmount = TIER_PRICES[tier];
    if (!expectedAmount) {
      return res.status(400).json({ error: `Unknown tier: ${tier}` });
    }

    // Verify payment on-chain
    const verification = await verifyUsdcTx(txSignature, expectedAmount);
    if (!verification.valid) {
      return res.status(402).json({
        error:    verification.error,
        expected: `$${expectedAmount} USDC to ${RECEIVE_WALLET}`,
        tier,
      });
    }

    // Extend subscription
    const result = await renewApiKey(key, txSignature);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.status(200).json({
      success:    true,
      message:    `${tier} plan renewed for 30 days`,
      key,
      tier,
      expires_at: result.expires_at,
      paid:       `$${expectedAmount} USDC`,
      next_renewal: result.expires_at,
    });

  } catch (e) {
    console.error('[billing/renew] error:', e);
    return res.status(500).json({ error: e.message });
  }
}