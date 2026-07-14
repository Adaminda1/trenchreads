/**
 * TrenchReads Scoring Engine — Brutally Honest Edition
 * Single source of truth for web, bot, and B2B API
 *
 * Philosophy: Score reflects CURRENT onchain state only.
 * A token that rugged should score low NOW, regardless of history.
 * Volatile tokens will have volatile scores — that's the point.
 */

// ── Chain detection ────────────────────────────────────────────────────────
export function detectChain(address) {
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) return 'evm';
  return 'solana';
}

// ── Format helper ──────────────────────────────────────────────────────────
export function fmt(n) {
  if (!n || isNaN(n)) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Number(n).toFixed(2);
}

// ── Holder helper ──────────────────────────────────────────────────────────
// Fallback when GoPlus doesn't return an aggregate top10_holder_ratio/percent
// field directly — sum the individual holder percentages we already parsed.
function sumTop10Pct(topHolders) {
  const sum = topHolders.reduce((acc, h) => {
    const pct = parseFloat(h.pct);
    return acc + (isNaN(pct) ? 0 : pct);
  }, 0);
  return sum > 0 ? sum.toFixed(1) : null;
}

// ── DexScreener ────────────────────────────────────────────────────────────
export async function fetchDex(address) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    const j = await r.json();
    const pairs = j?.pairs || [];
    const pair  = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
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
      name:           pair.baseToken?.name,
      symbol:         pair.baseToken?.symbol,
      price:          pair.priceUsd,
      liquidity:      pair.liquidity?.usd      || 0,
      volume24h:      pair.volume?.h24         || 0,
      volume1h:       pair.volume?.h1          || 0,
      priceChange24h: pair.priceChange?.h24    || null,
      priceChange1h:  pair.priceChange?.h1     || null,
      txns24h:        { buys: pair.txns?.h24?.buys || 0, sells: pair.txns?.h24?.sells || 0 },
      txns1h:         { buys: pair.txns?.h1?.buys  || 0, sells: pair.txns?.h1?.sells  || 0 },
      marketCap:      pair.marketCap           || 0,
      fdv:            pair.fdv                 || 0,
      pairAddress:    pair.pairAddress,
      pairUrl:        pair.url,
      dexId:          pair.dexId,
      chainId:        pair.chainId,
      createdAt:      pair.pairCreatedAt,
      dexPaid:        !!(pair.boosts?.active),
      socials,
      // LP lock — DexScreener shows lock icon when liquidity is locked
      lpLocked:       !!(pair.liquidity?.locked),
      lpLockedPct:    pair.liquidity?.lockedPct || null,
    };
  } catch { return null; }
}

// ── Solana security ────────────────────────────────────────────────────────
export async function secSol(address) {
  try {
    const gp  = await fetch(`https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`);
    const gpj = await gp.json();
    const sec = gpj?.result?.[address] || gpj?.result?.[address.toLowerCase()] || {};

    // GoPlus returns holders in different fields depending on version
    const rawHolders = sec.holder_list || sec.holders || [];
    const topHolders = rawHolders.slice(0, 10).map(h => ({
      address: h.account || h.address || '–',
      pct:     h.percent
                 ? (parseFloat(h.percent) * 100).toFixed(2)   // GoPlus v1: decimal (0.05 = 5%)
                 : h.pct
                 ? parseFloat(h.pct).toFixed(2)               // Already percentage
                 : '?',
      tag:     h.tag || null,
    }));

    // LP lock detection for Solana
    const lpHolders   = sec.lp_holder_analysis || [];
    const lpLocked    = lpHolders.some(lp => lp.is_locked === 1 || lp.tag === 'burn');
    const lpLockedPct = lpHolders.find(lp => lp.is_locked === 1 || lp.tag === 'burn')?.percent || null;
    const lpLockedBy  = lpHolders.find(lp => lp.is_locked === 1 || lp.tag === 'burn')?.tag || null;

    return {
      mintAuthority:        sec.mint_authority      || null,
      freezeAuthority:      sec.freeze_authority    || null,
      isHoneypot:           sec.honeypot            === '1',
      holderCount:          sec.holder_count        || null,
      top10HolderPct:       sec.top10_holder_ratio
                              ? (parseFloat(sec.top10_holder_ratio) * 100).toFixed(1)
                              : (topHolders.length ? sumTop10Pct(topHolders) : null),
      topHolders,
      creatorPct:           sec.creator_percent     ? (parseFloat(sec.creator_percent) * 100).toFixed(2) : null,
      creatorAddress:       sec.creator_address     || null,
      isProxy:              sec.is_proxy            === '1',
      isMintable:           sec.is_mintable         === '1',
      canTakeBackOwnership: sec.can_take_back_ownership === '1',
      isOpenSource:         sec.is_open_source      === '1',
      isBlacklisted:        sec.is_blacklisted      === '1',
      buyTax:               sec.buy_tax             || '0',
      sellTax:              sec.sell_tax            || '0',
      transferPausable:     sec.transfer_pausable   === '1',
      lpLocked,
      lpLockedPct,
      lpLockedBy,
    };
  } catch { return {}; }
}

