#!/bin/bash

# Test deployed CoW solver

URL="https://cow-solver-production.up.railway.app"

echo "🧪 Testing Deployed CoW Solver"
echo "=============================="
echo "URL: $URL"
echo ""

echo "1️⃣ Testing health endpoint..."
curl -s "$URL/health" | python3 -m json.tool
echo ""
echo ""

echo "2️⃣ Testing solve endpoint..."
curl -s -X POST "$URL/solve" \
  -H "Content-Type: application/json" \
  --data-binary @test-auction.json \
  | python3 -m json.tool | head -100

echo ""
echo "✅ Tests complete!"
