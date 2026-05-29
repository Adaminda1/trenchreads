const fs = require('fs');
let c = fs.readFileSync('api/check.mjs', 'utf8');

const smartWalletCode = `
// Known smart/profitable wallets to track
const SMART_WALLETS = [
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
  'HVh6wHNBAsGbz5Xv47QCQ7XMFsYmG7AsUW3hbqxNJNVN',
  'GJRs4FwHtemZ5ZE9x3kb4jfTtCSCAo5JvJfPKgGBMGJF',
  'Ai2GcBGMNa7JXQS7KBNpQTvZBGJaFPyZdxEUmJHQVCBp',
  '5tzFkiKscXHK5ZXCGbCsvg6xM5tMbNLPXMHQLqhRMGeC',
  'BpE2NQWLFkEgHNBzjEp7EYzZHGXPMXLVJFdVkfpE8QaX',
  'CKs1E69a2e9TmH9tMEDFxCEpAqxLPnHwGcHJdBbmT5Kz',
  'DYw8jCTfwHNrXkpFSGCEVqBFxCHqJzPtPzQMWXRKJNMP',
  'EF7hVJkLpNsXqRtMbWcGdYzKpFvHxCjNqTsLmBwRKPvA',
  'FGz9mKpLqWxNvRtJbSdHyZcBfMjXpNqVsLtKwCmRJPxE'
];

async function checkSmartWallets(tokenAddress, chain) {
  if (chain !== 'solana') return null;
  try {
    const key = process.env.HELIUS_API_KEY;
    if (!key) return null;
    
    const sixHoursAgo = Math.floor(Date.now() / 1000) - 21600;
    let buyCount = 0;
    const buyers = [];
    
    // Check recent transactions for this token
    const r = await fetch('https://api.helius.xyz/v0/addresses/' + tokenAddress + '/transactions?api-key=' + key + '&limit=100&type=SWAP', {
      signal: AbortSignal.timeout(5000)
    });
    
    if (!r.ok) return null;
    const txs = await r.json();
    if (!Array.isArray(txs)) return null;
    
    for (const tx of txs) {
      if (tx.timestamp < sixHoursAgo) break;
      const signer = tx.feePayer || tx.signers?.[0];
      if (signer && SMART_WALLETS.includes(signer) && !buyers.includes(signer)) {
        buyCount++;
        buyers.push(signer);
      }
    }
    
    return { count: buyCount, wallets: buyers.length };
  } catch(e) {
    return null;
  }
}
`;

// Insert smart wallet code before the handler
c = c.replace(
  'export default async function handler(req, res) {',
  smartWalletCode + '\nexport default async function handler(req, res) {'
);

// Add smart wallet check to the main handler
c = c.replace(
  'const score = d ? calculateScore({dex:d, sec:s}) : 0;\n  res.status(200).json({dex:d, sec:s, chain, ai, score});',
  `const score = d ? calculateScore({dex:d, sec:s}) : 0;
  const smartWallets = await checkSmartWallets(address, chain);
  res.status(200).json({dex:d, sec:s, chain, ai, score, smartWallets});`
);

fs.writeFileSync('api/check.mjs', c);
console.log('done');