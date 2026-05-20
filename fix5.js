const fs = require('fs');

// ── FIX INDEX.HTML ──
let h = fs.readFileSync('index.html', 'utf8');

h = h.replace(
  `S.sc = calcScore(S.dex, S.sec);
    S.sc.score = r.score ?? S.sc.score;
    if (S.sc.score >= 70) { S.sc.verdict = 'RELATIVELY SAFE'; S.sc.cls = 'safe'; }
    else if (S.sc.score >= 45) { S.sc.verdict = 'PROCEED WITH CAUTION'; S.sc.cls = 'caution'; }
    else { S.sc.verdict = 'HIGH RISK — AVOID'; S.sc.cls = 'danger'; }
    S.flags = buildFlags(S.dex, S.sec, S.sc);`,
  `S.sc = calcScore(S.dex, S.sec);
    S.sc.score = r.score ?? S.sc.score;
    const _rugRatio = (S.dex?.liquidity > 0 && S.dex?.mcap > 0) ? (S.dex.liquidity / S.dex.mcap) * 100 : 999;
    const _criticalRug = _rugRatio < 1;
    if (S.sc.score >= 70 && !_criticalRug) { S.sc.verdict = 'RELATIVELY SAFE'; S.sc.cls = 'safe'; }
    else if (S.sc.score >= 70 && _criticalRug) { S.sc.verdict = 'PROCEED WITH CAUTION'; S.sc.cls = 'caution'; }
    else if (S.sc.score >= 45) { S.sc.verdict = 'PROCEED WITH CAUTION'; S.sc.cls = 'caution'; }
    else { S.sc.verdict = 'HIGH RISK — AVOID'; S.sc.cls = 'danger'; }
    S.flags = buildFlags(S.dex, S.sec, S.sc);`
);

fs.writeFileSync('index.html', h);
console.log('index.html done');

// ── FIX TELEGRAM BOT ──
let b = fs.readFileSync('telegram-bot.js', 'utf8');

b = b.replace(
  `  const verdict = score >= 70 ? '🟢 RELATIVELY SAFE'
    : score >= 45 ? '🟡 PROCEED WITH CAUTION'
    : '🔴 HIGH RISK — AVOID';`,
  `  const rugRatio = (dex.liquidity > 0 && dex.mcap > 0) ? (dex.liquidity / dex.mcap) * 100 : 999;
  const criticalRug = rugRatio < 1;
  const verdict = score >= 70 && !criticalRug ? '🟢 RELATIVELY SAFE'
    : score >= 70 && criticalRug ? '🟡 PROCEED WITH CAUTION — critical rug exit risk'
    : score >= 45 ? '🟡 PROCEED WITH CAUTION'
    : '🔴 HIGH RISK — AVOID';`
);

fs.writeFileSync('telegram-bot.js', b);
console.log('telegram-bot.js done');