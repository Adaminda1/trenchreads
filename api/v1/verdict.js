/**
 * TrenchReads B2B Verdict API
 * POST /api/v1/verdict
 *
 * Request body:
 *   { address: string, api_key: string }
 *   OR pass api_key via X-API-Key header
 *
 * Response:
 *   { score, risk_level, verdict, flags, liq_mcap_ratio, chain, ai, timestamp, usage }
 */

import { withApiKeyAuth } from '../../lib/api-usage.js';
import { runVerdict } from '../../lib/scoring-engine.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' });

  // ── Auth ──
  const auth = await withApiKeyAuth(req);
  if (!auth.allowed) {
    return res.status(auth.status).json({
      error:       auth.error,
      calls_today: auth.calls_today  || undefined,
      daily_limit: auth.daily_limit  || undefined,
      tier:        auth.tier         || undefined,
      docs:        'https://trenchreads.vercel.app/api-docs',
    });
  }

  const { address } = req.body || {};
  if (!address) {
    return res.status(400).json({ error: 'address is required', docs: 'https://trenchreads.vercel.app/api-docs' });
  }

  // Basic address validation
  const isSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  const isEVM    = /^0x[a-fA-F0-9]{40}$/i.test(address);
  if (!isSolana && !isEVM) {
    return res.status(400).json({ error: 'Invalid address. Must be a Solana base58 or EVM 0x address.' });
  }

  try {
    const result = await runVerdict(address);

    // Shape the public API response — clean, no internal fields
    const flags = result.breakdown
      .filter(b => b.p < 0)
      .map(b => b.l);

    const positives = result.breakdown
      .filter(b => b.p > 0)
      .map(b => b.l);

    return res.status(200).json({
      // Core verdict
      score:          result.score,
      risk_level:     result.risk_level,       // LOW | MEDIUM | HIGH
      verdict:        result.verdict,
      ai_verdict:     result.ai,

      // Key signals
      flags,
      positives,
      liq_mcap_ratio: result.liq_mcap_ratio ? parseFloat(result.liq_mcap_ratio) : null,

      // Token info
      token: {
        name:     result.dex?.name    || null,
        symbol:   result.dex?.symbol  || null,
        price:    result.dex?.price   || null,
        liquidity: result.dex?.liquidity || 0,
        market_cap: result.dex?.marketCap || 0,
        volume_24h: result.dex?.volume24h || 0,
        holders:   result.sec?.holderCount || null,
        age_days:  result.dex?.createdAt
          ? Math.floor((Date.now() - result.dex.createdAt) / 86400000)
          : null,
      },

      // Security
      security: {
        honeypot:          result.sec?.isHoneypot     || false,
        mint_revoked:      !result.sec?.mintAuthority,
        freeze_disabled:   !result.sec?.freezeAuthority,
        open_source:       result.sec?.isOpenSource   || false,
        transfer_pausable: result.sec?.transferPausable || false,
        blacklist_fn:      result.sec?.isBlacklisted  || false,
        sell_tax:          result.sec?.sellTax         || '0',
        buy_tax:           result.sec?.buyTax          || '0',
        top10_holder_pct:  result.sec?.top10HolderPct  || null,
      },

      // Meta
      chain:     result.chain,
      address,
      timestamp: result.timestamp,

      // Usage info
      usage: {
        calls_today: auth.keyRow.calls_today,
        daily_limit: auth.daily_limit,
        remaining:   auth.remaining,
        tier:        auth.tier,
      },
    });
  } catch (e) {
    console.error('[v1/verdict] error:', e);
    return res.status(500).json({ error: 'Scoring engine error: ' + e.message });
  }
}