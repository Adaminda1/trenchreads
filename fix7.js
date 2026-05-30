const fs = require('fs');

// ── UPDATE SITE (index.html) ──
let h = fs.readFileSync('index.html', 'utf8');

// Add smart wallet display to render() after the verdict card
h = h.replace(
  '  // Socials\n  const soc = dex?.socials;',
  `  // Smart Wallets
  if (S.smartWallets && S.smartWallets.count > 0) {
    const sw = S.smartWallets;
    const swEl = document.getElementById('smartWalletBar');
    if (swEl) {
      swEl.style.display = 'flex';
      document.getElementById('swCount').textContent = sw.count + ' known smart wallet' + (sw.count > 1 ? 's' : '') + ' bought this in the last 6h';
    }
  }

  // Socials
  const soc = dex?.socials;`
);

// Add smart wallet bar HTML after verdict card
h = h.replace(
  '  <!-- SOCIALS -->',
  `  <!-- SMART WALLETS -->
  <div id="smartWalletBar" style="display:none;align-items:center;gap:8px;padding:8px 14px;background:rgba(153,69,255,.08);border:1px solid rgba(153,69,255,.2);margin-bottom:2px;font-size:10px;">
    <span style="font-size:14px">👥</span>
    <span id="swCount" style="color:#9945ff;font-weight:700"></span>
    <span style="color:var(--mu);margin-left:auto">smart money signal</span>
  </div>

  <!-- SOCIALS -->`
);

// Store smartWallets on S
h = h.replace(
  'S.score = r.score ?? 0;',
  'S.score = r.score ?? 0;\n    S.smartWallets = r.smartWallets ?? null;'
);

fs.writeFileSync('index.html', h);
console.log('index.html done');

// ── UPDATE BOT ──
let b = fs.readFileSync('telegram-bot.js', 'utf8');

b = b.replace(
  "'CA: <code>' + address + '</code>\\n' +",
  `(d.smartWallets && d.smartWallets.count > 0 ? '\\n\\u{1F4B0} <b>Smart Wallet Signal: ' + d.smartWallets.count + ' known wallet' + (d.smartWallets.count > 1 ? 's' : '') + ' bought in last 6h</b>\\n' : '') +
    'CA: <code>' + address + '</code>\\n' +`
);

fs.writeFileSync('telegram-bot.js', b);
console.log('telegram-bot.js done');