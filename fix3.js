const fs = require('fs');
let c = fs.readFileSync('api/check.mjs', 'utf8');

const oldFn = `function calculateScore(d) {`;
const newFn = `function calculateScore(d) {
  const dex = d.dex || {};
  const sec = d.sec || {};
  let s = 100;
  const liq = dex.liquidity ?? 0, mcap = dex.mcap ?? 0;
  const vol = dex.volume24h ?? 0, age = dex.ageDays;
  const buys = dex.buys24h ?? 0, sells = dex.sells24h ?? 0;

  // LIQUIDITY
  if (liq === 0) s -= 40;
  else if (liq < 1000) s -= 35;
  else if (liq < 5000) s -= 28;
  else if (liq < 20000) s -= 18;
  else if (liq < 50000) s -= 8;

  // RUG EXIT RISK
  if (liq > 0 && mcap > 0) {
    const r = (liq / mcap) * 100;
    if (r < 0.5) s -= 30;
    else if (r < 1 && vol > 100) s -= 15;
    else if (r < 3 && vol > 100) s -= 8;
  } else { s -= 5; }

  // TOKEN AGE
  if (age === null || age === undefined) s -= 5;
  else if (age < 1) s -= 15;
  else if (age < 3) s -= 10;
  else if (age < 7) s -= 5;

  // TRADING ACTIVITY
  if (buys === 0 && sells === 0 && liq > 0) s -= 30;
  else if (vol < 50 && liq > 0) s -= 20;
  else if (vol < 500) s -= 8;

  // SELL PRESSURE
  if (buys > 0 && sells > 0) {
    const ratio = sells / (buys + sells);
    if (ratio > 0.8) s -= 10;
    else if (ratio > 0.65) s -= 5;
  }

  // MICRO MCAP
  if (mcap > 0 && mcap < 5000) s -= 10;

  // MINT AUTHORITY
  if (sec.mintAuth === 'RISK') s -= 15;
  else if (!sec.mintAuth || sec.mintAuth === 'unknown') s -= 4;

  // FREEZE / HONEYPOT
  if (sec.freezeAuth === 'RISK') s -= 10;
  if (sec.honeypot === 'DETECTED') s -= 20;

  // HIDDEN FUNCTIONS
  if (sec.isBlacklisted === 'RISK') s -= 8;
  if (sec.transferPausable === 'RISK') s -= 8;
  if (sec.hiddenOwner === 'RISK') s -= 8;
  if (sec.canTakeBack === 'RISK') s -= 8;
  if (sec.isProxy === 'yes') s -= 5;

  // SELL TAX
  const st = sec.sellTax ? parseFloat(sec.sellTax) : 0;
  if (st > 10) s -= 10;
  else if (st > 5) s -= 5;

  // HOLDER CONCENTRATION
  const top10 = sec.top10HolderPct ? parseFloat(sec.top10HolderPct) : null;
  const creatorPct = sec.creatorPct ? parseFloat(sec.creatorPct) : null;
  if (top10 !== null) {
    if (top10 > 80) s -= 15;
    else if (top10 > 60) s -= 10;
    else if (top10 > 40) s -= 5;
  }
  if (creatorPct !== null && creatorPct > 10) s -= 10;
  else if (creatorPct !== null && creatorPct > 5) s -= 5;

  // SCORE CAP
  let final = Math.max(0, Math.min(100, Math.round(s)));
  const missingCritical = (sec.freezeAuth !== 'RISK' && sec.freezeAuth !== 'safe') ||
    (sec.honeypot !== 'DETECTED' && sec.honeypot !== 'none');
  if (missingCritical && final > 85) final = 85;
  return final;

  // DEAD CODE BELOW — replaced by above
  if (false) {`;

// Find and replace the entire old calculateScore function
const fnStart = c.indexOf('function calculateScore(d) {');
const fnEnd = c.indexOf('\n}', fnStart) + 2;
c = c.slice(0, fnStart) + newFn + '\n  }' + c.slice(fnEnd);

fs.writeFileSync('api/check.mjs', c);
console.log('done');