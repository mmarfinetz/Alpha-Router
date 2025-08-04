#!/bin/bash

# Set environment variables
export NODE_ENV=production

# Build TypeScript files
echo "Building TypeScript files..."
npx tsc -p tsconfig.scanner.json

# Run the market scanner
echo "Starting market scanner..."
node dist/market-scanner.js 