#!/bin/bash

# MEV Bot Scanner - Consolidated script for all scanner operations
# Usage: ./scripts/scanner.sh [mode]
# Modes: basic, advanced, test, help

set -e  # Exit on error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_color() {
    echo -e "${2}${1}${NC}"
}

# Function to check environment
check_environment() {
    print_color "🔍 Checking environment..." "$BLUE"
    
    if [ ! -f ".env" ]; then
        print_color "❌ .env file not found!" "$RED"
        exit 1
    fi
    
    # Load environment variables
    source .env
    
    if [ -z "$ETHEREUM_RPC_URL" ]; then
        print_color "⚠️  Warning: ETHEREUM_RPC_URL not set" "$YELLOW"
    fi
    
    print_color "✅ Environment check complete" "$GREEN"
}

# Function to build scanner if needed
build_scanner() {
    if [ ! -d "build/scanner" ]; then
        print_color "🔨 Building scanner..." "$YELLOW"
        npm run build:scanner 2>/dev/null || npm run build
        print_color "✅ Scanner built successfully" "$GREEN"
    fi
}

# Basic scanner mode
run_basic_scanner() {
    print_color "\n📊 Running Basic Market Scanner" "$BLUE"
    print_color "================================" "$BLUE"
    
    check_environment
    build_scanner
    
    print_color "🚀 Starting basic scanner..." "$GREEN"
    
    # Run basic scanner with ts-node
    npx ts-node -P tsconfig.scanner.json src/scanner/basic-scanner.ts
}

# Advanced scanner mode
run_advanced_scanner() {
    print_color "\n🔬 Running Advanced Market Scanner" "$BLUE"
    print_color "===================================" "$BLUE"
    
    check_environment
    build_scanner
    
    print_color "🚀 Starting advanced scanner with full analytics..." "$GREEN"
    
    # Set environment for advanced mode
    export NODE_ENV=production
    export ARBITRAGE_ENABLED=false
    export SCANNER_MODE=advanced
    
    # Run advanced scanner with tsx for better performance
    npx tsx src/scanner/advanced-scanner.ts
}

# Test scanner mode
run_test_scanner() {
    print_color "\n🧪 Running Scanner Test Mode" "$BLUE"
    print_color "=============================" "$BLUE"
    
    check_environment
    
    print_color "📋 Testing scanner components..." "$YELLOW"
    
    # Quick environment test
    node -e "
        const dotenv = require('dotenv');
        dotenv.config();
        console.log('✅ Environment loaded');
        console.log('📍 RPC URL:', process.env.ETHEREUM_RPC_URL ? 'Configured' : 'Not configured');
        console.log('🔑 Private Key:', process.env.PRIVATE_KEY ? 'Configured' : 'Not configured');
        console.log('📦 Bundle Executor:', process.env.BUNDLE_EXECUTOR_ADDRESS || 'Not configured');
    "
    
    # Test scanner initialization
    print_color "\n🔄 Testing scanner initialization..." "$YELLOW"
    npx tsx -e "
        const { CrossDEXScanner } = require('./build/scanners/CrossDEXScanner.js');
        console.log('✅ CrossDEXScanner module loaded');
        const { AnalyticalArbitrageEngine } = require('./build/engines/AnalyticalArbitrageEngine.js');
        console.log('✅ AnalyticalArbitrageEngine module loaded');
        console.log('✅ All scanner components available');
    " 2>/dev/null || print_color "⚠️  Scanner modules need building" "$YELLOW"
    
    print_color "\n✅ Scanner test complete" "$GREEN"
}

# Continuous scanner mode
run_continuous_scanner() {
    print_color "\n♾️  Running Continuous Scanner" "$BLUE"
    print_color "==============================" "$BLUE"
    
    check_environment
    build_scanner
    
    print_color "🔄 Starting continuous market monitoring..." "$GREEN"
    print_color "Press Ctrl+C to stop" "$YELLOW"
    
    # Run scanner in a loop with automatic restart
    while true; do
        print_color "\n📊 Scanning markets..." "$BLUE"
        npx tsx src/scanner/advanced-scanner.ts || {
            print_color "⚠️  Scanner crashed, restarting in 5 seconds..." "$YELLOW"
            sleep 5
        }
        
        print_color "⏳ Waiting 30 seconds before next scan..." "$BLUE"
        sleep 30
    done
}

# Show help
show_help() {
    print_color "\n📚 MEV Bot Scanner - Help" "$BLUE"
    print_color "=========================" "$BLUE"
    echo ""
    echo "Usage: $0 [mode]"
    echo ""
    echo "Available modes:"
    echo "  basic      - Run basic market scanner (quick overview)"
    echo "  advanced   - Run advanced scanner with full analytics"
    echo "  test       - Test scanner environment and components"
    echo "  continuous - Run scanner continuously with auto-restart"
    echo "  help       - Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 basic      # Quick market scan"
    echo "  $0 advanced   # Detailed arbitrage opportunity scan"
    echo "  $0 test       # Verify scanner setup"
    echo "  $0 continuous # Monitor markets continuously"
    echo ""
    echo "Environment variables:"
    echo "  SCANNER_MODE        - Set scanner mode (basic/advanced)"
    echo "  ARBITRAGE_ENABLED   - Enable/disable arbitrage execution"
    echo "  MIN_PROFIT_ETH      - Minimum profit threshold"
    echo ""
}

# Main script logic
main() {
    MODE=${1:-help}
    
    case $MODE in
        basic)
            run_basic_scanner
            ;;
        advanced)
            run_advanced_scanner
            ;;
        test)
            run_test_scanner
            ;;
        continuous)
            run_continuous_scanner
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            print_color "❌ Unknown mode: $MODE" "$RED"
            show_help
            exit 1
            ;;
    esac
}

# Run main function
main "$@"