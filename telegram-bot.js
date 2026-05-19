import 'dotenv/config';
const TOKEN = process.env.TELEGRAM_TOKEN;
const API = 'https://trenchreads.vercel.app/api/check';

function f(n) {
  if (!n || isNaN(n)) return '0';
  if (n >= 1e9) return (n/1e9).toFixed(2)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return Number(n).toFixed(0);
}

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

function buildMessage(d, address) {
  const dex = d.dex || {};
  const sec = d.sec || {};
  const score = d.score ?? 0;

  // Verdict — same thresholds as site
  const verdict = score >= 70 ? '🟢 RELATIVELY SAFE'
    : score >= 45 ? '🟡 PROCEED WITH CAUTION'
    : '🔴 HIGH RISK — AVOID';

  // Rug Exit Risk — plain English like site
  const liq = dex.liquidity || 0;
  const mcap = dex.mcap || 0;
  let rugLine = '';
  if (liq > 0 && mcap > 0) {
    const r = ((liq / mcap) * 100).toFixed(2);
    if (r < 1) rugLine = `🔴 <b>Rug Exit Risk — CRITICAL (${r}%)</b>\nOnly ${r}% of mcap is liquid. Insiders can exit. You may not.`;
    else if (r < 3) rugLine = `🟡 <b>Low Rug Buffer (${r}%)</b>\nThin cushion. Big wallet sells will move price hard against you.`;
    else rugLine = `✅ Rug Exit Risk: ${r}% — ${r > 10 ? 'healthy' : 'acceptable'}`;
  }

  // Key security flags
  const flags = [];
  if (sec.honeypot === 'DETECTED') flags.push('🔴 HONEYPOT — cannot sell');
  if (sec.mintAuth === 'RISK') flags.push('🔴 Mint Authority active — dev can print tokens');
  if (sec.freezeAuth === 'RISK') flags.push('🔴 Freeze Authority active — funds can be frozen');
  if (sec.isBlacklisted === 'RISK') flags.push('🔴 Blacklist function detected');
  if (sec.transferPausable === 'RISK') flags.push('🔴 Transfer can be paused');
  if (sec.hiddenOwner === 'RISK') flags.push('🔴 Hidden owner detected');
  if (sec.mintAuth === 'safe') flags.push('✅ Mint authority revoked');
  if (sec.honeypot === 'none') flags.push('✅ No honeypot detected');
  if (!flags.length) flags.push('⚠️ Limited security data available');

  // Score cap notice
  const capNotice = score === 85 && (
    (sec.freezeAuth !== 'RISK' && sec.freezeAuth !== 'safe') ||
    (sec.honeypot !== 'DETECTED' && sec.honeypot !== 'none')
  ) ? '\n⚠️ <i>Score capped at 85 — freeze/honeypot unconfirmed</i>' : '';

  const age = dex.ageDays != null ? `${dex.ageDays}d` : dex.ageHours != null ? `${dex.ageHours}h` : '?';
  const top10 = sec.top10HolderPct ? `${sec.top10HolderPct}%` : 'n/a';

  return `<b>#TrenchReads — $${dex.symbol || address.slice(0,8)}</b>
checked onchain, not on vibes

<b>RISK SCORE: ${score}/100</b>
${verdict}${capNotice}

${rugLine}

<b>FLAGS:</b>
${flags.join('\n')}

<b>MARKET:</b>
💰 Liquidity: $${f(liq)}
📊 MCap: $${f(mcap)}
📈 24h Vol: $${f(dex.volume24h || 0)}
🕐 Age: ${age}
👥 Top 10 holders: ${top10}

<b>CONTRACT:</b>
Mint: ${sec.mintAuth || 'unknown'} | Freeze: ${sec.freezeAuth || 'unknown'}
Honeypot: ${sec.honeypot || 'unknown'}

CA: <code>${address}</code>
🔗 trenchreads.vercel.app`;
}

async function poll(offset = -1) {
  if (offset === -1) { const init = await (await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?offset=-1`)).json(); offset = ((init.result||[]).pop()?.update_id ?? -1) + 1; } const r = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?offset=${offset}&timeout=30`);
  const data = await r.json();
  for (const update of data.result || []) {
    const msg = update.message;
    if (msg?.text) {
      const chatId = msg.chat.id;
      const text = msg.text.trim();
      if (text === '/start') {
        await sendMsg(chatId, '🔍 <b>TrenchReads Bot</b>\n\nchecked onchain, not on vibes\n\nSend any contract address or use /check &lt;CA&gt;');
      } else if (text.startsWith('/check ') || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text.replace(/\s+/g,'')) || /^0x[a-fA-F0-9]{40}$/.test(text.replace(/\s+/g,''))) {
        const address = text.replace('/check ', '').replace(/\s+/g, '').trim();
        await sendMsg(chatId, '🔍 scanning onchain...');
        try {
          const d = await checkToken(address);
          console.log('API response:', JSON.stringify(d).slice(0, 200));
          if (!d.dex) return sendMsg(chatId, '❌ No data found for this address.');
          await sendMsg(chatId, buildMessage(d, address));
        } catch(e) {
          await sendMsg(chatId, '❌ Error: ' + e.message);
        }
      }
    }
    offset = update.update_id + 1;
  }
  return poll(offset);
}

console.log('TrenchReads bot running...');
poll();