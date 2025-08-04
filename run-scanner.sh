#!/bin/bash

# MEV Bot - Basic Scanner
# This script runs the basic market scanner with proper error handling

set -e

echo "=== MEV Bot Basic Scanner ==="
echo "Starting basic market scanner..."
echo

# Check if .env file exists
if [ ! -f .env ]; then
    echo "Warning: .env file not found. Make sure environment variables are set."
fi

# Build TypeScript files
echo "Building TypeScript files..."
npx tsc -p tsconfig.scanner.json

# Run the basic market scanner
echo "Starting basic market scanner..."
node dist/scanner/index.js basic