// ── EVM security ───────────────────────────────────────────────────────────
export async function secEVM(address) {
  try {
    let sec = {};
    for (const chainId of ['1', '56', '137']) {
      const gp  = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`);
      const gpj = await gp.json();
      const result = gpj?.result?.[address.toLowerCase()];
      if (result && Object.keys(result).length > 2) { sec = result; break; }
    }

    const rawHolders = sec.holders || sec.holder_list || [];
    const topHolders = rawHolders.slice(0, 10).map(h => ({
      address:  h.address || h.account || '–',
      pct:      h.percent
                  ? (parseFloat(h.percent) * 100).toFixed(2)
                  : h.pct
                  ? parseFloat(h.pct).toFixed(2)
                  : '?',
      tag:      h.tag || null,
      isLocked: h.is_locked === 1,
    }));

    return {
      mintAuthority:        null,
      freezeAuthority:      null,
      isHoneypot:           sec.is_honeypot          === '1',
      holderCount:          sec.holder_count         || null,
      top10HolderPct:       sec.top10_holder_percent
                              ? (parseFloat(sec.top10_holder_percent) * 100).toFixed(1)
                              : (topHolders.length ? sumTop10Pct(topHolders) : null),
      topHolders,
      creatorPct:           sec.creator_percent      ? (parseFloat(sec.creator_percent) * 100).toFixed(2) : null,
      creatorAddress:       sec.creator_address      || null,
      isProxy:              sec.is_proxy             === '1',
      isMintable:           sec.is_mintable          === '1',
      canTakeBackOwnership: sec.can_take_back_ownership === '1',
      isOpenSource:         sec.is_open_source       === '1',
      isBlacklisted:        sec.is_blacklisted       === '1',
      buyTax:               sec.buy_tax              || '0',
      sellTax:              sec.sell_tax             || '0',
      transferPausable:     sec.transfer_pausable    === '1',
      hiddenOwner:          sec.hidden_owner         === '1',
      selfDestruct:         sec.selfdestruct         === '1',
      lpLocked:             sec.lp_holder_analysis?.some(lp => lp.is_locked === 1) || false,
      lpLockedPct:          sec.lp_holder_analysis?.find(lp => lp.is_locked === 1)?.percent || null,
    };
  } catch { return {}; }
}

// ── BRUTAL Score engine ────────────────────────────────────────────────────
export function calculateScore({ dex: d, sec: s }) {
  let score = 100;
  const bd  = [];

  const liq   = parseFloat(d?.liquidity)  || 0;
  const mcap  = parseFloat(d?.marketCap)  || 0;
  const vol   = parseFloat(d?.volume24h)  || 0;
  const buys  = d?.txns24h?.buys          || 0;
  const sells = d?.txns24h?.sells         || 0;
  const ageMs = d?.createdAt ? Date.now() - d.createdAt : null;
  const ageDays = ageMs ? ageMs / 86400000 : null;
  const isActivelyTrading = vol > 1000 && (buys + sells) > 10;

  // ── INSTANT DEATH signals ──────────────────────────────────────────────
  if (s?.isHoneypot) {
    score -= 50; bd.push({ l: 'Honeypot — Cannot Sell', p: -50 });
  }

  // No liquidity = rugged
  if (liq === 0) {
    score -= 40; bd.push({ l: 'Zero Liquidity — Likely Rugged', p: -40 });
  }

  // Dead token — has liquidity but zero activity
  if (liq > 0 && buys === 0 && sells === 0) {
    score -= 35; bd.push({ l: 'Dead Token — Zero 24h Activity', p: -35 });
  }

  // ── LIQUIDITY checks ──────────────────────────────────────────────────
  if (liq > 0) {
    if (liq < 1000)       { score -= 30; bd.push({ l: `Critical Liquidity $${fmt(liq)}`, p: -30 }); }
    else if (liq < 5000)  { score -= 20; bd.push({ l: `Very Low Liquidity $${fmt(liq)}`, p: -20 }); }
    else if (liq < 10000) { score -= 12; bd.push({ l: `Low Liquidity $${fmt(liq)}`, p: -12 }); }
    else if (liq < 25000) { score -= 6;  bd.push({ l: `Below Average Liquidity $${fmt(liq)}`, p: -6 }); }
  }

  // ── MARKET CAP checks — current state only ─────────────────────────────
  if (mcap > 0) {
    if (mcap < 1000)       { score -= 25; bd.push({ l: `Micro Dead MCap $${fmt(mcap)}`, p: -25 }); }
    else if (mcap < 5000)  { score -= 18; bd.push({ l: `Micro MCap $${fmt(mcap)}`, p: -18 }); }
    else if (mcap < 10000) { score -= 10; bd.push({ l: `Very Low MCap $${fmt(mcap)}`, p: -10 }); }
    else if (mcap < 50000) { score -= 5;  bd.push({ l: `Low MCap $${fmt(mcap)}`, p: -5 }); }
  }

  // ── VOLUME — live trading activity ─────────────────────────────────────
  if (liq > 0) {
    if (vol === 0)         { score -= 25; bd.push({ l: 'Zero 24h Volume', p: -25 }); }
    else if (vol < 100)    { score -= 20; bd.push({ l: `Near-Zero Volume $${fmt(vol)}`, p: -20 }); }
    else if (vol < 500)    { score -= 14; bd.push({ l: `Very Low Volume $${fmt(vol)}`, p: -14 }); }
    else if (vol < 2000)   { score -= 7;  bd.push({ l: `Low Volume $${fmt(vol)}`, p: -7 }); }
  }

  // ── RUG RISK % (liq/mcap) — primary rug signal ─────────────────────────
  if (liq > 0 && mcap > 0) {
    const rugRatio = (liq / mcap) * 100;
    const crashPct = Math.min(99, Math.round(100 - rugRatio));
    if (rugRatio < 0.5)      { score -= 28; bd.push({ l: `Critical Rug Risk: ${rugRatio.toFixed(2)}% — ${crashPct}%+ crash possible in minutes if liq is pulled`, p: -28 }); }
    else if (rugRatio < 1)   { score -= 20; bd.push({ l: `Severe Rug Risk: ${rugRatio.toFixed(2)}% — thin exit, ${crashPct}%+ downside risk`, p: -20 }); }
    else if (rugRatio < 3)   { score -= 12; bd.push({ l: `High Rug Risk: ${rugRatio.toFixed(1)}% — whale sells will move price hard`, p: -12 }); }
    else if (rugRatio < 5)   { score -= 5;  bd.push({ l: `Elevated Rug Risk: ${rugRatio.toFixed(1)}% — re-check before trading`, p: -5 }); }
  }

  // ── SELL PRESSURE — live signal ────────────────────────────────────────
  if (buys > 0 && sells > 0) {
    const ratio = sells / (buys + sells);
    if (ratio > 0.85)      { score -= 15; bd.push({ l: `Extreme Sell Pressure ${(ratio*100).toFixed(0)}% Sells`, p: -15 }); }
    else if (ratio > 0.75) { score -= 10; bd.push({ l: `Heavy Sell Pressure ${(ratio*100).toFixed(0)}% Sells`, p: -10 }); }
    else if (ratio > 0.65) { score -= 5;  bd.push({ l: `Elevated Sells ${(ratio*100).toFixed(0)}%`, p: -5 }); }
  }

  // ── PRICE CHANGE — live crash signal ───────────────────────────────────
  const chg = parseFloat(d?.priceChange24h) || 0;
  if (chg < -80)       { score -= 20; bd.push({ l: `Price Crashed ${chg.toFixed(0)}% in 24h`, p: -20 }); }
  else if (chg < -50)  { score -= 12; bd.push({ l: `Price Down ${chg.toFixed(0)}% in 24h`, p: -12 }); }
  else if (chg < -30)  { score -= 6;  bd.push({ l: `Price Down ${chg.toFixed(0)}% in 24h`, p: -6 }); }

  // ── CONTRACT SECURITY ──────────────────────────────────────────────────
  if (s?.isMintable || (s?.mintAuthority && s.mintAuthority !== 'null' && s.mintAuthority !== null)) {
    score -= 20; bd.push({ l: 'Mintable — Dev Can Print Tokens', p: -20 });
  }
  if (s?.freezeAuthority && s.freezeAuthority !== 'null' && s.freezeAuthority !== null) {
    score -= 12; bd.push({ l: 'Freeze Authority Active', p: -12 });
  }
  if (s?.canTakeBackOwnership || s?.hiddenOwner) {
    score -= 15; bd.push({ l: 'Owner Control Risk', p: -15 });
  }
  if (s?.transferPausable)  { score -= 12; bd.push({ l: 'Transfers Pausable', p: -12 }); }
  if (s?.isBlacklisted)     { score -= 10; bd.push({ l: 'Blacklist Function', p: -10 }); }
  if (s?.selfDestruct)      { score -= 12; bd.push({ l: 'Self-Destruct Function', p: -12 }); }

  // ── TAX ───────────────────────────────────────────────────────────────
  const st = parseFloat(s?.sellTax) || 0;
  const bt = parseFloat(s?.buyTax)  || 0;
  if (st > 10)      { score -= 15; bd.push({ l: `High Sell Tax ${st}%`, p: -15 }); }
  else if (st > 5)  { score -= 6;  bd.push({ l: `Elevated Sell Tax ${st}%`, p: -6 }); }
  if (bt > 10)      { score -= 10; bd.push({ l: `High Buy Tax ${bt}%`, p: -10 }); }

  // ── HOLDER CONCENTRATION ───────────────────────────────────────────────
  const top10      = s?.top10HolderPct  ? parseFloat(s.top10HolderPct)  : null;
  const creatorPct = s?.creatorPct      ? parseFloat(s.creatorPct)      : null;
  if (top10 !== null) {
    if (top10 > 80)       { score -= 18; bd.push({ l: `Top 10 Hold ${top10}% — Extreme Risk`, p: -18 }); }
    else if (top10 > 60)  { score -= 12; bd.push({ l: `Top 10 Hold ${top10}% — High Risk`, p: -12 }); }
    else if (top10 > 40)  { score -= 6;  bd.push({ l: `Top 10 Hold ${top10}%`, p: -6 }); }
  }
  if (creatorPct !== null) {
    if (creatorPct > 10)      { score -= 15; bd.push({ l: `Dev Holds ${creatorPct}% — Dump Risk`, p: -15 }); }
    else if (creatorPct > 5)  { score -= 7;  bd.push({ l: `Dev Holds ${creatorPct}%`, p: -7 }); }
  }

  // ── AGE-BASED SIGNALS (current state matters more than age) ───────────
  if (ageDays !== null) {
    if (ageDays < 1/24)    { score -= 15; bd.push({ l: 'Brand New — <1 Hour Old', p: -15 }); }
    else if (ageDays < 1)  { score -= 10; bd.push({ l: `Brand New — ${Math.floor(ageDays*24)}h Old`, p: -10 }); }
    else if (ageDays < 3)  { score -= 6;  bd.push({ l: `New Token — ${Math.floor(ageDays)}d Old`, p: -6 }); }
    // Old token with dead volume = zombie/rugged — no bonus
  }

  // ── BONUSES — only if actively trading ────────────────────────────────
  // Open source always gets small bonus (independent of trading)
  if (s?.isOpenSource)  { score += 3; bd.push({ l: 'Open Source Verified', p: +3 }); }

  // These bonuses ONLY apply if token is actively trading
  if (isActivelyTrading) {
    if (liq > 100000)     { score += 8;  bd.push({ l: 'Strong Liquidity', p: +8 }); }
    else if (liq > 50000) { score += 5;  bd.push({ l: 'Healthy Liquidity', p: +5 }); }

    if (top10 !== null && top10 < 30) { score += 5; bd.push({ l: 'Well Distributed Supply', p: +5 }); }

    // Age bonus ONLY for active tokens
    if (ageDays !== null && ageDays >= 30) {
      score += 3; bd.push({ l: 'Established + Active >30d', p: +3 });
    }

    if (s?.lpLocked) { score += 6; bd.push({ l: 'Liquidity Locked', p: +6 }); }

    // Healthy buy/sell ratio bonus
    if (buys > 0 && sells > 0) {
      const ratio = buys / (buys + sells);
      if (ratio > 0.6 && vol > 5000) { score += 3; bd.push({ l: 'Healthy Buy Pressure', p: +3 }); }
    }
  }

  // ── HARD CAPS — no misleading high scores ─────────────────────────────
  // Zero liquidity (fully drained pool / rugged) can NEVER score above 35 —
  // regardless of buy/sell counts or any other positive signal
  if (liq === 0) score = Math.min(score, 35);
  // Token with < $1K liquidity can NEVER score above 40
  if (liq > 0 && liq < 1000) score = Math.min(score, 40);
  // Token with < $5K liquidity can NEVER score above 55
  if (liq > 0 && liq < 5000) score = Math.min(score, 55);
  // Token with < $100 volume can NEVER score above 50
  if (liq > 0 && vol < 100)  score = Math.min(score, 50);
  // Dead token (has liquidity but no buys/sells) can NEVER score above 35
  if (liq > 0 && buys === 0 && sells === 0) score = Math.min(score, 35);
  // Honeypot can NEVER score above 20
  if (s?.isHoneypot) score = Math.min(score, 20);
  // Missing critical security data cap
  const missingCritical = s?.isHoneypot === undefined || s?.isMintable === undefined;
  if (missingCritical && score > 75) score = 75;

  const finalScore = Math.max(0, Math.min(95, Math.round(score)));

  let verdict, cls, risk_level;
  if (finalScore >= 70)      { verdict = 'RELATIVELY SAFE';      cls = 'safe';   risk_level = 'LOW';    }
  else if (finalScore >= 45) { verdict = 'PROCEED WITH CAUTION'; cls = 'warn';   risk_level = 'MEDIUM'; }
  else                       { verdict = 'HIGH RISK – AVOID';     cls = 'danger'; risk_level = 'HIGH';   }

  return { score: finalScore, verdict, cls, risk_level, breakdown: bd };
}

// ── AI verdict ─────────────────────────────────────────────────────────────
export async function aiVerdict(d, s, scoreData) {
  if (!process.env.GROQ_API_KEY) return null;
  try {
    const liq      = d?.liquidity  || 0;
    const mcap     = d?.marketCap  || 0;
    const vol      = d?.volume24h  || 0;
    const rugRatio = liq > 0 && mcap > 0 ? ((liq / mcap) * 100).toFixed(2) : 'unknown';
    const chg      = d?.priceChange24h || 0;

    const prompt = `You are a brutally honest DeFi risk analyst. No hype. No softening. State facts. 2 sentences max.

Token: ${d?.name || 'Unknown'} ($${d?.symbol || '?'})
Score: ${scoreData.score}/100 — ${scoreData.verdict}
Price change 24h: ${chg}%
MCap: $${fmt(mcap)} | Liquidity: $${fmt(liq)} | Volume 24h: $${fmt(vol)}
Rug Risk %: ${rugRatio}% (lower = more risk)
Buys/Sells 24h: ${d?.txns24h?.buys || 0} / ${d?.txns24h?.sells || 0}
Honeypot: ${s?.isHoneypot ? 'YES' : 'No'} | Mintable: ${s?.isMintable ? 'YES' : 'No'}
Freeze: ${s?.freezeAuthority ? 'ACTIVE' : 'Revoked'} | Top 10 holders: ${s?.top10HolderPct || 'N/A'}%
Sell tax: ${s?.sellTax || 0}% | Dev holds: ${s?.creatorPct || 'N/A'}%
Key red flags: ${scoreData.breakdown.filter(b => b.p <= -10).map(b => b.l).join(', ') || 'none'}

Write exactly 2 sentences. First: state the single biggest risk or green flag with the actual number. Second: clear verdict — buy/avoid/wait and why.`;

    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model:       'llama3-8b-8192',
        messages:    [{ role: 'user', content: prompt }],
        max_tokens:  120,
        temperature: 0.3,
      }),
    });
    const j = await r.json();
    return j?.choices?.[0]?.message?.content?.trim() || null;
  } catch { return null; }
}

// ── runVerdict — main entry point ──────────────────────────────────────────
export async function runVerdict(address) {
  const chain = detectChain(address);
  const [d, s] = await Promise.all([
    fetchDex(address),
    chain === 'solana' ? secSol(address) : secEVM(address),
  ]);

  // Merge DexScreener LP lock into sec (more reliable than GoPlus for Solana)
  if (d?.lpLocked === true)  s.lpLocked = true;
  if (d?.lpLocked === false && s.lpLocked !== true) s.lpLocked = false;
  if (d?.lpLockedPct) s.lpLockedPct = d.lpLockedPct;

  const scoreData = calculateScore({ dex: d, sec: s });
  const ai        = await aiVerdict(d, s, scoreData);

  const liq      = d?.liquidity  || 0;
  const mcap     = d?.marketCap  || 0;
  const rugRatio = liq > 0 && mcap > 0 ? ((liq / mcap) * 100).toFixed(2) : null;

  return {
    ca:             address,
    chain,
    dex:            d,
    sec:            s,
    score:          scoreData.score,
    verdict:        scoreData.verdict,
    cls:            scoreData.cls,
    risk_level:     scoreData.risk_level,
    breakdown:      scoreData.breakdown,
    liq_mcap_ratio: rugRatio,
    ai,
    timestamp:      new Date().toISOString(),
  };
}