# TrenchReads Agent 🔍

Onchain token risk analysis powered by Azure AI Foundry (Reasoning Agents track — Microsoft Agents League Hackathon 2026)

## What it does

TrenchReads Agent is a multi-step reasoning agent that analyzes any token contract address for risk. It reasons through 5 steps before delivering a verdict:

- **Step 1 — Contract Analysis:** Checks for dangerous functions (mint, blacklist, pause, proxy)
- **Step 2 — Liquidity Check:** Assesses liquidity depth and lock status via DexScreener
- **Step 3 — Holder Analysis:** Checks top holder concentration and team wallet holdings
- **Step 4 — Trading Pattern:** Detects honeypot signals and abnormal buy/sell tax
- **Step 5 — Final Verdict:** Scores token 0-100 with SAFE / CAUTION / DANGER verdict

## Tech Stack

- **Azure AI Foundry** — Agent orchestration and reasoning (Foundry IQ)
- **GPT-4.1-mini** — Reasoning model
- **DexScreener API** — Liquidity and trading data
- **GoPlus Security API** — Contract security analysis
- **Next.js + Tailwind CSS** — Frontend
- **Vercel** — Deployment

## Microsoft IQ Integration

This project uses **Foundry IQ** as the core intelligence layer for multi-step agent reasoning.

## Demo

Agent correctly identifies:
- USDT (0xdac17f...) → Risk Score 95/100 — SAFE
- Unknown tokens → DANGER verdict with reasoning

## Setup

1. Clone the repo
2. Create `.env.local` with your Azure credentials
3. Run `npm install && npm run dev`