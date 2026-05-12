import 'dotenv/config';
const TOKEN = process.env.TELEGRAM_TOKEN;
const API = 'https://trenchreads.vercel.app/api/check';

async function sendMsg(chatId, text) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({chat_id: chatId, text, parse_mode: 'HTML'})
  });
}

async function checkToken(address) {
  const r = await fetch(API, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({address})
  });
  return r.json();
}

async function poll(offset = 0) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?offset=${offset}&timeout=30`);
  const data = await r.json();
  for (const update of data.result || []) {
    const msg = update.message;
    if (msg?.text) {
      const chatId = msg.chat.id;
      const text = msg.text.trim();
      if (text === '/start') {
        await sendMsg(chatId, '👁 <b>TrenchReads Bot</b>\n\nchecked onchain not on vibes\n\nSend any token address or use:\n/check [address]');
      } else if (text.startsWith('/check ') || /^[1-9A-HJ-NP-Za-km-z]{32,44}$|^0x[a-fA-F0-9]{40}$/.test(text)) {
        const address = text.replace('/check ', '').trim();
        await sendMsg(chatId, '🔍 scanning onchain...');
        try {
          const d = await checkToken(address);
          if (!d.dex) return sendMsg(chatId, '❌ No data found for this address.');
         const score = d.score ?? 0; 
          const verdict = score >= 70 ? '🟢 RELATIVELY SAFE' : score >= 45 ? '🟡 PROCEED WITH CAUTION' : '🔴 HIGH RISK — AVOID';
          const liqMcap = d.dex.mcap > 0 ? ((d.dex.liquidity/d.dex.mcap)*100).toFixed(2) : 'n/a';
          const reply = `<b>#TrenchReads — $${d.dex.symbol}</b>\n\nRISK SCORE: ${score}/100\nVERDICT: ${verdict}\n\nMARKET:\nliquidity: $${f(d.dex.liquidity)}\nmcap: $${f(d.dex.mcap)}\nliq/mcap: ${liqMcap}%\nage: ${d.dex.ageDays}d\n\nSECURITY:\nhoneypot: ${d.sec?.honeypot||'n/a'}\nmint auth: ${d.sec?.mintAuth||'unknown'}\nhidden owner: ${d.sec?.hiddenOwner||'unknown'}\nblacklist: ${d.sec?.isBlacklisted||'unknown'}\n\nchecked onchain not on vibes — TrenchReads\ntrenchreads.vercel.app`;
          await sendMsg(chatId, reply);
        } catch(e) {
          await sendMsg(chatId, '❌ Error: ' + e.message);
        }
      }
    }
    offset = update.update_id + 1;
  }
  return poll(offset);
}

function f(n) {
  if (!n) return '0';
  if (n >= 1e9) return (n/1e9).toFixed(2)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return n.toFixed(2);
}

function calculateScore(d) {
  let s = 100;
  if (!d.dex) return 0;
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
  if (d.sec?.mintAuth === 'unknown') s -= 4;
  if (d.sec?.hiddenOwner === 'RISK') s -= 15;
  if (d.sec?.isBlacklisted === 'RISK') s -= 15;
  if (d.sec?.transferPausable === 'RISK') s -= 10;
  if (d.sec?.canTakeBack === 'RISK') s -= 10;
  if (d.dex.ageDays !== null && d.dex.ageDays < 1) s -= 15;
  else if (d.dex.ageDays < 3) s -= 10;
  else if (d.dex.ageDays < 7) s -= 5;
  return Math.max(0, Math.min(100, s));
}
console.log('TrenchReads bot running...');
poll();
