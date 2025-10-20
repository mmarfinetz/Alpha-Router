#!/usr/bin/env bash
set -euo pipefail

# Complete startup script for CoW Protocol testing
# This starts: Solver → Driver → Autopilot (in tmux panes)

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SERVICES_DIR="${COW_SERVICES_DIR:-$HOME/cow-services}"
NODE_URL="${NODE_URL:-}"
NETWORK="${NETWORK:-mainnet}"
ORDERBOOK_URL="https://api.cow.fi/${NETWORK}"

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         CoW Protocol - Full Stack Startup                     ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check NODE_URL
if [ -z "$NODE_URL" ]; then
    echo -e "${RED}❌ NODE_URL not set${NC}"
    echo ""
    echo "Please set your RPC endpoint:"
    echo "  export NODE_URL=\"https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY\""
    exit 1
fi

# Check if binaries are built
if [ ! -f "$SERVICES_DIR/target/release/autopilot" ] || [ ! -f "$SERVICES_DIR/target/release/driver" ]; then
    echo -e "${RED}❌ CoW services not built yet${NC}"
    echo ""
    echo "Build them first:"
    echo "  cd $SERVICES_DIR"
    echo "  cargo build --release --bin autopilot --bin driver"
    exit 1
fi

# Check if solver is built
if [ ! -f "$(dirname "$0")/../../build/cow/index.js" ]; then
    echo -e "${YELLOW}⚠️  Solver not built, building now...${NC}"
    npm run build
fi

# Copy driver config
echo -e "${YELLOW}📝 Copying driver config...${NC}"
cp "$(dirname "$0")/driver.config.toml" "$SERVICES_DIR/driver.config.toml"

echo -e "${GREEN}✅ Prerequisites checked${NC}"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Starting services in tmux session 'cow-solver'...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Kill existing session if it exists
tmux kill-session -t cow-solver 2>/dev/null || true

# Create new tmux session with 3 panes
tmux new-session -d -s cow-solver -n main

# Split horizontally (top/bottom)
tmux split-window -v -t cow-solver

# Split the bottom pane vertically (left/right)
tmux select-pane -t cow-solver:0.1
tmux split-window -h -t cow-solver

# Pane 0 (top): Solver
tmux select-pane -t cow-solver:0.0
tmux send-keys -t cow-solver:0.0 "cd $(pwd)" C-m
tmux send-keys -t cow-solver:0.0 "echo '🐮 Starting CoW Solver...'" C-m
tmux send-keys -t cow-solver:0.0 "node build/cow/index.js" C-m

# Wait for solver to start
sleep 3

# Pane 1 (bottom-left): Driver
tmux select-pane -t cow-solver:0.1
tmux send-keys -t cow-solver:0.1 "cd $SERVICES_DIR" C-m
tmux send-keys -t cow-solver:0.1 "echo '🚗 Starting Driver...'" C-m
tmux send-keys -t cow-solver:0.1 "export NODE_URL='$NODE_URL'" C-m
tmux send-keys -t cow-solver:0.1 "./target/release/driver --config driver.config.toml --ethrpc \$NODE_URL" C-m

# Wait for driver to start
sleep 2

# Pane 2 (bottom-right): Autopilot
tmux select-pane -t cow-solver:0.2
tmux send-keys -t cow-solver:0.2 "cd $SERVICES_DIR" C-m
tmux send-keys -t cow-solver:0.2 "echo '✈️  Starting Autopilot...'" C-m
tmux send-keys -t cow-solver:0.2 "export NODE_URL='$NODE_URL'" C-m
tmux send-keys -t cow-solver:0.2 "./target/release/autopilot --native-price-estimators 'baseline|http://localhost:11088/baseline' --skip-event-sync true --node-url \$NODE_URL --shadow $ORDERBOOK_URL --drivers 'ga-solver|http://localhost:11088/ga-solver'" C-m

echo ""
echo -e "${GREEN}✅ All services started in tmux!${NC}"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}📊 Control Panel:${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}Attach to tmux session:${NC}"
echo "  tmux attach -t cow-solver"
echo ""
echo -e "${YELLOW}Navigation:${NC}"
echo "  Ctrl+B ↑/↓/←/→  - Switch between panes"
echo "  Ctrl+B d        - Detach (keeps running)"
echo "  Ctrl+C          - Stop current service"
echo ""
echo -e "${YELLOW}Monitor:${NC}"
echo "  curl http://localhost:8000/health | jq"
echo "  curl http://localhost:8000/metrics | jq"
echo ""
echo -e "${YELLOW}Stop all services:${NC}"
echo "  tmux kill-session -t cow-solver"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🎯 Your solver is now competing for real CoW Protocol auctions!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Attaching to session in 5 seconds... (Ctrl+C to cancel)"
sleep 5
tmux attach -t cow-solver

