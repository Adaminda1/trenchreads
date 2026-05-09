export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { address, chain } = req.query;

  // health check ping
  if (!address) return res.status(200).json({ status: 'ok' });

  try {
    const dex = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    const dexData = await dex.json();

    const goplus = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${chain || '1'}?contract_addresses=${address}`);
    const goplusData = await goplus.json();

    res.status(200).json({ dex: dexData, goplus: goplusData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
