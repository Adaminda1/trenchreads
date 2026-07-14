import 'dotenv/config';
import { setupDB, isTelegramPro, checkTelegramFreeLimit, activateTelegramPro } from './db.js';

const TOKEN = process.env.TELEGRAM_TOKEN;
const API   = 'https://trenchreads.vercel.app/api/check';
const BOT   = `https://api.telegram.org/bot${TOKEN}`;

// ── Format helpers ─────────────────────────────────────────────────────────
function f(n) {
  if (!n || isNaN(n)) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Number(n).toFixed(0);
}

// ── Telegram API helpers ───────────────────────────────────────────────────
async function sendMsg(chatId, text, extra = {}) {
  await fetch(`${BOT}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...extra })
  });
}

async function sendTyping(chatId) {
  await fetch(`${BOT}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' })
  });
}

// ── Token check ────────────────────────────────────────────────────────────
async function checkToken(address, proKey) {
  const body = { ca: address };
  if (proKey) body.proKey = proKey;
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  try { return JSON.parse(text); }
  catch (e) { throw new Error('API error: ' + text.slice(0, 100)); }
}

// ── Build result message ───────────────────────────────────────────────────
// Uses the SAME field names and SAME scoring output as the web frontend (api/check.js)
function buildMessage(d, address, isPro) {
  const dex   = d.dex || {};
  const sec   = d.sec || {};
  const score = d.score ?? 0;
  const verdict = d.verdict || 'UNKNOWN';
  const cls     = d.cls || 'warn';
  const breakdown = d.breakdown || [];
  const ai      = d.ai || null;

  const liq  = dex.liquidity || 0;
  const mcap = dex.marketCap || 0;
  const vol  = dex.volume24h || 0;
  const buys  = dex.txns24h?.buys  || 0;
  const sells = dex.txns24h?.sells || 0;

  const rugRatio    = (liq > 0 && mcap > 0) ? (liq / mcap) * 100 : null;
  const verdictEmoji = cls === 'safe' ? '🟢' : cls === 'warn' ? '🟡' : '🔴';

  // Rug ratio line
  let rugLine = '';
  if (rugRatio !== null) {
    const r = rugRatio.toFixed(2);
    if (rugRatio < 1)      rugLine = `\n🔴 <b>Severe Rug Risk — ${r}%</b>\nInsiders can dump and still exit clean. You may not.`;
    else if (rugRatio < 3) rugLine = `\n🟡 High Rug Risk (${r}%) — thin cushion, watch whale wallets`;
    else                   rugLine = `\n✅ Rug Risk: ${r}% — ${rugRatio > 10 ? 'healthy' : 'acceptable'}`;
  }

  // Flags — derived from breakdown (same source as web UI)
  const negFlags = breakdown.filter(b => b.p < 0).map(b => `🔴 ${b.l}`);
  const posFlags = breakdown.filter(b => b.p > 0).map(b => `✅ ${b.l}`);
  const flags = [...negFlags, ...posFlags];
  if (!flags.length) flags.push('⚠️ Limited security data — check manually');

  const age = dex.createdAt
    ? (() => {
        const ms = Date.now() - dex.createdAt;
        const d_ = Math.floor(ms / 86400000);
        const h_ = Math.floor(ms / 3600000);
        return d_ >= 1 ? `${d_}d` : `${h_}h`;
      })()
    : '?';

  const top10    = sec.top10HolderPct ? sec.top10HolderPct + '%' : 'n/a';
  const proBadge = isPro ? ' <b>[PRO]</b>' : '';

  // Top holders list (pro only — matches web UI holders section)
  let holdersLine = '';
  if (isPro && sec.topHolders?.length > 0) {
    const list = sec.topHolders.slice(0, 5).map((h, i) =>
      `${i + 1}. ${h.address.slice(0, 4)}...${h.address.slice(-4)} — ${h.pct}%${h.tag ? ` (${h.tag})` : ''}`
    ).join('\n');
    holdersLine = `\n\n<b>TOP HOLDERS:</b>\n${list}`;
  }

  // Sell tax line (pro only)
  const taxLine = isPro && sec.sellTax && parseFloat(sec.sellTax) > 0
    ? `Sell Tax: ${sec.sellTax}% | `
    : '';

  // Creator holdings (pro only)
  const devLine = isPro && sec.creatorPct
    ? `\nDev Holdings: ${sec.creatorPct}%`
    : '';

  // AI verdict (pro feature — the differentiator)
  const aiLine = isPro && ai
    ? `\n\n🤖 <b>AI VERDICT:</b>\n<i>${ai}</i>`
    : '';

  const buySellLine = (buys > 0 || sells > 0)
    ? `\n🔄 24h Txns: ${buys} buys / ${sells} sells`
    : '';

  return (
    `<b>#TrenchReads${proBadge} — $${dex.symbol || address.slice(0, 8)}</b>\n` +
    `checked onchain, not on vibes\n\n` +
    `<b>RISK SCORE: ${score}/100</b>\n` +
    `${verdictEmoji} ${verdict}` +
    `${rugLine}\n\n` +
    `<b>FLAGS:</b>\n${flags.join('\n')}\n\n` +
    `<b>MARKET:</b>\n` +
    `💰 Liquidity: $${f(liq)}\n` +
    `📊 MCap: $${f(mcap)}\n` +
    `📈 24h Vol: $${f(vol)}${buySellLine}\n` +
    `🕐 Age: ${age}\n` +
    `👥 Top 10 holders: ${top10}${devLine}` +
    `${holdersLine}\n\n` +
    `<b>CONTRACT:</b>\n` +
    `${taxLine}Mint: ${sec.mintAuthority ? 'ACTIVE ⚠' : 'Revoked ✅'} | Freeze: ${sec.freezeAuthority ? 'ACTIVE ⚠' : 'Revoked ✅'}\n` +
    `Honeypot: ${sec.isHoneypot ? 'DETECTED 🔴' : 'Clean ✅'}` +
    `${aiLine}\n\n` +
    `CA: <code>${address}</code>\n` +
    `🔗 <a href="https://trenchreads.vercel.app">trenchreads.vercel.app</a>`
  );
}

