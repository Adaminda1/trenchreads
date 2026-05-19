const fs = require('fs');
let c = fs.readFileSync('telegram-bot.js', 'utf8');

// Fix 1: wrap poll in crash-proof loop
c = c.replace(
  "console.log('TrenchReads bot running...');\npoll();",
  `console.log('TrenchReads bot running...');
async function start() {
  while (true) {
    try { await poll(); } 
    catch(e) { 
      console.error('Bot crashed, restarting in 5s:', e.message); 
      await new Promise(r => setTimeout(r, 5000)); 
    }
  }
}
start();`
);

// Fix 2: log API response for debugging
c = c.replace(
  "if (!d.dex) return sendMsg(chatId, '❌ No data found for this address.');",
  `console.log('API response:', JSON.stringify(d).slice(0, 200));
          if (!d.dex) return sendMsg(chatId, '❌ No data found for this address.');`
);

fs.writeFileSync('telegram-bot.js', c);
console.log('done');