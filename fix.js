const fs = require('fs');
let c = fs.readFileSync('index.html', 'utf8');

// ── FIX 1: Cap score at 85 when freeze/honeypot data is unverified ──
c = c.replace(
  's = Math.max(0, Math.min(100, Math.round(s)));',
  `s = Math.max(0, Math.min(100, Math.round(s)));
  const missingCritical = (sec?.freezeAuth !== 'RISK' && sec?.freezeAuth !== 'safe') ||
                          (sec?.honeypot !== 'DETECTED' && sec?.honeypot !== 'none');
  if (missingCritical && s > 85) {
    s = 85;
    bd.push({ l: 'Incomplete Security Scan', p: 0, c: 'var(--yl)', n: 'freeze authority or honeypot status unconfirmed — score capped at 85 until verified' });
  }`
);

// ── FIX 2: Rename Liq/MCap → plain English "Rug Exit Risk" in calcScore ──
c = c.replace(
  "bd.push({ l: 'Dangerously Low Liq/MCap', p: -30, c: 'var(--rd)', n: `${r.toFixed(2)}% — insiders can dump with almost no resistance` })",
  "bd.push({ l: 'Rug Exit Risk — CRITICAL', p: -30, c: 'var(--rd)', n: `only ${r.toFixed(2)}% of mcap is liquid — insiders can exit without crashing their own bags. you cannot.` })"
);
c = c.replace(
  "bd.push({ l: 'Liq/MCap Ratio', p: -15, c: 'var(--rd)', n: `${r.toFixed(1)}% — rug risk` })",
  "bd.push({ l: 'Rug Exit Risk — HIGH', p: -15, c: 'var(--rd)', n: `${r.toFixed(1)}% — thin exit barrier. coordinated dump will wipe holders before they can react` })"
);
c = c.replace(
  "bd.push({ l: 'Liq/MCap Ratio', p: -8, c: 'var(--yl)', n: `${r.toFixed(1)}% — thin` })",
  "bd.push({ l: 'Rug Exit Risk', p: -8, c: 'var(--yl)', n: `${r.toFixed(1)}% — thin buffer. large sells will move price hard against you` })"
);
c = c.replace(
  "bd.push({ l: 'Liq/MCap Ratio', p: 0, c: 'var(--gr)', n: `${r.toFixed(1)}% — ${r > 10 ? 'healthy' : 'ok'}` })",
  "bd.push({ l: 'Rug Exit Risk', p: 0, c: 'var(--gr)', n: `${r.toFixed(1)}% — ${r > 10 ? 'healthy. hard to rug' : 'acceptable — monitor large wallets'}` })"
);
c = c.replace(
  "bd.push({ l: 'Liq/MCap Ratio', p: -5, c: 'var(--mu)', n: 'no data' })",
  "bd.push({ l: 'Rug Exit Risk', p: -5, c: 'var(--mu)', n: 'no data — dump risk cannot be assessed' })"
);

// ── FIX 3: Add Rug Exit Risk as a visible FLAG (not just score breakdown) ──
c = c.replace(
  '  // WARNINGS\n  const st = sec?.sellTax',
  `  // RUG EXIT RISK FLAG
  if (liq > 0 && mcap > 0) {
    const rugRatio = (liq / mcap) * 100;
    if (rugRatio < 1 && vol > 100)
      flags.push({ ic: '🔴', t: \`Rug Exit Risk — \${rugRatio.toFixed(2)}% Liq/MCap\`, tc: 'rd', d: \`Only \${rugRatio.toFixed(2)}% of the market cap sits in the liquidity pool. In plain terms: insiders holding large bags can dump everything and still get a decent exit price. You — a smaller holder — will be left with massive slippage or no exit at all.\`, sev: 3 });
    else if (rugRatio < 3 && vol > 100)
      flags.push({ ic: '🟡', t: \`Low Rug Buffer — \${rugRatio.toFixed(1)}% Liq/MCap\`, tc: 'yl', d: \`\${rugRatio.toFixed(1)}% liq/mcap means the liquidity cushion is thin. Big wallet holders can exit faster than you. If whales sell, the price drops sharply before you can react.\`, sev: 2 });
  }

  // WARNINGS
  const st = sec?.sellTax`
);

// ── FIX 4: Rename HTML label "Liq / MCap" to "Rug Exit Risk" ──
c = c.replace(
  '<div class="dk">Liq / MCap</div>',
  '<div class="dk">Rug Exit Risk</div>'
);

// ── FIX 5: Improve badge labels for rug exit risk row ──
c = c.replace(
  "r < 1 ? 'rug risk' : r < 3 ? 'thin' : 'healthy'",
  "r < 1 ? 'DANGER' : r < 3 ? 'low buffer' : 'healthy'"
);

fs.writeFileSync('index.html', c);
console.log('All fixes applied.');