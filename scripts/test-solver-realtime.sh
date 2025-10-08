#!/bin/bash

# Test CoW Solver with Real-Time Auction Data
# This script continuously fetches real auctions and tests the solver

set -e

echo "🧪 CoW Solver Real-Time Testing"
echo "================================"
echo ""

# Check if solver is running
echo "📡 Checking if solver is running on port 8000..."
if ! curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "❌ Solver not running. Start it with: npm run cow:dev"
    exit 1
fi

echo "✅ Solver is running"
echo ""

# Function to test with a real auction
test_auction() {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🎯 Fetching new auction..."

    # Fetch real auction
    npx ts-node scripts/fetch-real-auction.ts --output test-auction-current.json

    if [ ! -f test-auction-current.json ]; then
        echo "❌ Failed to fetch auction"
        return 1
    fi

    AUCTION_ID=$(cat test-auction-current.json | jq -r '.id')
    echo ""
    echo "🔍 Testing auction: $AUCTION_ID"
    echo ""

    # Test solver
    START_TIME=$(date +%s%3N)

    RESPONSE=$(curl -s -X POST http://localhost:8000/solve \
        -H "Content-Type: application/json" \
        -d @test-auction-current.json \
        -w "\n%{http_code}")

    END_TIME=$(date +%s%3N)
    DURATION=$((END_TIME - START_TIME))

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | head -n-1)

    echo "⏱️  Response time: ${DURATION}ms"
    echo "📊 HTTP Status: $HTTP_CODE"

    if [ "$HTTP_CODE" != "200" ]; then
        echo "❌ Request failed"
        echo "$BODY" | jq .
        return 1
    fi

    # Parse solution count
    SOLUTION_COUNT=$(echo "$BODY" | jq '.solutions | length')

    if [ "$SOLUTION_COUNT" -gt 0 ]; then
        echo "✅ Found $SOLUTION_COUNT solution(s)"

        # Show solution details
        echo ""
        echo "💡 Solution Details:"
        echo "$BODY" | jq -r '.solutions[] | "   Score: \(.score // "N/A") | Gas: \(.gas // "N/A") | Trades: \(.trades | length)"'

        # Save successful solution
        echo "$BODY" | jq . > "solution-${AUCTION_ID}.json"
        echo "💾 Saved solution to: solution-${AUCTION_ID}.json"
    else
        echo "⚠️  No solutions found"
    fi

    echo ""
}

# Run continuous testing
if [ "$1" == "--continuous" ]; then
    echo "🔄 Running in continuous mode (Ctrl+C to stop)"
    echo ""

    ITERATION=1
    while true; do
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "📍 Iteration #$ITERATION"
        test_auction || true
        ITERATION=$((ITERATION + 1))
        echo ""
        echo "⏸️  Waiting 30 seconds before next test..."
        sleep 30
    done
else
    # Single test
    test_auction
fi

echo ""
echo "✅ Testing complete!"