// ── /start message ─────────────────────────────────────────────────────────
function startMessage() {
  return (
    `🔍 <b>TrenchReads Bot</b>\n\n` +
    `checked onchain, not on vibes\n\n` +
    `<b>Commands:</b>\n` +
    `/check &lt;address&gt; — scan any token\n` +
    `/activate &lt;tr_key&gt; — unlock pro access\n` +
    `/status — check your pro status\n` +
    `/help — show this menu\n\n` +
    `<b>Free tier:</b> 1 scan/day, core risk score\n` +
    `<b>Pro tier:</b> unlimited scans + AI verdict + top holder list + dev holdings + tax breakdown\n\n` +
    `Get pro at trenchreads.vercel.app (5 USDC one-time)`
  );
}

// ── /activate handler ──────────────────────────────────────────────────────
async function handleActivate(chatId, args) {
  const key = args.trim();

  if (!key || !key.startsWith('tr_')) {
    return sendMsg(chatId,
      `⚠️ <b>Invalid key format.</b>\n\n` +
      `Usage: <code>/activate tr_yourkey</code>\n\n` +
      `Get your pro key at trenchreads.vercel.app`
    );
  }

  await sendMsg(chatId, '🔄 Verifying your pro key…');

  const result = await activateTelegramPro(chatId, key);

  if (!result.success) {
    return sendMsg(chatId,
      `❌ <b>Activation failed.</b>\n\n` +
      `${result.error}\n\n` +
      `If you just paid, wait 30 seconds and try again.\n` +
      `Need help? DM @Web3Abdull`
    );
  }

  return sendMsg(chatId,
    `✅ <b>Pro access activated!</b>\n\n` +
    `Your account is now linked to your pro key.\n` +
    `You have <b>unlimited scans</b> + AI verdict + top holders + dev holdings.\n\n` +
    `Send any token address to scan it.\n` +
    `checked onchain, not on vibes 🔍`
  );
}

