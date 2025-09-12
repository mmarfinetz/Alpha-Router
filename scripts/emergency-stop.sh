#!/bin/bash

echo "🚨 Emergency Stop: MEV Bot Shutdown Initiated"

# Stop all running MEV bot processes
echo "Stopping MEV bot processes..."
pkill -f "npm run start:ws" || echo "No start:ws processes found"
pkill -f "npm run monitor:ws" || echo "No monitor:ws processes found"
pkill -f "node.*index.websocket" || echo "No websocket processes found"
pkill -f "node.*index.ts" || echo "No index.ts processes found"

# Wait for graceful shutdown
sleep 3

# Force kill if still running
echo "Force killing any remaining processes..."
pkill -9 -f "mevbot" || echo "No remaining mevbot processes found"

# Archive current logs
echo "Archiving logs..."
mkdir -p logs/emergency/$(date +%Y%m%d_%H%M%S)
mv logs/*.txt logs/emergency/$(date +%Y%m%d_%H%M%S)/ 2>/dev/null || echo "No logs to archive"

# Check system resources
echo "System resource check:"
echo "CPU Usage: $(top -l 1 | grep "CPU usage" | awk '{print $3}')"
echo "Memory Usage: $(ps -A -o %mem | awk '{s+=$1} END {print s "%"}')"
echo "Disk Usage: $(df -h / | awk 'NR==2{print $5}')"

# Test basic connectivity
echo "Testing RPC connectivity..."
if [ -n "$ETHEREUM_RPC_URL" ]; then
    timeout 5 curl -s -X POST "$ETHEREUM_RPC_URL" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
        && echo "✅ RPC connectivity OK" \
        || echo "❌ RPC connectivity FAILED"
else
    echo "⚠️  ETHEREUM_RPC_URL not set"
fi

echo "🛑 Emergency stop completed. Logs archived."
echo "📋 Next steps:"
echo "   1. Review logs in logs/emergency/"
echo "   2. Check provider status"
echo "   3. Run 'npm run dev:ws' to restart with fixes"