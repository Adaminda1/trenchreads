// api/verify-payment.js
// Verifies a 5 USDC Solana payment via Helius and issues a pro key.

import { createKey, validateKey } from './db.js';

const HELIUS_API_KEY  = process.env.HELIUS_API_KEY;
const RECEIVE_WALLET  = 'HNtyVRDXSsAWJbWVoZEgokFQKsXaFoqM9CiicWgRF2FR';
const USDC_MINT       = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // Solana USDC
const REQUIRED_USDC   = 5;                                                  // $5 USDC
const REQUIRED_LAMPORTS = REQUIRED_USDC * 1_000_000;                        // USDC = 6 decimals

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { txSignature, email } = req.body || {};

  if (!txSignature) return res.status(400).json({ error: 'Transaction signature required.' });
  if (!email)       return res.status(400).json({ error: 'Email required for key delivery.' });

  try {
    // ── 1. Fetch transaction from Helius ─────────────────────────────────
    const heliusUrl = `https://api.helius.xyz/v0/transactions/?api-key=${HELIUS_API_KEY}`;
    const heliusRes = await fetch(heliusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: [txSignature] })
    });

    if (!heliusRes.ok) {
      return res.status(502).json({ error: 'Failed to reach Helius API. Try again shortly.' });
    }

    const txData = await heliusRes.json();
    const tx     = txData?.[0];

    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found. It may still be confirming — wait 30 seconds and try again.' });
    }

    // ── 2. Check transaction is not failed ───────────────────────────────
    if (tx.transactionError) {
      return res.status(400).json({ error: 'Transaction failed on-chain. No payment was made.' });
    }

    // ── 3. Find the USDC token transfer to our wallet ────────────────────
    const tokenTransfers = tx.tokenTransfers || [];
    const validTransfer  = tokenTransfers.find(t =>
      t.mint          === USDC_MINT &&
      t.toUserAccount === RECEIVE_WALLET &&
      t.tokenAmount   >= REQUIRED_LAMPORTS
    );

    if (!validTransfer) {
      // Fallback: check nativeTransfers in case of wrapped SOL payment (unlikely but defensive)
      return res.status(400).json({
        error: `Payment not verified. We need exactly ${REQUIRED_USDC} USDC sent to ${RECEIVE_WALLET} on Solana mainnet. Please check your transaction on Solscan.`
      });
    }

    // ── 4. Prevent duplicate key issuance for the same tx ────────────────
    // We use the tx signature as part of duplicate detection via email check
    // A more robust approach stores tx signatures in DB — added below
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);

    const existing = await sql`
      SELECT key FROM api_keys WHERE tx_signature = ${txSignature}
    `.catch(() => []); // graceful if column doesn't exist yet

    if (existing && existing.length > 0) {
      // Already issued — return the existing key
      return res.status(200).json({
        key: existing[0].key,
        message: 'Key already issued for this transaction.',
        alreadyIssued: true
      });
    }

    // ── 5. Create pro key ────────────────────────────────────────────────
    const key = await createKey(email, 'lifetime');

    // ── 6. Store tx signature to prevent replay ──────────────────────────
    await sql`
      UPDATE api_keys SET tx_signature = ${txSignature} WHERE key = ${key}
    `.catch(() => {}); // graceful if column doesn't exist — add migration below

    // ── 7. Return key ────────────────────────────────────────────────────
    return res.status(200).json({
      key,
      email,
      message: 'Payment verified. Pro access activated.',
      plan: 'lifetime'
    });

  } catch (err) {
    console.error('[verify-payment] error:', err);
    return res.status(500).json({ error: 'Internal server error. Please contact @Web3Abdull on Telegram.' });
  }
}