#!/usr/bin/env bash
set -euo pipefail

# Local Testing Script for CoW Protocol Solver
# This script helps you test your solver against real CoW orderflow

SERVICES_DIR="${COW_SERVICES_DIR:-$HOME/cow-services}"
NODE_URL="${NODE_URL:-}"
NETWORK="${NETWORK:-mainnet}"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🐮 CoW Protocol Local Testing Setup${NC}"
echo ""

# Check prerequisites
if [ -z "$NODE_URL" ]; then
    echo -e "${RED}❌ NODE_URL not set${NC}"
    echo "   Set your RPC endpoint: export NODE_URL=https://..."
    exit 1
fi

# Check if services directory exists
if [ ! -d "$SERVICES_DIR" ]; then
    echo -e "${YELLOW}⚠️  CoW services not found at $SERVICES_DIR${NC}"
    echo ""
    echo "Cloning cowprotocol/services..."
    git clone https://github.com/cowprotocol/services.git "$SERVICES_DIR"
    echo ""
    echo "Setting up Rust nightly (required for edition2024)..."
    cd "$SERVICES_DIR"
    rustup override set nightly
    echo ""
    echo "Building services (this may take 10-15 minutes)..."
    echo -e "${YELLOW}⏳ Building autopilot...${NC}"
    cargo build --release --bin autopilot
    echo -e "${YELLOW}⏳ Building driver...${NC}"
    cargo build --release --bin driver
    echo -e "${GREEN}✅ Services built successfully${NC}"
    cd -
fi

# Copy driver config
echo "Copying driver config..."
cp scripts/cow/driver.config.toml "$SERVICES_DIR/driver.config.toml"

# Check if solver is built
if [ ! -f "build/cow/index.js" ]; then
    echo "Building solver..."
    npm run build
fi

echo ""
echo -e "${GREEN}Setup complete! Now run these commands in separate terminals:${NC}"
echo ""
echo -e "${YELLOW}Terminal 1 - Start Solver:${NC}"
echo "  cd $(pwd)"
echo "  node build/cow/index.js"
echo ""
echo -e "${YELLOW}Terminal 2 - Start Driver:${NC}"
echo "  cd $SERVICES_DIR"
echo "  cargo run --release --bin driver -- --config driver.config.toml --ethrpc $NODE_URL"
echo ""
echo -e "${YELLOW}Terminal 3 - Start Autopilot:${NC}"
echo "  cd $SERVICES_DIR"
echo "  cargo run --release --bin autopilot -- \\"
echo "    --native-price-estimators 'baseline|http://localhost:11088/baseline' \\"
echo "    --skip-event-sync true \\"
echo "    --node-url $NODE_URL \\"
echo "    --shadow https://api.cow.fi/$NETWORK \\"
echo "    --drivers 'ga-solver|http://localhost:11088/ga-solver'"
echo ""
echo -e "${GREEN}📊 Monitor:${NC}"
echo "  Solver health: curl http://localhost:8000/health"
echo "  Solver metrics: curl http://localhost:8000/metrics"
echo "  WebSocket: wscat -c ws://localhost:8000/metrics"
echo ""
echo -e "${YELLOW}⚠️  Note: RPC usage can be high. Monitor your provider's dashboard.${NC}"

