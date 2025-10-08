#!/bin/bash

# 🚀 CoW Solver Competition Quick Start
# Edit .env.competition with your values first!

set -e

echo "🐮 Starting CoW Solver for Competition"
echo ""

# Check if .env.competition exists
if [ ! -f ".env.competition" ]; then
    echo "❌ .env.competition not found!"
    echo "📝 Creating template..."
    cat > .env.competition << 'EOF'
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR-API-KEY-HERE
PRIVATE_KEY=your_private_key_here
BUNDLE_EXECUTOR_ADDRESS=0x0000000000000000000000000000000000000001
COW_SOLVER_PORT=8000
NODE_ENV=development
EOF
    echo "✅ Template created at .env.competition"
    echo "⚠️  EDIT THIS FILE WITH YOUR VALUES!"
    echo ""
    echo "Then run this script again."
    exit 1
fi

# Load environment
set -a
source .env.competition
set +a

# Validate required vars
if [[ "$ETHEREUM_RPC_URL" == *"YOUR-API-KEY"* ]]; then
    echo "❌ Please edit .env.competition and add your RPC URL!"
    exit 1
fi

if [[ "$PRIVATE_KEY" == "your_private_key_here" ]]; then
    echo "❌ Please edit .env.competition and add your private key!"
    exit 1
fi

echo "✅ Environment variables loaded"
echo "📡 RPC: ${ETHEREUM_RPC_URL:0:50}..."
echo "🔑 Wallet: Using configured private key"
echo "📝 Contract: $BUNDLE_EXECUTOR_ADDRESS"
echo "🎯 Port: $COW_SOLVER_PORT"
echo ""

# Build if needed
echo "🔨 Building..."
npm run build 2>&1 | tail -5

echo ""
echo "🚀 Starting solver..."
echo "💡 Press Ctrl+C to stop"
echo ""

# Start the solver
npm run cow:dev
