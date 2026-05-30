
import { setupDB, createKey } from './db.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  try {
    await setupDB();
    const { email, plan, secret } = req.body || {};
    
    // Verify secret to prevent abuse
    if (secret !== process.env.ACTIVATE_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    
    if (!email || !plan) {
      return res.status(400).json({ error: 'email and plan required' });
    }
    
    const key = await createKey(email, plan);
    return res.status(200).json({ key, plan, email });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
