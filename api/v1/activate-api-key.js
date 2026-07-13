/**
 * POST /api/v1/activate-api-key
 * Body: { txSignature, email, name, tier }
 * Verifies USDC payment and creates a new tr_api_ key
 */

import { neon } from '@neondatabase/serverless';

const RECEIVE_WALLET = 'HNtyVRDXSsAWJbWVoZEgokFQKsXaFoqM9CiicWgRF2FR';
const USDC_MINT      = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const TIER_PRICES = { free: 0, builder: 29, growth: 79, scale: 199 };
const TIER_LIMITS = { free: 50, builder: 2000, growth: 10000, scale: 50000 };

function generateApiKey() {
  const chars  = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const random = Array.from({ length: 24 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `tr_api_${random}`;
}

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
    if (!tx) return { valid: false, error: 'Transaction not found. Wait 30 seconds and try again.' };

    const transfer = tx.tokenTransfers?.find(t =>
      t.mint === USDC_MINT &&
      t.toUserAccount === RECEIVE_WALLET &&
      t.tokenAmount >= expectedAmount * 0.99
    );

    if (!transfer) return { valid: false, error: `No USDC transfer of ~$${expectedAmount} found to TrenchReads wallet.` };
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

  const { txSignature, email, name, tier = 'builder' } = req.body || {};

  if (!txSignature) return res.status(400).json({ error: 'Transaction signature required.' });
  if (!email)       return res.status(400).json({ error: 'Email required for key delivery.' });

  const expectedAmount = TIER_PRICES[tier];
  if (expectedAmount === undefined) return res.status(400).json({ error: 'Invalid tier.' });
  if (tier === 'free') return res.status(400).json({ error: 'Free tier does not require payment.' });

  try {
    const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);

    // Check tx not already used
    const dupCheck = await sql`SELECT id FROM api_keys WHERE tx_signature = ${txSignature} LIMIT 1`;
    if (dupCheck.length) return res.status(400).json({ error: 'Transaction already used.' });

    // Verify payment
    const verification = await verifyUsdcTx(txSignature, expectedAmount);
    if (!verification.valid) return res.status(402).json({ error: verification.error });

    // Generate key
    const key       = generateApiKey();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const limit     = TIER_LIMITS[tier];

    await sql`
      INSERT INTO api_keys (
        key, owner_email, owner_name, tier, daily_limit,
        active, status, expires_at, tx_signature, renewed_at
      ) VALUES (
        ${key}, ${email}, ${name || null}, ${tier}, ${limit},
        TRUE, 'active', ${expiresAt}, ${txSignature}, NOW()
      )
    `;

    return res.status(200).json({
      key,
      tier,
      daily_limit: limit,
      expires_at:  expiresAt,
      message:     `${tier} API key activated — valid for 30 days`,
    });

  } catch (e) {
    console.error('[activate-api-key] error:', e);
    return res.status(500).json({ error: e.message });
  }
}