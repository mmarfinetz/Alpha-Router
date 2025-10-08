#!/bin/bash
# 🚀 CoW Solver Competition Quick Start
set -e

echo "🐮 Starting CoW Solver for Competition"

# Check if .env.competition exists
if [ ! -f ".env.competition" ]; then
    echo "❌ .env.competition not found! Edit it with your values."
    exit 1
fi

# Load environment
set -a
source .env.competition
set +a

echo "✅ Environment loaded"
echo "🚀 Starting solver on port $COW_SOLVER_PORT..."
echo ""

npm run cow:dev
