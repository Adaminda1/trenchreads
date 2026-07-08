// api/verify-payment.js
// Verifies a 5 USDC Solana payment via Helius and issues a pro key.

import { neon } from '@neondatabase/serverless';

const HELIUS_API_KEY  = process.env.HELIUS_API_KEY;
const RECEIVE_WALLET  = 'HNtyVRDXSsAWJbWVoZEgokFQKsXaFoqM9CiicWgRF2FR';
const USDC_MINT       = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const REQUIRED_USDC   = 5;

function generateProKey() {
  const chars  = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const random = Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `tr_${random}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { txSignature, email } = req.body || {};

  if (!txSignature) return res.status(400).json({ error: 'Transaction signature required.' });
  if (!email)       return res.status(400).json({ error: 'Email required for key delivery.' });

  const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);

  try {
    // ── 1. Check tx not already used ──────────────────────────────────────
    const dupCheck = await sql`SELECT id FROM api_keys WHERE tx_signature = ${txSignature} LIMIT 1`;
    if (dupCheck.length) {
      // If already used, return the existing key for that tx
      const existing = await sql`SELECT key FROM api_keys WHERE tx_signature = ${txSignature} LIMIT 1`;
      if (existing.length) return res.status(200).json({ key: existing[0].key, reused: true });
      return res.status(400).json({ error: 'Transaction already used.' });
    }

    // ── 2. Fetch transaction from Helius ───────────────────────────────────
    const heliusRes = await fetch(
      `https://api.helius.xyz/v0/transactions/?api-key=${HELIUS_API_KEY}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ transactions: [txSignature] }),
      }
    );

    if (!heliusRes.ok) {
      return res.status(502).json({ error: 'Failed to reach Helius API. Try again shortly.' });
    }

    const txData = await heliusRes.json();
    const tx     = txData?.[0];

    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found. It may still be confirming — wait 30 seconds and try again.' });
    }

    // ── 3. Check transaction did not fail ──────────────────────────────────
    if (tx.transactionError) {
      return res.status(400).json({ error: 'Transaction failed on-chain. No payment was made.' });
    }

    // ── 4. Find the USDC token transfer to our wallet ──────────────────────
    const tokenTransfers = tx.tokenTransfers || [];
    const usdcTransfer   = tokenTransfers.find(t =>
      t.mint === USDC_MINT &&
      t.toUserAccount === RECEIVE_WALLET &&
      t.tokenAmount >= REQUIRED_USDC * 0.99 // 1% tolerance
    );

    if (!usdcTransfer) {
      return res.status(400).json({
        error: `No USDC transfer of $${REQUIRED_USDC} found to TrenchReads wallet. Make sure you sent exactly ${REQUIRED_USDC} USDC on Solana mainnet.`,
      });
    }

    // ── 5. Generate and save pro key ───────────────────────────────────────
    const key = generateProKey();

    await sql`
      INSERT INTO api_keys (
        key, owner_email, tier, daily_limit,
        active, status, tx_signature
      ) VALUES (
        ${key}, ${email}, 'pro', 999999,
        TRUE, 'active', ${txSignature}
      )
    `;

    return res.status(200).json({
      key,
      message: 'Payment verified — Pro access activated!',
    });

  } catch (e) {
    console.error('[verify-payment] error:', e);
    return res.status(500).json({ error: 'Server error: ' + e.message });
  }
}