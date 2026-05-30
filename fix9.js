const fs = require('fs');
let h = fs.readFileSync('index.html', 'utf8');

// Add API key input and upgrade section to HTML
h = h.replace(
  '<div class="chains">supports',
  `<div id="keyBar" style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
  <input type="text" id="apiKey" placeholder="paste pro key (tr_...)" 
    style="flex:1;background:#0f0f0f;border:1px solid #1e1e1e;color:#e5e5e5;
    font-family:'Space Mono',monospace;font-size:10px;padding:8px 12px;outline:none"/>
  <button onclick="saveKey()" 
    style="background:transparent;border:1px solid #f97316;color:#f97316;
    padding:8px 14px;font-family:'Space Mono',monospace;font-size:9px;cursor:pointer">
    ACTIVATE
  </button>
</div>

<div id="upgradeBar" style="display:none;background:rgba(249,115,22,.06);
  border:1px solid rgba(249,115,22,.2);padding:14px 16px;margin-bottom:10px;font-size:10px">
  <div style="color:#f97316;font-weight:700;margin-bottom:6px">
    🔒 FREE LIMIT REACHED — 3/3 checks used today
  </div>
  <div style="color:#555;margin-bottom:10px;line-height:1.6">
    Upgrade to TrenchReads Pro for unlimited checks, full holder data, 
    contract security details and Telegram bot access.
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <a href="https://trenchreads.lemonsqueezy.com" target="_blank"
      style="background:#f97316;color:#000;padding:8px 16px;font-size:9px;
      font-weight:700;text-decoration:none;letter-spacing:1px">
      $7/MONTH — PAY BY CARD
    </a>
    <a href="https://trenchreads.vercel.app/#crypto" target="_blank"
      style="background:transparent;border:1px solid #f97316;color:#f97316;
      padding:8px 16px;font-size:9px;font-weight:700;text-decoration:none;letter-spacing:1px">
      PAY WITH CRYPTO
    </a>
  </div>
</div>

<div class="chains">supports`
);

// Add key functions to JS
h = h.replace(
  'let S = {};',
  `let S = {};
let PRO_KEY = localStorage.getItem('tr_key') || '';
if (PRO_KEY) document.getElementById('apiKey').value = PRO_KEY;

function saveKey() {
  const k = document.getElementById('apiKey').value.trim();
  if (k.startsWith('tr_')) {
    PRO_KEY = k;
    localStorage.setItem('tr_key', k);
    document.getElementById('apiKey').style.borderColor = 'var(--gr)';
    setTimeout(() => document.getElementById('apiKey').style.borderColor = '#1e1e1e', 2000);
  }
}`
);

// Update callProxy to send API key and handle limit
h = h.replace(
  "body: JSON.stringify({ address: ca }), signal: ctrl.signal });",
  "body: JSON.stringify({ address: ca, apiKey: PRO_KEY }), signal: ctrl.signal });"
);

h = h.replace(
  "if (j.error && !j.dex && !j.sec) throw new Error(j.error);",
  `if (j.error === 'free_limit_reached') {
      hideLoad();
      document.getElementById('upgradeBar').style.display = 'block';
      throw new Error(j.message);
    }
    if (j.error && !j.dex && !j.sec) throw new Error(j.error);`
);

fs.writeFileSync('index.html', h);
console.log('done');