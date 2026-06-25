import { setupDB, validateKey, checkFreeLimit } from './db.js';

function detectChain(address) {
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) return 'evm';
  return 'solana';
}

async function dex(address) {
  const chain = detectChain(address);
  const chainSlug = chain === 'evm' ? 'ethereum' : 'solana';
  const url = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
  const r = await fetch(url);
  const j = await r.json();
  const pair = j?.pairs?.[0];
  if (!pair) return null;
  return {
    name: pair.baseToken?.name,
    symbol: pair.baseToken?.symbol,
    price: pair.priceUsd,
    liquidity: pair.liquidity?.usd,
    volume24h: pair.volume?.h24,
    priceChange24h: pair.priceChange?.h24,
    txns24h: pair.txns?.h24,
    marketCap: pair.marketCap,
    fdv: pair.fdv,
    pairAddress: pair.pairAddress,
    dexId: pair.dexId,
    createdAt: pair.pairCreatedAt,
    url: pair.url,
    chainId: pair.chainId,
  };
}

async function secSol(address) {
  const url = `https://api.helius.xyz/v0/token-metadata?api-key=${process.env.HELIUS_API_KEY}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mintAccounts: [address], includeOffChain: true, disableCache: false }),
  });
  const j = await r.json();
  const meta = j?.[0];

  // GoPlus security
  const gp = await fetch(`https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`);
  const gpj = await gp.json();
  const sec = gpj?.result?.[address.toLowerCase()] || gpj?.result?.[address] || {};

  return {
    name: meta?.onChainMetadata?.metadata?.data?.name || meta?.offChainMetadata?.metadata?.name,
    symbol: meta?.onChainMetadata?.metadata?.data?.symbol,
    mintAuthority: sec.mint_authority || null,
    freezeAuthority: sec.freeze_authority || null,
    isHoneypot: sec.honeypot === '1',
    holderCount: sec.holder_count,
    top10HolderPercent: sec.top10_holder_ratio,
    isProxy: sec.is_proxy,
    isMintable: sec.is_mintable === '1',
    canTakeBackOwnership: sec.can_take_back_ownership === '1',
    isOpenSource: sec.is_open_source === '1',
    isBlacklisted: sec.is_blacklisted === '1',
    buyTax: sec.buy_tax,
    sellTax: sec.sell_tax,
    transferPausable: sec.transfer_pausable === '1',
    lpHolders: sec.lp_holder_analysis,
    creatorAddress: sec.creator_address,
    creatorPercent: sec.creator_percent,
  };
}

async function secEVM(address) {
  const gp = await fetch(`https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses=${address}`);
  const gpj = await gp.json();
  const sec = gpj?.result?.[address.toLowerCase()] || {};
  return {
    name: sec.token_name,
    symbol: sec.token_symbol,
    isHoneypot: sec.is_honeypot === '1',
    holderCount: sec.holder_count,
    top10HolderPercent: sec.top10_holder_percent,
    isProxy: sec.is_proxy === '1',
    isMintable: sec.is_mintable === '1',
    canTakeBackOwnership: sec.can_take_back_ownership === '1',
    isOpenSource: sec.is_open_source === '1',
    isBlacklisted: sec.is_blacklisted === '1',
    buyTax: sec.buy_tax,
    sellTax: sec.sell_tax,
    transferPausable: sec.transfer_pausable === '1',
    creatorAddress: sec.creator_address,
    creatorPercent: sec.creator_percent,
    mintAuthority: null,
    freezeAuthority: null,
  };
}

async function aiVerdict(d, s) {
  if (!process.env.GROQ_API_KEY) return null;
  const prompt = `You are a DeFi security analyst. Given this token data, provide a 2-sentence risk verdict. Be direct and specific.

Token: ${d?.name || 'Unknown'} (${d?.symbol || '?'})
Price: $${d?.price || 'N/A'} | Liquidity: $${d?.liquidity || 'N/A'} | 24h Volume: $${d?.volume24h || 'N/A'}
Holders: ${s?.holderCount || 'N/A'} | Top 10 hold: ${s?.top10HolderPercent || 'N/A'}%
Honeypot: ${s?.isHoneypot ? 'YES' : 'No'} | Mintable: ${s?.isMintable ? 'YES' : 'No'} | Proxy: ${s?.isProxy ? 'YES' : 'No'}
Buy Tax: ${s?.buyTax || 0}% | Sell Tax: ${s?.sellTax || 0}%
Mint Authority: ${s?.mintAuthority || 'Revoked'} | Freeze Authority: ${s?.freezeAuthority || 'Revoked'}`;

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: 'llama3-8b-8192',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 120,
    }),
  });
  const j = await r.json();
  return j?.choices?.[0]?.message?.content || null;
}

export function calculateScore({ dex: d, sec: s }) {
  if (!d && !s) return 0;
  let score = 100;
  const bd = [];

  if (s?.isHoneypot) { score -= 40; bd.push({ l: 'Honeypot Detected', p: -40, c: 'var(--rl)' }); }
  if (s?.isMintable) { score -= 20; bd.push({ l: 'Mintable Supply', p: -20, c: 'var(--yl)' }); }
  if (s?.mintAuthority && s.mintAuthority !== 'null') { score -= 15; bd.push({ l: 'Mint Authority Active', p: -15, c: 'var(--yl)' }); }
  if (s?.freezeAuthority && s.freezeAuthority !== 'null') { score -= 10; bd.push({ l: 'Freeze Authority Active', p: -10, c: 'var(--yl)' }); }
  if (s?.isProxy === 'yes') { score -= 5; bd.push({ l: 'Proxy Contract', p: -5, c: 'var(--yl)' }); }
  if (s?.canTakeBackOwnership) { score -= 15; bd.push({ l: 'Owner Can Reclaim', p: -15, c: 'var(--rl)' }); }
  if (s?.transferPausable) { score -= 10; bd.push({ l: 'Transfers Pausable', p: -10, c: 'var(--yl)' }); }
  if (parseFloat(s?.buyTax) > 10) { score -= 10; bd.push({ l: `High Buy Tax (${s.buyTax}%)`, p: -10, c: 'var(--yl)' }); }
  if (parseFloat(s?.sellTax) > 10) { score -= 15; bd.push({ l: `High Sell Tax (${s.sellTax}%)`, p: -15, c: 'var(--rl)' }); }
  if (parseFloat(s?.top10HolderPercent) > 0.5) { score -= 10; bd.push({ l: 'Top 10 Hold >50%', p: -10, c: 'var(--yl)' }); }
  if (d?.createdAt) {
    const ageHours = (Date.now() - d.createdAt) / 3600000;
    if (ageHours < 24) { score -= 5; bd.push({ l: `Brand New Token ${Math.floor(ageHours)}h old`, p: -5, c: 'var(--yl)' }); }
  }
  if (parseFloat(d?.liquidity) < 10000) { score -= 10; bd.push({ l: 'Low Liquidity <$10k', p: -10, c: 'var(--yl)' }); }

  return { score: Math.max(0, score), breakdown: bd };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { ca, address: addr2, apiKey } = req.body || {};
  const address = ca || addr2;

  if (!address) return res.status(400).json({ error: 'CA required' });

  await setupDB();

  // Pro key validation
  if (apiKey && apiKey.startsWith('tr_')) {
    const keyRow = await validateKey(apiKey);
    if (!keyRow) {
      return res.status(401).json({ error: 'Invalid or expired Pro key. Please renew your subscription.' });
    }
    // Pro user — skip free limit check, proceed
  } else {
    // Free tier — check daily limit by IP
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    const freeCheck = await checkFreeLimit(ip);
    if (!freeCheck.allowed) {
      return res.status(429).json({
        error: 'free_limit_reached',
        message: 'Free limit reached — 3/3 checks used today. Upgrade to TrenchReads Pro for unlimited checks.',
      });
    }
  }

  try {
    const chain = detectChain(address);
    const [d, s] = await Promise.all([dex(address), chain === 'solana' ? secSol(address) : secEVM(address)]);
    const ai = await aiVerdict(d, s);
    const scoreData = d ? calculateScore({ dex: d, sec: s }) : { score: 0, breakdown: [] };
    return res.status(200).json({ dex: d, sec: s, chain, ai, score: scoreData.score, breakdown: scoreData.breakdown });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}