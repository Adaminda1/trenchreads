export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { email, plan, secret } = req.body || {};
  if (secret !== process.env.ACTIVATE_SECRET) return res.status(401).json({ error: 'unauthorized' });
  const key = 'tr_' + Math.random().toString(36).slice(2,10) + Math.random().toString(36).slice(2,10);
  return res.status(200).json({ key, plan, email });
}