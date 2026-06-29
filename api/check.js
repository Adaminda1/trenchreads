import { setupDB, validateKey, checkFreeLimit } from './db.js';

// ── Chain detection ────────────────────────────────────────────────────────
function detectChain(address) {
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) return 'evm';
  return 'solana';
}

// ── DexScreener ────────────────────────────────────────────────────────────
async function fetchDex(address) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    const j = await r.json();
    // Pick the pair with highest liquidity for best data
    const pairs = j?.pairs || [];
    const pair = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    if (!pair) return null;

    const socials = {};
    if (pair.info?.socials) {
      for (const s of pair.info.socials) {
        if (s.type === 'twitter')  socials.twitter  = s.url;
        if (s.type === 'telegram') socials.telegram = s.url;
      }
    }
    if (pair.info?.websites?.[0]) socials.website = pair.info.websites[0].url;

    return {
      name:         pair.baseToken?.name,
      symbol:       pair.baseToken?.symbol,
      price:        pair.priceUsd,
      liquidity:    pair.liquidity?.usd      || 0,
      volume24h:    pair.volume?.h24         || 0,
      volume1h:     pair.volume?.h1          || 0,
      priceChange24h: pair.priceChange?.h24  || null,
      priceChange1h:  pair.priceChange?.h1   || null,
      txns24h:      { buys: pair.txns?.h24?.buys || 0, sells: pair.txns?.h24?.sells || 0 },
      txns1h:       { buys: pair.txns?.h1?.buys  || 0, sells: pair.txns?.h1?.sells  || 0 },
      marketCap:    pair.marketCap           || 0,
      fdv:          pair.fdv                 || 0,
      pairAddress:  pair.pairAddress,
      pairUrl:      pair.url,
      dexId:        pair.dexId,
      chainId:      pair.chainId,
      createdAt:    pair.pairCreatedAt,
      dexPaid:      !!(pair.boosts?.active),
      socials,
    };
  } catch { return null; }
}

// ── Solana security (Helius + GoPlus) ─────────────────────────────────────
async function secSol(address) {
  try {
    // GoPlus Solana
    const gp = await fetch(`https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`);
    const gpj = await gp.json();
    const sec = gpj?.result?.[address] || gpj?.result?.[address.toLowerCase()] || {};

    // Top holders — GoPlus returns holder_list for Solana
    const rawHolders = sec.holder_list || [];
    const topHolders = rawHolders.slice(0, 10).map(h => ({
      address: h.account,
      pct:     (parseFloat(h.percent || 0) * 100).toFixed(2),
      tag:     h.tag || null,
    }));

    const top10HolderPct = sec.top10_holder_ratio
      ? (parseFloat(sec.top10_holder_ratio) * 100).toFixed(1)
      : null;

    const creatorPct = sec.creator_percent
      ? (parseFloat(sec.creator_percent) * 100).toFixed(2)
      : null;

    return {
      mintAuthority:       sec.mint_authority      || null,
      freezeAuthority:     sec.freeze_authority    || null,
      isHoneypot:          sec.honeypot === '1',
      holderCount:         sec.holder_count        || null,
      top10HolderPct,
      topHolders,
      creatorPct,
      creatorAddress:      sec.creator_address     || null,
      isProxy:             sec.is_proxy            === '1',
      isMintable:          sec.is_mintable         === '1',
      canTakeBackOwnership: sec.can_take_back_ownership === '1',
      isOpenSource:        sec.is_open_source      === '1',
      isBlacklisted:       sec.is_blacklisted      === '1',
      buyTax:              sec.buy_tax             || '0',
      sellTax:             sec.sell_tax            || '0',
      transferPausable:    sec.transfer_pausable   === '1',
    };
  } catch { return {}; }
}

