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
    const pairs = data.pairs.sort((a,b) => (b.liquidity?.usd||0)-(a.liquidity?.usd||0));
    const p = pairs[0];
    const created = p.pairCreatedAt ? new Date(p.pairCreatedAt) : null;
    const ageMs = created ? Date.now() - created.getTime() : null;
    return {
      name: p.baseToken?.name || address.slice(0,8),
      symbol: p.baseToken?.symbol || '???',
      logo: p.info?.imageUrl || null,
      price: p.priceUsd ? parseFloat(p.priceUsd) : null,
      mcap: p.marketCap || p.fdv || null,
      liquidity: p.liquidity?.usd || 0,
      volume24h: p.volume?.h24 || 0,
      change24h: p.priceChange?.h24 || null,
      txns24h: (p.txns?.h24?.buys||0)+(p.txns?.h24?.sells||0),
      buys24h: p.txns?.h24?.buys || 0,
      sells24h: p.txns?.h24?.sells || 0,
      ageDays: ageMs ? Math.floor(ageMs/86400000) : null,
      ageHours: ageMs ? Math.floor(ageMs/3600000) : null,
      dex: p.dexId || 'unknown',
      chainId: p.chainId || 'unknown',
    };
  }

  async function secSol(address) {
    const r = await fetch(`https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`);
    const data = await r.json();
    if (!data?.result) return null;
    const td = data.result[address] || {};
    return {
      mintAuth: td.mintable?.status==='1'?'RISK':td.mintable?.status==='0'?'safe':'unknown',
      freezeAuth: td.balance_mutable?.status==='1'?'RISK':td.balance_mutable?.status==='0'?'safe':'unknown',
      closable: td.closable?.status==='1'?'yes':'no',
      honeypot: 'n/a',
      chain: 'Solana',
    };
  }

  async function secEVM(address) {
    const chains = [{id:'1',name:'Ethereum'},{id:'56',name:'BSC'},{id:'137',name:'Polygon'},{id:'42161',name:'Arbitrum'},{id:'8453',name:'Base'},{id:'43114',name:'Avalanche'}];
    for (const chain of chains) {
      const r = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${chain.id}?contract_addresses=${address}`);
      const data = await r.json();
      if (!data?.result) continue;
      const td = data.result[address.toLowerCase()] || data.result[address] || {};
      if (!Object.keys(td).length) continue;
      return {
        mintAuth: td.mintable==='1'?'RISK':td.mintable==='0'?'safe':'unknown',
        freezeAuth: 'n/a',
        closable: 'n/a',
        honeypot: td.is_honeypot==='1'?'DETECTED':td.is_honeypot==='0'?'none':'unknown',
        buyTax: td.buy_tax?(parseFloat(td.buy_tax)*100).toFixed(1)+'%':'unknown',
        sellTax: td.sell_tax?(parseFloat(td.sell_tax)*100).toFixed(1)+'%':'unknown',
        isOpenSource: td.is_open_source==='1'?'yes':'no',
        hiddenOwner: td.hidden_owner==='1'?'RISK':'no',
        canTakeBack: td.can_take_back_ownership==='1'?'RISK':'no',
        isProxy: td.is_proxy==='1'?'yes':'no',
        isBlacklisted: td.is_blacklisted==='1'?'RISK':'no',
        transferPausable: td.transfer_pausable==='1'?'RISK':'no',
        ownershipRenounced: td.owner_address===''||td.owner_address==='0x0000000000000000000000000000000000000000'?'yes':'no',
        chain: chain.name,
      };
    }
    return null;
  }

  try {
    const chain = detectChain(address);
    const [d, s] = await Promise.all([dex(address), chain==='solana'?secSol(address):secEVM(address)]);
    res.status(200).json({ dex: d, sec: s, chain });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
