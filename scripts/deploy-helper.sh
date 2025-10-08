#!/bin/bash

echo "🚀 CoW Solver Deployment Helper"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Check if .env.competition exists
if [ ! -f ".env.competition" ]; then
    echo "❌ .env.competition not found!"
    exit 1
fi

# Load config
source .env.competition

# Validate RPC URL
if [[ "$ETHEREUM_RPC_URL" == *"YOUR-API-KEY"* ]]; then
    echo "❌ ETHEREUM_RPC_URL not configured!"
    echo ""
    echo "📝 To fix:"
    echo "   1. Go to https://www.alchemy.com/"
    echo "   2. Sign up (free)"
    echo "   3. Create app → Ethereum Mainnet"
    echo "   4. Copy HTTP URL"
    echo "   5. Run: nano .env.competition"
    echo "   6. Replace YOUR-API-KEY-HERE with your URL"
    echo ""
    exit 1
fi

# Validate private key
if [[ "$PRIVATE_KEY" == "your_private_key_here" ]]; then
    echo "❌ PRIVATE_KEY not configured!"
    echo ""
    echo "📝 To fix:"
    echo "   1. Open MetaMask"
    echo "   2. Create NEW wallet (or use existing)"
    echo "   3. Account Details → Export Private Key"
    echo "   4. Run: nano .env.competition"
    echo "   5. Replace your_private_key_here with your key"
    echo ""
    echo "💡 Wallet doesn't need funds for competition!"
    echo ""
    exit 1
fi

echo "✅ Configuration looks good!"
echo ""
echo "📡 RPC: ${ETHEREUM_RPC_URL:0:50}..."
echo "🔑 Private key: ${PRIVATE_KEY:0:10}...${PRIVATE_KEY: -4}"
echo "🎯 Port: $COW_SOLVER_PORT"
echo ""
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "🧪 STEP 1: Test Locally"
echo "   Run: ./START_COMPETITION.sh"
echo "   This will start your solver on http://localhost:8000"
echo "   Test it in another terminal: curl http://localhost:8000/health"
echo "   Press Ctrl+C to stop when working"
echo ""
echo "🚀 STEP 2: Deploy to Railway"
echo "   Run: npm install -g @railway/cli"
echo "   Then: railway login"
echo "   Then: railway init"
echo "   Then: railway variables set ETHEREUM_RPC_URL=\"$ETHEREUM_RPC_URL\""
echo "   Then: railway variables set PRIVATE_KEY=\"$PRIVATE_KEY\""
echo "   Then: railway variables set BUNDLE_EXECUTOR_ADDRESS=\"0x0000000000000000000000000000000000000001\""
echo "   Then: railway up"
echo "   Then: railway domain (to get your URL)"
echo ""
echo "🏆 STEP 3: Submit to Competition"
echo "   Copy your Railway URL"
echo "   Submit to CoW Protocol competition page"
echo "   WIN! 🎉"
echo ""
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "Ready to start? Run: ./START_COMPETITION.sh"
echo ""