// ── EVM security (GoPlus) ──────────────────────────────────────────────────
async function secEVM(address) {
  try {
    // Try Ethereum chain first, fallback to BSC
    let sec = {};
    for (const chainId of ['1', '56', '137']) {
      const gp = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`);
      const gpj = await gp.json();
      const result = gpj?.result?.[address.toLowerCase()];
      if (result && Object.keys(result).length > 2) { sec = result; break; }
    }

    // Top holders
    const rawHolders = sec.holders || [];
    const topHolders = rawHolders.slice(0, 10).map(h => ({
      address: h.address,
      pct:     (parseFloat(h.percent || 0) * 100).toFixed(2),
      tag:     h.tag || null,
      isLocked: h.is_locked === 1,
    }));

    const top10HolderPct = sec.top10_holder_percent
      ? (parseFloat(sec.top10_holder_percent) * 100).toFixed(1)
      : null;

    const creatorPct = sec.creator_percent
      ? (parseFloat(sec.creator_percent) * 100).toFixed(2)
      : null;

    return {
      mintAuthority:       null,
      freezeAuthority:     null,
      isHoneypot:          sec.is_honeypot          === '1',
      holderCount:         sec.holder_count         || null,
      top10HolderPct,
      topHolders,
      creatorPct,
      creatorAddress:      sec.creator_address      || null,
      isProxy:             sec.is_proxy             === '1',
      isMintable:          sec.is_mintable          === '1',
      canTakeBackOwnership: sec.can_take_back_ownership === '1',
      isOpenSource:        sec.is_open_source       === '1',
      isBlacklisted:       sec.is_blacklisted       === '1',
      buyTax:              sec.buy_tax              || '0',
      sellTax:             sec.sell_tax             || '0',
      transferPausable:    sec.transfer_pausable    === '1',
      hiddenOwner:         sec.hidden_owner         === '1',
      selfDestruct:        sec.selfdestruct         === '1',
      externalCall:        sec.external_call        === '1',
      lpLocked:            sec.lp_holder_analysis?.some(lp => lp.is_locked === 1) || false,
      lpLockedPct:         sec.lp_holder_analysis?.find(lp => lp.is_locked === 1)?.percent || null,
    };
  } catch { return {}; }
}

// ── Score engine ───────────────────────────────────────────────────────────
export function calculateScore({ dex: d, sec: s }) {
  let score = 100;
  const bd  = [];

  // ── CRITICAL DEDUCTIONS ──
  if (s?.isHoneypot) {
    score -= 40; bd.push({ l: 'Honeypot Detected', p: -40 });
  }
  if (s?.isMintable || (s?.mintAuthority && s.mintAuthority !== 'null' && s.mintAuthority !== null)) {
    score -= 20; bd.push({ l: 'Mintable Supply', p: -20 });
  }
  if (s?.freezeAuthority && s.freezeAuthority !== 'null' && s.freezeAuthority !== null) {
    score -= 10; bd.push({ l: 'Freeze Authority Active', p: -10 });
  }
  if (s?.canTakeBackOwnership || s?.hiddenOwner) {
    score -= 15; bd.push({ l: 'Owner Control Risk', p: -15 });
  }
  if (s?.transferPausable) {
    score -= 10; bd.push({ l: 'Transfers Pausable', p: -10 });
  }
  if (s?.isBlacklisted) {
    score -= 8; bd.push({ l: 'Blacklist Function', p: -8 });
  }
  if (s?.selfDestruct) {
    score -= 10; bd.push({ l: 'Self-Destruct Function', p: -10 });
  }

  // ── LIQUIDITY & MARKET ──
  const liq  = parseFloat(d?.liquidity)  || 0;
  const mcap = parseFloat(d?.marketCap)  || 0;
  const vol  = parseFloat(d?.volume24h)  || 0;

  if (liq === 0) {
    score -= 30; bd.push({ l: 'No Liquidity', p: -30 });
  } else if (liq < 2000) {
    score -= 20; bd.push({ l: `Critical Low Liq $${fmt(liq)}`, p: -20 });
  } else if (liq < 10000) {
    score -= 10; bd.push({ l: `Low Liquidity $${fmt(liq)}`, p: -10 });
  }

  // Liq/MCap ratio — THE key rug signal
  if (liq > 0 && mcap > 0) {
    const rugRatio = (liq / mcap) * 100;
    if (rugRatio < 0.5) {
      score -= 25; bd.push({ l: `Rug Exit Risk ${rugRatio.toFixed(2)}% Liq/MCap`, p: -25 });
    } else if (rugRatio < 1) {
      score -= 18; bd.push({ l: `Very Low Liq/MCap ${rugRatio.toFixed(2)}%`, p: -18 });
    } else if (rugRatio < 3) {
      score -= 10; bd.push({ l: `Low Rug Buffer ${rugRatio.toFixed(1)}% Liq/MCap`, p: -10 });
    }
  }

  // Volume dead
  const buys  = d?.txns24h?.buys  || 0;
  const sells = d?.txns24h?.sells || 0;
  if (buys === 0 && sells === 0 && liq > 0) {
    score -= 20; bd.push({ l: 'Dead Token — Zero Activity', p: -20 });
  } else if (vol < 500 && liq > 0) {
    score -= 8; bd.push({ l: 'Very Low Volume', p: -8 });
  }

  // Sell pressure
  if (buys > 0 && sells > 0) {
    const ratio = sells / (buys + sells);
    if (ratio > 0.8)      { score -= 10; bd.push({ l: 'Extreme Sell Pressure', p: -10 }); }
    else if (ratio > 0.65){ score -= 5;  bd.push({ l: 'Heavy Sell Pressure', p: -5 }); }
  }

  // ── TAX ──
  const bt = parseFloat(s?.buyTax)  || 0;
  const st = parseFloat(s?.sellTax) || 0;
  if (st > 10) { score -= 15; bd.push({ l: `High Sell Tax ${st}%`, p: -15 }); }
  else if (st > 5) { score -= 5; bd.push({ l: `Elevated Sell Tax ${st}%`, p: -5 }); }
  if (bt > 10) { score -= 8; bd.push({ l: `High Buy Tax ${bt}%`, p: -8 }); }

  // ── HOLDERS ──
  const top10 = s?.top10HolderPct ? parseFloat(s.top10HolderPct) : null;
  const creatorPct = s?.creatorPct ? parseFloat(s.creatorPct) : null;

  if (top10 !== null) {
    if (top10 > 80)      { score -= 15; bd.push({ l: `Top 10 Hold ${top10}%`, p: -15 }); }
    else if (top10 > 60) { score -= 10; bd.push({ l: `Top 10 Hold ${top10}%`, p: -10 }); }
    else if (top10 > 40) { score -= 5;  bd.push({ l: `Top 10 Hold ${top10}%`, p: -5  }); }
  }
  if (creatorPct !== null) {
    if (creatorPct > 10) { score -= 10; bd.push({ l: `Dev Holds ${creatorPct}%`, p: -10 }); }
    else if (creatorPct > 5) { score -= 5; bd.push({ l: `Dev Holds ${creatorPct}%`, p: -5 }); }
  }

  // ── AGE ──
  if (d?.createdAt) {
    const ageHours = (Date.now() - d.createdAt) / 3600000;
    if (ageHours < 1)       { score -= 10; bd.push({ l: `Brand New <1h old`, p: -10 }); }
    else if (ageHours < 24) { score -= 5;  bd.push({ l: `New Token ${Math.floor(ageHours)}h old`, p: -5 }); }
  }

  // ── BONUSES ──
  if (s?.isOpenSource)                        { score += 3;  bd.push({ l: 'Open Source Verified', p: +3 }); }
  if (liq > 100000)                           { score += 5;  bd.push({ l: 'Strong Liquidity', p: +5 }); }
  if (top10 !== null && top10 < 30)           { score += 5;  bd.push({ l: 'Well Distributed Supply', p: +5 }); }
  if (d?.createdAt && (Date.now() - d.createdAt) > 30 * 86400000) {
    score += 3; bd.push({ l: 'Established Token >30d', p: +3 });
  }
  if ((s?.lpLocked || s?.lpLockedPct) && !s?.isHoneypot) {
    score += 5; bd.push({ l: 'Liquidity Locked', p: +5 });
  }

  // ── MISSING DATA CAP ──
  // If we couldn't get critical security data, don't let it score too high
  const missingCritical = s?.isHoneypot === undefined || s?.isMintable === undefined;
  if (missingCritical && score > 80) score = 80;

  const finalScore = Math.max(0, Math.min(95, Math.round(score)));

  let verdict, cls;
  if (finalScore >= 70)      { verdict = 'RELATIVELY SAFE';      cls = 'safe';   }
  else if (finalScore >= 45) { verdict = 'PROCEED WITH CAUTION'; cls = 'warn';   }
  else                       { verdict = 'HIGH RISK – AVOID';     cls = 'danger'; }

  return { score: finalScore, verdict, cls, breakdown: bd };
}

// ── AI verdict (Groq) ──────────────────────────────────────────────────────
async function aiVerdict(d, s, scoreData) {
  if (!process.env.GROQ_API_KEY) return null;
  try {
    const liq  = d?.liquidity  || 0;
    const mcap = d?.marketCap  || 0;
    const rugRatio = liq > 0 && mcap > 0 ? ((liq / mcap) * 100).toFixed(2) : 'unknown';

    const prompt = `You are a brutal, honest DeFi security analyst on Crypto Twitter. Analyse this token and give a 2-sentence verdict. Be specific, data-driven, and direct. No hype. No filler.

Token: ${d?.name || 'Unknown'} (${d?.symbol || '?'})
Score: ${scoreData.score}/100 — ${scoreData.verdict}
Price: $${d?.price || 'N/A'} | MCap: $${fmt(mcap)} | Liquidity: $${fmt(liq)}
Liq/MCap: ${rugRatio}% | 24h Volume: $${fmt(d?.volume24h || 0)}
Buys/Sells 24h: ${d?.txns24h?.buys || 0} / ${d?.txns24h?.sells || 0}
Holders: ${s?.holderCount || 'N/A'} | Top 10 hold: ${s?.top10HolderPct || 'N/A'}%
Dev wallet: ${s?.creatorPct || 'N/A'}%
Honeypot: ${s?.isHoneypot ? 'YES ⚠' : 'No'} | Mintable: ${s?.isMintable ? 'YES ⚠' : 'No'}
Freeze Auth: ${s?.freezeAuthority ? 'ACTIVE ⚠' : 'Revoked'} | Blacklist: ${s?.isBlacklisted ? 'YES ⚠' : 'No'}
Transfer Pausable: ${s?.transferPausable ? 'YES ⚠' : 'No'} | Open Source: ${s?.isOpenSource ? 'Yes' : 'No'}
Buy Tax: ${s?.buyTax || 0}% | Sell Tax: ${s?.sellTax || 0}%
Key flags: ${scoreData.breakdown.filter(b => b.p < 0).map(b => b.l).join(', ') || 'none'}

Write 2 sentences max. Start with the biggest risk or green flag. End with a clear buy/avoid signal.`;

    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
        temperature: 0.4,
      }),
    });
    const j = await r.json();
    return j?.choices?.[0]?.message?.content?.trim() || null;
  } catch { return null; }
}

// ── Helper ─────────────────────────────────────────────────────────────────
function fmt(n) {
  if (!n || isNaN(n)) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Number(n).toFixed(2);
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end();

  const { ca, address: addr2, apiKey, proKey } = req.body || {};
  const key     = apiKey || proKey;
  const address = ca || addr2;

  if (!address) return res.status(400).json({ error: 'CA_required' });

  await setupDB();

  // ── Auth ──
  if (key && key.startsWith('tr_')) {
    const keyRow = await validateKey(key);
    if (!keyRow) return res.status(401).json({ error: 'Invalid or expired Pro key.' });
  } else {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
              || req.socket?.remoteAddress
              || 'unknown';
    const freeCheck = await checkFreeLimit(ip);
    if (!freeCheck.allowed) {
      return res.status(429).json({
        error: 'free_limit_reached',
        message: 'Free limit reached — 3/3 checks used today. Upgrade to Pro for unlimited checks.',
      });
    }
  }

  try {
    const chain = detectChain(address);
    const [d, s] = await Promise.all([
      fetchDex(address),
      chain === 'solana' ? secSol(address) : secEVM(address),
    ]);

    const scoreData = calculateScore({ dex: d, sec: s });
    const ai        = await aiVerdict(d, s, scoreData);

    return res.status(200).json({
      ca:        address,
      chain,
      dex:       d,
      sec:       s,
      score:     scoreData.score,
      verdict:   scoreData.verdict,
      cls:       scoreData.cls,
      breakdown: scoreData.breakdown,
      ai,
    });
  } catch (e) {
    console.error('check error:', e);
    return res.status(500).json({ error: e.message });
  }
}