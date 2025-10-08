#!/bin/bash

# Test script for CoW Protocol Solver

set -e

SOLVER_URL="${COW_SOLVER_URL:-http://localhost:8000}"

echo "🧪 Testing CoW Protocol Solver at $SOLVER_URL"
echo ""

# Test 1: Health check
echo "1️⃣  Testing /health endpoint..."
if curl -s "$SOLVER_URL/health" | jq . > /dev/null 2>&1; then
    echo "✅ Health check passed"
    curl -s "$SOLVER_URL/health" | jq .
else
    echo "❌ Health check failed"
    exit 1
fi

echo ""

# Test 2: Metrics endpoint
echo "2️⃣  Testing /metrics endpoint..."
if curl -s "$SOLVER_URL/metrics" | jq . > /dev/null 2>&1; then
    echo "✅ Metrics endpoint passed"
    curl -s "$SOLVER_URL/metrics" | jq .
else
    echo "❌ Metrics endpoint failed"
    exit 1
fi

echo ""

# Test 3: Solve endpoint with test auction
echo "3️⃣  Testing /solve endpoint with test auction..."
if [ ! -f "test-auction.json" ]; then
    echo "❌ test-auction.json not found"
    exit 1
fi

RESPONSE=$(curl -s -X POST "$SOLVER_URL/solve" \
    -H "Content-Type: application/json" \
    -d @test-auction.json)

if echo "$RESPONSE" | jq . > /dev/null 2>&1; then
    echo "✅ Solve endpoint returned valid JSON"
    echo "$RESPONSE" | jq .
    
    # Check if solutions array exists
    SOLUTIONS_COUNT=$(echo "$RESPONSE" | jq '.solutions | length')
    echo ""
    echo "📊 Returned $SOLUTIONS_COUNT solution(s)"
    
    if [ "$SOLUTIONS_COUNT" -gt 0 ]; then
        echo "🎉 SUCCESS: Solver returned solutions!"
    else
        echo "⚠️  WARNING: No solutions returned (might be expected if no profitable opportunities)"
    fi
else
    echo "❌ Solve endpoint returned invalid JSON"
    echo "$RESPONSE"
    exit 1
fi

echo ""
echo "✅ All tests completed!"
