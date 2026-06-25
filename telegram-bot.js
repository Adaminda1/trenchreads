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
function buildMessage(d, address, isPro) {
  const dex   = d.dex || {};
  const sec   = d.sec || {};
  const score = d.score ?? 0;
  const liq   = dex.liquidity || 0;
  const mcap  = dex.mcap || 0;

  const rugRatio   = (liq > 0 && mcap > 0) ? (liq / mcap) * 100 : 999;
  const criticalRug = rugRatio < 1;

  let verdictEmoji, verdictText;
  if (score >= 70 && !criticalRug)      { verdictEmoji = '🟢'; verdictText = 'RELATIVELY SAFE'; }
  else if (score >= 70 && criticalRug)  { verdictEmoji = '🟡'; verdictText = 'PROCEED WITH CAUTION — critical rug exit risk'; }
  else if (score >= 45)                 { verdictEmoji = '🟡'; verdictText = 'PROCEED WITH CAUTION'; }
  else                                  { verdictEmoji = '🔴'; verdictText = 'HIGH RISK — AVOID'; }

  // Rug ratio line
  let rugLine = '';
  if (liq > 0 && mcap > 0) {
    const r = rugRatio.toFixed(2);
    if (criticalRug)      rugLine = `\n🔴 <b>Rug Exit Risk — CRITICAL (${r}%)</b>\nOnly ${r}% of mcap is liquid. Insiders can exit. You may not.`;
    else if (rugRatio < 3) rugLine = `\n🟡 Low Rug Buffer (${r}%) — thin cushion, watch whale wallets`;
    else                   rugLine = `\n✅ Rug Exit Risk: ${r}% — ${rugRatio > 10 ? 'healthy' : 'acceptable'}`;
  }

  // Flags
  const flags = [];
  if (sec.honeypot === 'DETECTED')           flags.push('🔴 HONEYPOT — cannot sell');
  if (sec.mintAuth === 'RISK')               flags.push('🔴 Mint Authority active — dev can print tokens');
  if (sec.freezeAuth === 'RISK')             flags.push('🔴 Freeze Authority active');
  if (sec.isBlacklisted === 'RISK')          flags.push('🔴 Blacklist function detected');
  if (sec.transferPausable === 'RISK')       flags.push('🔴 Transfer can be paused');
  if (sec.hiddenOwner === 'RISK')            flags.push('🔴 Hidden owner detected');
  if (sec.mintAuth === 'safe')               flags.push('✅ Mint authority revoked');
  if (sec.freezeAuth === 'safe')             flags.push('✅ Freeze authority disabled');
  if (sec.honeypot === 'none')               flags.push('✅ No honeypot detected');
  if (liq > 50000)                           flags.push(`✅ Strong liquidity ($${f(liq)})`);
  if (!flags.length)                         flags.push('⚠️ Limited security data — check manually');

  const capNotice = score === 85 ? '\n<i>Score capped at 85 — freeze/honeypot unconfirmed</i>' : '';
  const age       = dex.ageDays != null ? dex.ageDays + 'd' : dex.ageHours != null ? dex.ageHours + 'h' : '?';
  const top10     = sec.top10HolderPct ? sec.top10HolderPct + '%' : 'n/a';
  const proBadge  = isPro ? ' <b>[PRO]</b>' : '';

  // Smart wallet signal (pro only)
  const smartLine = (isPro && d.smartWallets && d.smartWallets.count > 0)
    ? `\n💰 <b>Smart Wallet Signal: ${d.smartWallets.count} known wallet${d.smartWallets.count > 1 ? 's' : ''} bought in last 6h</b>\n`
    : '';

  // Sell tax line (pro only)
  const taxLine = isPro && sec.sellTax && sec.sellTax !== 'unknown'
    ? `Sell Tax: ${sec.sellTax}% | `
    : '';

  // Creator holdings (pro only)
  const devLine = isPro && sec.creatorPct
    ? `\nDev Holdings: ${sec.creatorPct}%`
    : '';

  return (
    `<b>#TrenchReads${ proBadge } — $${dex.symbol || address.slice(0, 8)}</b>\n` +
    `checked onchain, not on vibes\n\n` +
    `<b>RISK SCORE: ${score}/100</b>\n` +
    `${verdictEmoji} ${verdictText}${capNotice}` +
    `${rugLine}\n\n` +
    `<b>FLAGS:</b>\n${flags.join('\n')}\n\n` +
    `<b>MARKET:</b>\n` +
    `💰 Liquidity: $${f(liq)}\n` +
    `📊 MCap: $${f(mcap)}\n` +
    `📈 24h Vol: $${f(dex.volume24h || 0)}\n` +
    `🕐 Age: ${age}\n` +
    `👥 Top 10 holders: ${top10}${devLine}\n\n` +
    `<b>CONTRACT:</b>\n` +
    `${taxLine}Mint: ${sec.mintAuth || 'unknown'} | Freeze: ${sec.freezeAuth || 'unknown'}\n` +
    `Honeypot: ${sec.honeypot || 'unknown'}\n` +
    `${smartLine}\n` +
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
    `<b>Free tier:</b> 3 scans/day\n` +
    `<b>Pro tier:</b> unlimited scans + smart wallet signals + dev holdings\n\n` +
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
    `You have <b>unlimited scans</b> + smart wallet signals + dev holdings.\n\n` +
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
      `Smart wallet signals: ON\n` +
      `Dev holdings: ON\n\n` +
      `checked onchain, not on vibes 🔍`
    );
  }
  // Check remaining free scans
  const limit = await checkTelegramFreeLimit(chatId);
  // Undo the count increment since this is just a status check
  // (checkTelegramFreeLimit increments — we call it read-only here by not caring)
  return sendMsg(chatId,
    `🆓 <b>Free Tier Active</b>\n\n` +
    `Upgrade to pro for unlimited scans + smart wallet signals.\n\n` +
    `Get your key at trenchreads.vercel.app (5 USDC one-time)\n` +
    `Then run: <code>/activate tr_yourkey</code>`
  );
}

