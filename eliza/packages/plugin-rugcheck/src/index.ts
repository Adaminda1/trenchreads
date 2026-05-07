import { Plugin, Action, IAgentRuntime, Memory, State } from "@elizaos/core";

const SOLANA_ADDRESS_REGEX = /[1-9A-HJ-NP-Za-km-z]{32,44}/;

const rugcheckAction: Action = {
  name: "RUGCHECK",
  similes: ["CHECK_CONTRACT", "ANALYZE_TOKEN", "SCAN_CONTRACT"],
  description: "Analyzes a Solana token contract using Rugcheck API",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = message.content.text || "";
    return SOLANA_ADDRESS_REGEX.test(text);
  },
  handler: async (_runtime: IAgentRuntime, message: Memory, _state: State, _options: any, callback: any) => {
    const text = message.content.text || "";
    const match = text.match(SOLANA_ADDRESS_REGEX);
    if (!match) return;
    const address = match[0];

    try {
      const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${address}/report/summary`);
      const data = await res.json();

      const score = data.score ?? "unknown";
      const mint = data.tokenMeta?.name ?? address.slice(0, 8);
      const risks = data.risks ?? [];
      const topRisk = risks.length > 0 ? risks[0].description : "no major flags detected";

      const reply = `contract: ${mint}\nrisk score: ${score}/100\ntop flag: ${topRisk}\nliquidity: ${data.markets?.[0]?.lp?.lpLockedPct ?? "?"}% locked\nverdict: ${score > 700 ? "proceed with caution" : "high risk. verify before entry"}.\nchecked onchain not on vibes - TrenchReads.`;

      callback({ text: reply });
    } catch {
      callback({ text: `could not fetch data for ${address}. verify the contract manually on rugcheck.xyz. checked onchain not on vibes - TrenchReads.` });
    }
  },
  examples: []
};

export const rugcheckPlugin: Plugin = {
  name: "plugin-rugcheck",
  description: "Rugcheck contract analysis for TrenchReads",
  actions: [rugcheckAction],
};

export default rugcheckPlugin;