// ── /status handler ────────────────────────────────────────────────────────
async function handleStatus(chatId) {
  const isPro = await isTelegramPro(chatId);
  if (isPro) {
    return sendMsg(chatId,
      `✅ <b>Pro Status: Active</b>\n\n` +
      `Unlimited scans enabled.\n` +
      `AI verdict: ON\n` +
      `Top holders list: ON\n` +
      `Dev holdings: ON\n\n` +
      `checked onchain, not on vibes 🔍`
    );
  }
  return sendMsg(chatId,
    `🆓 <b>Free Tier Active</b>\n\n` +
    `Upgrade to pro for unlimited scans + AI verdict + top holders.\n\n` +
    `Get your key at trenchreads.vercel.app (5 USDC one-time)\n` +
    `Then run: <code>/activate tr_yourkey</code>`
  );
}

// ── Main scan handler ──────────────────────────────────────────────────────
async function handleScan(chatId, address) {
  const isPro = await isTelegramPro(chatId);

  if (!isPro) {
    const limit = await checkTelegramFreeLimit(chatId);
    if (!limit.allowed) {
      return sendMsg(chatId,
        `⛔ <b>Daily limit reached (1/1 scans used)</b>\n\n` +
        `Upgrade to pro for unlimited scans.\n\n` +
        `🔗 Get your key at trenchreads.vercel.app (5 USDC one-time)\n` +
        `Then run: <code>/activate tr_yourkey</code>\n\n` +
        `Limit resets at midnight UTC.`
      );
    }
    if (limit.remaining === 0) {
      await sendMsg(chatId, `⚠️ This is your last free scan today. Upgrade at trenchreads.vercel.app`);
    }
  }

  await sendTyping(chatId);
  await sendMsg(chatId, '🔍 scanning onchain…');

  try {
    const d = await checkToken(address, null);
    if (d?.error) {
      return sendMsg(chatId, `❌ ${d.error}`);
    }
    if (!d || (!d.dex && d.score === undefined)) {
      return sendMsg(chatId, '❌ No data found for this address. Double-check the contract address.');
    }
    await sendMsg(chatId, buildMessage(d, address, isPro));

    if (!isPro) {
      await sendMsg(chatId,
        `💡 <b>Unlock Pro</b> for unlimited scans + AI verdict + top holder list + dev holdings.\n` +
        `5 USDC one-time → trenchreads.vercel.app`
      );
    }
  } catch (e) {
    await sendMsg(chatId, `❌ Error: ${e.message}`);
  }
}

// ── Message router ─────────────────────────────────────────────────────────
async function handleMessage(msg) {
  if (!msg?.text) return;
  const chatId = msg.chat.id;
  const text   = msg.text.trim();

  if (text === '/start' || text === '/help') {
    return sendMsg(chatId, startMessage());
  }

  if (text.startsWith('/activate')) {
    const args = text.replace('/activate', '').trim();
    return handleActivate(chatId, args);
  }

  if (text === '/status') {
    return handleStatus(chatId);
  }

  const address = text.startsWith('/check ')
    ? text.replace('/check ', '').trim()
    : text;

  const isSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  const isEVM    = /^0x[a-fA-F0-9]{40}$/i.test(address);

  if (isSolana || isEVM) {
    return handleScan(chatId, address);
  }

  await sendMsg(chatId,
    `❓ Send a token contract address to scan it, or type /help to see commands.`
  );
}

// ── Polling loop ───────────────────────────────────────────────────────────
async function poll(offset = 0) {
  const r    = await fetch(`${BOT}/getUpdates?offset=${offset}&timeout=30`);
  const data = await r.json();
  for (const update of data.result || []) {
    try { await handleMessage(update.message); }
    catch (e) { console.error('[update error]', e.message); }
    offset = update.update_id + 1;
  }
  return poll(offset);
}

// ── Tiny HTTP server (keeps Render free tier alive) ───────────────────────
import http from 'http';
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('TrenchReads bot is running ✅');
}).listen(PORT, () => console.log(`HTTP keepalive server on port ${PORT}`));

// ── Boot ───────────────────────────────────────────────────────────────────
async function start() {
  await setupDB();
  console.log('✅ TrenchReads bot running — synced with web scoring engine');
  while (true) {
    try { await poll(); }
    catch (e) {
      console.error('Bot crashed, restarting in 5s:', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

start();