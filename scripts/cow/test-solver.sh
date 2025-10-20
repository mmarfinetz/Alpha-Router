#!/usr/bin/env bash
set -euo pipefail

# Quick test script to verify solver is working
# Tests the /solve endpoint with a mock auction

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

SOLVER_URL="${SOLVER_URL:-http://localhost:8000}"

echo -e "${GREEN}🧪 Testing CoW Solver...${NC}"
echo ""

# Test health endpoint
echo -e "${YELLOW}1. Testing health endpoint...${NC}"
if curl -f -s "$SOLVER_URL/health" > /dev/null; then
    echo -e "${GREEN}✅ Health check passed${NC}"
    curl -s "$SOLVER_URL/health" | jq .
else
    echo -e "${RED}❌ Health check failed${NC}"
    echo "   Make sure solver is running: node build/cow/index.js"
    exit 1
fi

echo ""
echo -e "${YELLOW}2. Testing /solve endpoint with mock auction...${NC}"

# Mock auction data (minimal)
MOCK_AUCTION='{
  "id": "test-auction-' "$(date +%s)" '",
  "tokens": {
    "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": {
      "decimals": 18,
      "symbol": "WETH",
      "available": "1000000000000000000000"
    },
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": {
      "decimals": 6,
      "symbol": "USDC",
      "available": "1000000000000"
    }
  },
  "orders": [
    {
      "uid": "0x1234",
      "sell_token": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      "buy_token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "sell_amount": "1000000000000000000",
      "buy_amount": "3000000000",
      "kind": "sell",
      "partially_fillable": false,
      "class": "market"
    }
  ],
  "liquidity": [],
  "deadline": "' "$(date -u -d '+30 seconds' +%Y-%m-%dT%H:%M:%S.000Z || date -u -v+30S +%Y-%m-%dT%H:%M:%S.000Z)" '"
}'

RESPONSE=$(curl -s -X POST "$SOLVER_URL/solve" \
  -H "Content-Type: application/json" \
  -d "$MOCK_AUCTION")

if echo "$RESPONSE" | jq . > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Solver responded with valid JSON${NC}"
    echo "$RESPONSE" | jq .
    
    SOLUTION_COUNT=$(echo "$RESPONSE" | jq '.solutions | length')
    if [ "$SOLUTION_COUNT" -gt 0 ]; then
        echo -e "${GREEN}✅ Solver returned $SOLUTION_COUNT solution(s)${NC}"
    else
        echo -e "${YELLOW}⚠️  Solver returned 0 solutions (may be expected for mock data)${NC}"
    fi
else
    echo -e "${RED}❌ Solver response invalid${NC}"
    echo "$RESPONSE"
    exit 1
fi

echo ""
echo -e "${GREEN}3. Testing metrics endpoint...${NC}"
if curl -f -s "$SOLVER_URL/metrics" > /dev/null; then
    echo -e "${GREEN}✅ Metrics endpoint working${NC}"
    curl -s "$SOLVER_URL/metrics" | jq .
else
    echo -e "${YELLOW}⚠️  Metrics endpoint not available${NC}"
fi

echo ""
echo -e "${GREEN}✅ All tests passed!${NC}"
echo ""
echo "Next steps:"
echo "  1. Run ./scripts/cow/test-local.sh to setup full testing environment"
echo "  2. Start autopilot + driver to receive real auctions"
echo "  3. Monitor solver performance with: curl $SOLVER_URL/metrics"

