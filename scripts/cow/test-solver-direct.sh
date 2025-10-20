#!/usr/bin/env bash
set -euo pipefail

# Direct solver testing without CoW infrastructure
# This lets you test your solver immediately

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SOLVER_URL="${SOLVER_URL:-http://localhost:8000}"

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         CoW Protocol Solver - Direct Testing                  ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if solver is running
echo -e "${YELLOW}🔍 Checking if solver is running...${NC}"
if ! curl -f -s "$SOLVER_URL/health" > /dev/null 2>&1; then
    echo -e "${RED}❌ Solver not running at $SOLVER_URL${NC}"
    echo ""
    echo "Start your solver first:"
    echo "  node build/cow/index.js"
    exit 1
fi

echo -e "${GREEN}✅ Solver is running${NC}"
echo ""

# Test 1: Health Check
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Test 1: Health Check${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
curl -s "$SOLVER_URL/health" | jq '.'
echo ""

# Test 2: Metrics
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Test 2: Metrics Endpoint${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
curl -s "$SOLVER_URL/metrics" | jq '{
  totalAuctions,
  successfulSolves,
  winRate,
  avgSolveTimeMs,
  totalSurplusGenerated,
  uptime
}'
echo ""

# Test 3: Simple Order (WETH -> USDC)
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Test 3: Solve Simple Order (1 WETH → USDC)${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

AUCTION_ID="test-$(date +%s)"
cat > /tmp/cow-auction-$AUCTION_ID.json << 'EOF'
{
  "id": "AUCTION_ID_PLACEHOLDER",
  "tokens": {
    "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": {
      "decimals": 18,
      "symbol": "WETH",
      "referencePrice": "3000000000",
      "availableBalance": "1000000000000000000000",
      "trusted": true
    },
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": {
      "decimals": 6,
      "symbol": "USDC",
      "referencePrice": "1000000",
      "availableBalance": "10000000000000",
      "trusted": true
    }
  },
  "orders": [
    {
      "uid": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678",
      "sellToken": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      "buyToken": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "sellAmount": "1000000000000000000",
      "buyAmount": "2900000000",
      "feeAmount": "10000000000000000",
      "kind": "sell",
      "partiallyFillable": false,
      "class": "market",
      "appData": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "signingScheme": "eip712",
      "signature": "0x",
      "owner": "0x0000000000000000000000000000000000000001",
      "validTo": 9999999999,
      "sellTokenBalance": "erc20",
      "buyTokenBalance": "erc20"
    }
  ],
  "liquidity": [],
  "effectiveGasPrice": "30000000000",
  "deadline": "2099-12-31T23:59:59.000Z",
  "surplusCapturingJitOrderOwners": []
}
EOF

# Replace auction ID
sed -i.bak "s/AUCTION_ID_PLACEHOLDER/$AUCTION_ID/" /tmp/cow-auction-$AUCTION_ID.json

echo "Sending auction to solver..."
RESPONSE=$(curl -s -X POST "$SOLVER_URL/solve" \
  -H "Content-Type: application/json" \
  -d @/tmp/cow-auction-$AUCTION_ID.json)

if echo "$RESPONSE" | jq . > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Valid JSON response received${NC}"
    echo ""
    echo "$RESPONSE" | jq '.'
    
    SOLUTION_COUNT=$(echo "$RESPONSE" | jq '.solutions | length' 2>/dev/null || echo "0")
    if [ "$SOLUTION_COUNT" -gt 0 ]; then
        echo ""
        echo -e "${GREEN}✅ Solver found $SOLUTION_COUNT solution(s)!${NC}"
        echo ""
        echo -e "${YELLOW}Solution Details:${NC}"
        echo "$RESPONSE" | jq '.solutions[0] | {
          id,
          score,
          clearingPrices,
          trades: (.trades | length),
          interactions: (.interactions | length)
        }'
    else
        echo ""
        echo -e "${YELLOW}⚠️  No solutions found${NC}"
        echo "   This could be normal if:"
        echo "   - Liquidity is insufficient"
        echo "   - Gas costs exceed potential surplus"
        echo "   - Order constraints cannot be satisfied"
    fi
else
    echo -e "${RED}❌ Invalid response from solver${NC}"
    echo "$RESPONSE"
fi

# Cleanup
rm -f /tmp/cow-auction-$AUCTION_ID.json /tmp/cow-auction-$AUCTION_ID.json.bak

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Testing Complete!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}📊 Monitor your solver:${NC}"
echo "  Health:    curl $SOLVER_URL/health | jq"
echo "  Metrics:   curl $SOLVER_URL/metrics | jq"
echo "  WebSocket: wscat -c ws://localhost:8000/solver-ws"
echo ""
echo -e "${YELLOW}📚 Next steps:${NC}"
echo "  1. Tune GA parameters in src/engines/GeneticRouterEngine.ts"
echo "  2. Test with different order sizes and token pairs"
echo "  3. For real CoW orderflow, you need to build the services (takes 10-15 min):"
echo "     cd /Users/mitch/cow-services && cargo build --release --bin autopilot --bin driver"
echo ""

