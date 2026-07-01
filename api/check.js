import { setupDB, validateKey, checkFreeLimit } from './db.js';
import { runVerdict } from '../lib/scoring-engine.js';

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

  if (key && key.startsWith('tr_')) {
    const keyRow = await validateKey(key);
    if (!keyRow) return res.status(401).json({ error: 'Invalid or expired Pro key.' });
  } else {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
              || req.socket?.remoteAddress || 'unknown';
    const freeCheck = await checkFreeLimit(ip);
    if (!freeCheck.allowed) {
      return res.status(429).json({
        error: 'free_limit_reached',
        message: 'Free limit reached — 3/3 checks used today.',
      });
    }
  }

  try {
    const result = await runVerdict(address);
    return res.status(200).json(result);
  } catch (e) {
    console.error('check error:', e);
    return res.status(500).json({ error: e.message });
  }
}