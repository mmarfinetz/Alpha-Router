#!/bin/bash

# MEV Bot Discovery Mode - Maximum market discovery
# This script starts the bot in discovery mode to find all available markets

set -e

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  🔍 MEV Bot - Discovery Mode${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${YELLOW}📊 Discovery mode settings:${NC}"
echo "  • Maximum market discovery enabled"
echo "  • Loading up to 10,000 pairs per DEX"
echo "  • Minimum liquidity: 0.01 ETH"
echo "  • All 5 compatible DEXes will be queried"
echo "  • Higher throughput with 30 concurrent requests"
echo ""

# Set environment for discovery mode
export SCANNER_MODE=discovery
export NODE_ENV=production
export LOG_LEVEL=info
export MAX_PAIRS_PER_DEX=10000
export MIN_LIQUIDITY_ETH=0.01
export BATCH_SIZE=1000
export CONCURRENT_REQUESTS=30

echo -e "${GREEN}🚀 Building bot...${NC}"
npm run build:all

echo -e "${GREEN}🔄 Starting bot in discovery mode...${NC}"
echo -e "${YELLOW}This may take 2-3 minutes to load all markets...${NC}"
echo ""

# Run the WebSocket version with discovery settings
exec node build/index.websocket.js