#!/bin/bash

# MEV Bot - Advanced Scanner
# This script runs the advanced market scanner with proper error handling

set -e

echo "=== MEV Bot Advanced Scanner ==="
echo "Starting advanced market scanner..."
echo

# Check if .env file exists
if [ ! -f .env ]; then
    echo "Warning: .env file not found. Make sure environment variables are set."
fi

# Run the advanced scanner script
exec bash ./scripts/scanner/advanced.sh