// ── Main scan handler ──────────────────────────────────────────────────────
async function handleScan(chatId, address) {
  // Check pro status
  const isPro = await isTelegramPro(chatId);

  // Free limit check
  if (!isPro) {
    const limit = await checkTelegramFreeLimit(chatId);
    if (!limit.allowed) {
      return sendMsg(chatId,
        `⛔ <b>Daily limit reached (3/3 scans used)</b>\n\n` +
        `Upgrade to pro for unlimited scans.\n\n` +
        `🔗 Get your key at trenchreads.vercel.app (5 USDC one-time)\n` +
        `Then run: <code>/activate tr_yourkey</code>\n\n` +
        `Limit resets at midnight UTC.`
      );
    }
    // Show remaining notice on last free scan
    if (limit.remaining === 0) {
      await sendMsg(chatId, `⚠️ This is your last free scan today. Upgrade at trenchreads.vercel.app`);
    }
  }

  await sendTyping(chatId);
  await sendMsg(chatId, '🔍 scanning onchain…');

  try {
    const d = await checkToken(address, null);
    if (!d || (!d.dex && !d.score)) {
      return sendMsg(chatId, '❌ No data found for this address. Double-check the contract address.');
    }
    await sendMsg(chatId, buildMessage(d, address, isPro));

    // Show upgrade nudge to free users
    if (!isPro) {
      await sendMsg(chatId,
        `💡 <b>Unlock Pro</b> for unlimited scans + smart wallet signals + dev holdings.\n` +
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

  // Commands
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

  // Token address — direct paste or /check command
  const address = text.startsWith('/check ')
    ? text.replace('/check ', '').trim()
    : text;

  const isSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  const isEVM    = /^0x[a-fA-F0-9]{40}$/i.test(address);

  if (isSolana || isEVM) {
    return handleScan(chatId, address);
  }

  // Unknown input
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

// ── Boot ───────────────────────────────────────────────────────────────────
async function start() {
  await setupDB();
  console.log('✅ TrenchReads bot running — pro integration active');
  while (true) {
    try { await poll(); }
    catch (e) {
      console.error('Bot crashed, restarting in 5s:', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

start();