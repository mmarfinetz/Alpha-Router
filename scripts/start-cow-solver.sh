#!/bin/bash

# CoW Protocol Solver Startup Script

set -e

echo "🐮 Starting CoW Protocol Solver..."

# Check for required environment variables
if [ -z "$ETHEREUM_RPC_URL" ] && [ -z "$RPC_URL" ]; then
    echo "❌ Error: ETHEREUM_RPC_URL or RPC_URL not set"
    exit 1
fi

if [ -z "$PRIVATE_KEY" ]; then
    echo "❌ Error: PRIVATE_KEY not set"
    exit 1
fi

if [ -z "$BUNDLE_EXECUTOR_ADDRESS" ]; then
    echo "❌ Error: BUNDLE_EXECUTOR_ADDRESS not set"
    exit 1
fi

# Set default port if not specified
export COW_SOLVER_PORT=${COW_SOLVER_PORT:-8000}

echo "✅ Configuration validated"
echo "📡 RPC: ${ETHEREUM_RPC_URL:-$RPC_URL}"
echo "🎯 Port: $COW_SOLVER_PORT"
echo "📝 Bundle Executor: $BUNDLE_EXECUTOR_ADDRESS"

# Build if needed
if [ ! -d "dist" ]; then
    echo "🔨 Building project..."
    npm run build
fi

# Start the solver
echo "🚀 Starting solver..."
npx ts-node src/cow/index.ts