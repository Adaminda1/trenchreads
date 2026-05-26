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
  const text = await r.text();
  try { return JSON.parse(text); }
  catch(e) { throw new Error('API error: ' + text.slice(0, 100)); }
}

function buildMessage(d, address) {
  const dex = d.dex || {};
  const sec = d.sec || {};
  const score = d.score ?? 0;
  const liq = dex.liquidity || 0;
  const mcap = dex.mcap || 0;

  const rugRatio = (liq > 0 && mcap > 0) ? (liq / mcap) * 100 : 999;
  const criticalRug = rugRatio < 1;

  let verdictIcon, verdictText;
  if (score >= 70 && !criticalRug) {
    verdictIcon = 'GREEN';
    verdictText = 'RELATIVELY SAFE';
  } else if (score >= 70 && criticalRug) {
    verdictIcon = 'YELLOW';
    verdictText = 'PROCEED WITH CAUTION - critical rug exit risk';
  } else if (score >= 45) {
    verdictIcon = 'YELLOW';
    verdictText = 'PROCEED WITH CAUTION';
  } else {
    verdictIcon = 'RED';
    verdictText = 'HIGH RISK - AVOID';
  }

  const verdictEmoji = verdictIcon === 'GREEN' ? '\u{1F7E2}' : verdictIcon === 'RED' ? '\u{1F534}' : '\u{1F7E1}';

  let rugLine = '';
  if (liq > 0 && mcap > 0) {
    const r = rugRatio.toFixed(2);
    if (criticalRug) rugLine = '\n\u{1F534} <b>Rug Exit Risk - CRITICAL (' + r + '%)</b>\nOnly ' + r + '% of mcap is liquid. Insiders can exit. You may not.';
    else if (rugRatio < 3) rugLine = '\n\u{1F7E1} Low Rug Buffer (' + r + '%) - thin cushion, watch whale wallets';
    else rugLine = '\n\u{2705} Rug Exit Risk: ' + r + '% - ' + (rugRatio > 10 ? 'healthy' : 'acceptable');
  }

  const flags = [];
  if (sec.honeypot === 'DETECTED') flags.push('\u{1F534} HONEYPOT - cannot sell');
  if (sec.mintAuth === 'RISK') flags.push('\u{1F534} Mint Authority active - dev can print tokens');
  if (sec.freezeAuth === 'RISK') flags.push('\u{1F534} Freeze Authority active');
  if (sec.isBlacklisted === 'RISK') flags.push('\u{1F534} Blacklist function detected');
  if (sec.transferPausable === 'RISK') flags.push('\u{1F534} Transfer can be paused');
  if (sec.hiddenOwner === 'RISK') flags.push('\u{1F534} Hidden owner detected');
  if (sec.mintAuth === 'safe') flags.push('\u{2705} Mint authority revoked');
  if (sec.honeypot === 'none') flags.push('\u{2705} No honeypot detected');
  if (!flags.length) flags.push('\u26A0\uFE0F Limited security data');

  const capNotice = (score === 85) ? '\n<i>Score capped at 85 - freeze/honeypot unconfirmed</i>' : '';
  const age = dex.ageDays != null ? dex.ageDays + 'd' : dex.ageHours != null ? dex.ageHours + 'h' : '?';
  const top10 = sec.top10HolderPct ? sec.top10HolderPct + '%' : 'n/a';

  return '<b>#TrenchReads - $' + (dex.symbol || address.slice(0,8)) + '</b>\n' +
    'checked onchain, not on vibes\n\n' +
    '<b>RISK SCORE: ' + score + '/100</b>\n' +
    verdictEmoji + ' ' + verdictText + capNotice +
    rugLine + '\n\n' +
    '<b>FLAGS:</b>\n' + flags.join('\n') + '\n\n' +
    '<b>MARKET:</b>\n' +
    '\u{1F4B0} Liquidity: $' + f(liq) + '\n' +
    '\u{1F4CA} MCap: $' + f(mcap) + '\n' +
    '\u{1F4C8} 24h Vol: $' + f(dex.volume24h || 0) + '\n' +
    '\u{1F550} Age: ' + age + '\n' +
    '\u{1F465} Top 10 holders: ' + top10 + '\n\n' +
    '<b>CONTRACT:</b>\n' +
    'Mint: ' + (sec.mintAuth || 'unknown') + ' | Freeze: ' + (sec.freezeAuth || 'unknown') + '\n' +
    'Honeypot: ' + (sec.honeypot || 'unknown') + '\n\n' +
    'CA: <code>' + address + '</code>\n' +
    'trenchreads.vercel.app';
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
        await sendMsg(chatId, '\u{1F50D} <b>TrenchReads Bot</b>\n\nchecked onchain, not on vibes\n\nSend any contract address to check it.');
      } else if (text.startsWith('/check ') || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text) || /^0x[a-fA-F0-9]{40}$/i.test(text)) {
        const address = text.replace('/check ', '').trim();
        await sendMsg(chatId, '\u{1F50D} scanning onchain...');
        try {
          const d = await checkToken(address);
          if (!d.dex) {
            await sendMsg(chatId, '\u274C No data found for this address.');
          } else {
            await sendMsg(chatId, buildMessage(d, address));
          }
        } catch(e) {
          await sendMsg(chatId, '\u274C Error: ' + e.message);
        }
      }
    }
    offset = update.update_id + 1;
  }
  return poll(offset);
}

async function start() {
  while (true) {
    try { await poll(); }
    catch(e) {
      console.error('Bot crashed, restarting in 5s:', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

console.log('TrenchReads bot running...');
start();