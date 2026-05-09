export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const body = req.body || {};
  const address = body.address || req.query.address;

  if (!address || address === 'test') return res.status(200).json({ status: 'ok' });

  const isSol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);

  try {
    const dex = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    const dexData = await dex.json();

    let goplusData = {};
    if (isSol) {
      const gp = await fetch(`https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`);
      goplusData = await gp.json();
    } else {
      const gp = await fetch(`https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses=${address}`);
      goplusData = await gp.json();
    }

    res.status(200).json({ dex: dexData, goplus: goplusData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
