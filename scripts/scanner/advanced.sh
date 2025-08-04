#!/bin/bash

# Set environment variables
export NODE_ENV=production
export EXECUTE_ARBITRAGE=false  # Set to true to enable actual arbitrage execution

# Use tsx to run TypeScript directly (bypassing module conflicts)
echo "Starting advanced market scanner with tsx..."
npx tsx src/scanner/advanced-scanner.ts 