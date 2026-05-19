const fs = require('fs');
let c = fs.readFileSync('api/check.mjs', 'utf8');

const oldFn = `function calculateScore(d) {
  let s = 100;
  const liq = d.dex.liquidity || 0;
  const mcap = d.dex.mcap || 0;`;

const newFn = `function calculateScore(d) {
  const dex = d.dex || {};
  const sec = d.sec || {};
  let s = 100;
  const liq = dex.liquidity ?? 0, mcap = dex.mcap ?? 0;
  const vol = dex.volume24h ?? 0, age = dex.ageDays;
  const buys = dex.buys24h ?? 0, sells = dex.sells24h ?? 0;`;

const oldEnd = `  if (d.sec?.honeypot === 'DETECTED') s -= 40;
  if (d.sec?.mintAuth === 'RISK') s -= 20;
  if (d.sec?.hiddenOwner === 'RISK') s -= 15;
  if (d.sec?.isBlacklisted === 'RISK') s -= 15;
  if (d.sec?.transferPausable === 'RISK') s -= 10;
  if (d.sec?.canTakeBack === 'RISK') s -= 10;
  if (d.dex.ageDays !== null && d.dex.ageDays < 1) s -= 15;
  else if (d.dex.ageDays < 3) s -= 10;
  else if (d.dex.ageDays < 7) s -= 5;
  const sec = d.sec || {}; const missingCritical = (sec?.freezeAuth !== 'RISK' && sec?.freezeAuth !== 'safe')
    && (sec?.honeypot !== 'DETECTED' && sec?.honeypot !== 'none');
  let final = Math.max(0, Math.min(100, s));
  if (missingCritical && final > 85) final = 85;
  return final;
}`;

const newEnd = `  // LIQUIDITY already done above via liq checks

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

  // SECURITY
  if (sec.mintAuth === 'RISK') s -= 15;
  else if (!sec.mintAuth || sec.mintAuth === 'unknown') s -= 4;
  if (sec.freezeAuth === 'RISK') s -= 10;
  if (sec.honeypot === 'DETECTED') s -= 20;
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
  const missingCritical = (sec.freezeAuth !== 'RISK' && sec.freezeAuth !== 'safe') ||
    (sec.honeypot !== 'DETECTED' && sec.honeypot !== 'none');
  let final = Math.max(0, Math.min(100, Math.round(s)));
  if (missingCritical && final > 85) final = 85;
  return final;
}`;

c = c.replace(oldFn, newFn).replace(oldEnd, newEnd);
fs.writeFileSync('api/check.mjs', c);
console.log('done');