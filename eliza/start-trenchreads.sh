#!/bin/bash
cd ~/trenchreads/eliza
sed -i 's/maxTokens = 8192/maxTokens = 1024/g' node_modules/@elizaos/plugin-redpill/dist/index.js
sed -i 's/const max_response_length = 8192/const max_response_length = 1024/g' node_modules/@elizaos/plugin-redpill/dist/index.js
node /tmp/fix2.js
node /tmp/debug-patch.js
node /tmp/debug2.js
pkill -f "node rugcheck" 2>/dev/null; sleep 1
node rugcheck-proxy.cjs &
echo "Rugcheck proxy started"
NODE_TLS_REJECT_UNAUTHORIZED=0 bun run --ignore-scripts packages/cli/src/index.ts start --character="characters/trenchreads.character.json"
