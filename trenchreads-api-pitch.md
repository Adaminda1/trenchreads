# TrenchReads Verdict API — One-Page Pitch

**For: Bot developers, KOL tools, trading dashboards**
**Contact: @Web3Abdull on Telegram · @ADAMINDA_1 on X**

---

## What it is

TrenchReads is a Solana + EVM token risk scanner used by traders who want onchain facts, not hype.

The **Verdict API** lets your bot or tool call our scoring engine directly — so you get a battle-tested risk score, AI verdict, and security flags without building your own pipeline.

One POST request. JSON back. Done.

---

## What you get per call

```json
{
  "score": 34,
  "risk_level": "HIGH",
  "verdict": "HIGH RISK – AVOID",
  "ai_verdict": "Only 0.34% of mcap sits in liquidity — insiders can exit clean while you're left with slippage. Avoid.",
  "flags": [
    "Rug Exit Risk 0.34% Liq/MCap",
    "Mintable Supply",
    "Transfers Pausable"
  ],
  "positives": ["Open Source Verified"],
  "liq_mcap_ratio": 0.34,
  "token": {
    "name": "RaveDAO",
    "symbol": "RAVE",
    "liquidity": 286900,
    "market_cap": 83170000,
    "volume_24h": 541700,
    "holders": 12400,
    "age_days": 200
  },
  "security": {
    "honeypot": false,
    "mint_revoked": false,
    "freeze_disabled": true,
    "open_source": true,
    "sell_tax": "0",
    "top10_holder_pct": "42.1"
  },
  "chain": "evm",
  "usage": {
    "calls_today": 1,
    "daily_limit": 2000,
    "remaining": 1999,
    "tier": "builder"
  }
}
```

---

## How to call it

```bash
curl -X POST https://trenchreads.vercel.app/api/v1/verdict \
  -H "Content-Type: application/json" \
  -H "X-API-Key: tr_api_yourkey" \
  -d '{"address": "0x17205fab260a7a6383a81452cE6315A39370Db97"}'
```

Works with any Solana or EVM address. Chain auto-detected.

---

## Pricing

| Tier        | Price     | Calls/day | Best for                          |
|-------------|-----------|-----------|-----------------------------------|
| **Free**    | $0        | 50        | Testing & integration             |
| **Builder** | $29/mo    | 2,000     | Small bots, personal tools        |
| **Growth**  | $79/mo    | 10,000    | Active community bots             |
| **Scale**   | $199/mo   | 50,000    | High-volume dashboards & tools    |

Overage on Scale: $0.015–0.02 per call above limit.
All plans: monthly, cancel anytime. Payment in USDC on Solana.

---

## Why TrenchReads vs building your own

- **Liq/MCap ratio** — the primary rug detection signal most tools miss
- **Groq AI verdict** — plain English buy/avoid call on every token
- **Dual-chain** — same endpoint handles Solana + Ethereum/BSC/Polygon
- **Already battle-tested** — scoring engine tuned on real rugs, not theory
- **No infra to maintain** — we handle DexScreener, GoPlus, Helius, Groq

---

## Integration takes ~10 minutes

```javascript
// Node.js example
const res  = await fetch('https://trenchreads.vercel.app/api/v1/verdict', {
  method:  'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': 'tr_api_yourkey' },
  body:    JSON.stringify({ address: tokenCA }),
});
const data = await res.json();

// data.score        → 0–95
// data.risk_level   → LOW | MEDIUM | HIGH
// data.ai_verdict   → plain English call
// data.flags        → array of red flags
// data.liq_mcap_ratio → rug exit signal
```

---

## Get started

DM **@Web3Abdull** on Telegram or **@ADAMINDA_1** on X with:
- What you're building
- Estimated daily call volume
- Preferred tier

Free API key issued same day. Builder+ keys after first payment.

**checked onchain, not on vibes — trenchreads.vercel.app**