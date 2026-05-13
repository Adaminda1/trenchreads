export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { address } = req.body || {};
  if (!address || address === 'test') return res.status(200).json({ status: 'ok' });
  function detectChain(a) {
    if (/^0x[a-fA-F0-9]{40}$/.test(a)) return 'evm';
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return 'solana';
    return 'unknown';
  }
  async function dex(address) {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    const data = await r.json();
    if (!data?.pairs?.length) return null;
    const pairs = data.pairs.sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0));
    const p = pairs[0];
    const created = p.pairCreatedAt?new Date(p.pairCreatedAt):null;
    const ageMs = created?Date.now()-created.getTime():null;
    return {
      name:p.baseToken?.name||address.slice(0,8),
      symbol:p.baseToken?.symbol||'???',
      logo:p.info?.imageUrl||null,
      price:p.priceUsd?parseFloat(p.priceUsd):null,
      mcap:p.marketCap||p.fdv||null,
      liquidity:p.liquidity?.usd||0,
      volume24h:p.volume?.h24||0,
      change24h:p.priceChange?.h24||null,
      txns24h:(p.txns?.h24?.buys||0)+(p.txns?.h24?.sells||0),
      buys24h:p.txns?.h24?.buys||0,
      sells24h:p.txns?.h24?.sells||0,
      ageDays:ageMs?Math.floor(ageMs/86400000):null,
      ageHours:ageMs?Math.floor(ageMs/3600000):null,
      dex:p.dexId||'unknown',
      chainId:p.chainId||'unknown',
      websites:p.info?.websites||[],
      socials:p.info?.socials||[],
    };
  }
  async function secSol(address) {
    const r = await fetch(`https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`);
    const data = await r.json();
    if (!data?.result) return null;
    const td = data.result[address]||{};
    return {
      mintAuth:td.mintable?.status==='1'?'RISK':td.mintable?.status==='0'?'safe':'unknown',
      freezeAuth:td.balance_mutable?.status==='1'?'RISK':td.balance_mutable?.status==='0'?'safe':'unknown',
      closable:td.closable?.status==='1'?'yes':'no',
      honeypot:'n/a',buyTax:'unknown',sellTax:'unknown',
      isOpenSource:'unknown',hiddenOwner:'unknown',canTakeBack:'unknown',
      isProxy:'unknown',isBlacklisted:'unknown',transferPausable:'unknown',
      ownershipRenounced:'unknown',
      top10HolderPct:td.top_10_holder_rate?(parseFloat(td.top_10_holder_rate)*100).toFixed(1):null,
      creatorPct:td.creator_percentage?(parseFloat(td.creator_percentage)*100).toFixed(1):null,
      ownerPct:null,holders:td.holder_count||null,topHolders:td.holders||null,
      chain:'Solana',
    };
  }
  async function secEVM(address) {
    const chains=[{id:'1',name:'Ethereum'},{id:'56',name:'BSC'},{id:'137',name:'Polygon'},{id:'42161',name:'Arbitrum'},{id:'8453',name:'Base'},{id:'43114',name:'Avalanche'}];
    for (const chain of chains) {
      const r = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${chain.id}?contract_addresses=${address}`);
      const data = await r.json();
      if (!data?.result) continue;
      const td = data.result[address.toLowerCase()]||data.result[address]||{};
      if (!Object.keys(td).length) continue;
      return {
        mintAuth:td.mintable==='1'?'RISK':td.mintable==='0'?'safe':'unknown',
        freezeAuth:'n/a',closable:'n/a',
        honeypot:td.is_honeypot==='1'?'DETECTED':td.is_honeypot==='0'?'none':'unknown',
        buyTax:td.buy_tax?(parseFloat(td.buy_tax)*100).toFixed(1)+'%':'unknown',
        sellTax:td.sell_tax?(parseFloat(td.sell_tax)*100).toFixed(1)+'%':'unknown',
        isOpenSource:td.is_open_source==='1'?'yes':'no',
        hiddenOwner:td.hidden_owner==='1'?'RISK':'no',
        canTakeBack:td.can_take_back_ownership==='1'?'RISK':'no',
        isProxy:td.is_proxy==='1'?'yes':'no',
        isBlacklisted:td.is_blacklisted==='1'?'RISK':'no',
        transferPausable:td.transfer_pausable==='1'?'RISK':'no',
        ownershipRenounced:td.owner_address===''||td.owner_address==='0x0000000000000000000000000000000000000000'?'yes':'no',
        top10HolderPct:null,
        creatorPct:td.creator_percent?(parseFloat(td.creator_percent)*100).toFixed(1):null,
        ownerPct:td.owner_percent?(parseFloat(td.owner_percent)*100).toFixed(1):null,
        holders:td.holder_count||null,topHolders:td.holders||null,
        chain:chain.name,
      };
    }
    return null;
  }
  async function aiVerdict(d, s, chain) {
    const key = process.env.GROQ_API_KEY;
    if (!key) return null;
    const prompt = `you are a crypto token risk analyst. analyze this token data and give a 3-line verdict. be direct, no fluff.
contract: ${d?.name||'unknown'} (${d?.symbol||'?'}) on ${s?.chain||chain}
price: $${d?.price||'n/a'} mcap: $${d?.mcap||'n/a'} liquidity: $${d?.liquidity||0}
liq/mcap ratio: ${d?.mcap>0?((d.liquidity/d.mcap)*100).toFixed(2)+'%':'unknown'}
age: ${d?.ageDays||'unknown'} days
mint auth: ${s?.mintAuth||'unknown'} freeze auth: ${s?.freezeAuth||'unknown'}
honeypot: ${s?.honeypot||'unknown'} hidden owner: ${s?.hiddenOwner||'unknown'}
blacklist: ${s?.isBlacklisted||'unknown'} transfer pausable: ${s?.transferPausable||'unknown'}
top10 holders: ${s?.top10HolderPct||'unknown'}%
format: verdict: [safe/caution/avoid] | key flags: [list] | final call: [one sentence]
checked onchain not on vibes - TrenchReads`;
    const groqCtrl = new AbortController(); setTimeout(() => groqCtrl.abort(), 5000); const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body:JSON.stringify({model:'llama3-8b-8192',messages:[{role:'user',content:prompt}],max_tokens:200})
    });
    const data = await r.json();
    return data.choices?.[0]?.message?.content||null;
  }
  try {
    const chain = detectChain(address);
    const [d,s] = await Promise.all([dex(address),chain==='solana'?secSol(address):secEVM(address)]);
    const ai = await aiVerdict(d,s,chain);
    const score = d ? calculateScore({dex:d, sec:s}) : 0;
res.status(200).json({dex:d,sec:s,chain,ai,score});
  } catch(e) {
    res.status(500).json({error:e.message});
  }
}

function calculateScore(d) {
  let s = 100;
  const liq = d.dex.liquidity || 0;
  const mcap = d.dex.mcap || 0;
  if (liq === 0) s -= 40;
  else if (liq < 1000) s -= 35;
  else if (liq < 5000) s -= 28;
  else if (liq < 20000) s -= 18;
  else if (liq < 50000) s -= 8;
  if (liq > 0 && mcap > 0) {
    const r = (liq/mcap)*100;
    if (r < 0.5) s -= 30;
    else if (r < 1) s -= 15;
    else if (r < 3) s -= 8;
  }
  if (d.sec?.honeypot === 'DETECTED') s -= 40;
  if (d.sec?.mintAuth === 'RISK') s -= 20;
  if (d.sec?.hiddenOwner === 'RISK') s -= 15;
  if (d.sec?.isBlacklisted === 'RISK') s -= 15;
  if (d.sec?.transferPausable === 'RISK') s -= 10;
  if (d.sec?.canTakeBack === 'RISK') s -= 10;
  if (d.dex.ageDays !== null && d.dex.ageDays < 1) s -= 15;
  else if (d.dex.ageDays < 3) s -= 10;
  else if (d.dex.ageDays < 7) s -= 5;
  return Math.max(0, Math.min(100, s));
}