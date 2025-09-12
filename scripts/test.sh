#!/bin/bash

# MEV Bot Test Suite - Consolidated testing script
# Usage: ./scripts/test.sh [suite]
# Suites: all, unit, integration, mevshare, hybrid, scanner, quick, help

set -e  # Exit on error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Function to print colored output
print_color() {
    echo -e "${2}${1}${NC}"
}

# Function to print test header
print_header() {
    echo ""
    print_color "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "$CYAN"
    print_color "  $1" "$BLUE"
    print_color "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "$CYAN"
    echo ""
}

# Function to check test environment
check_test_environment() {
    print_color "🔍 Checking test environment..." "$BLUE"
    
    if [ ! -f ".env" ]; then
        print_color "⚠️  Warning: .env file not found, tests may fail" "$YELLOW"
    fi
    
    if [ ! -d "node_modules" ]; then
        print_color "📦 Installing dependencies..." "$YELLOW"
        npm install
    fi
    
    print_color "✅ Test environment ready" "$GREEN"
}

# Run all tests
run_all_tests() {
    print_header "🧪 Running All Tests"
    
    check_test_environment
    
    print_color "📋 Test suites to run:" "$BLUE"
    echo "  • Unit tests"
    echo "  • Integration tests"
    echo "  • MEV-Share tests"
    echo "  • Hybrid optimization tests"
    echo "  • Scanner tests"
    echo ""
    
    # Run all test suites
    npm test
    
    print_color "\n✅ All tests completed" "$GREEN"
}

# Run unit tests
run_unit_tests() {
    print_header "🔬 Running Unit Tests"
    
    check_test_environment
    
    print_color "🚀 Starting unit tests..." "$GREEN"
    npm run test:unit || {
        print_color "❌ Unit tests failed" "$RED"
        exit 1
    }
    
    print_color "✅ Unit tests passed" "$GREEN"
}

# Run integration tests
run_integration_tests() {
    print_header "🔗 Running Integration Tests"
    
    check_test_environment
    
    print_color "🚀 Starting integration tests..." "$GREEN"
    npm run test:integration || {
        print_color "❌ Integration tests failed" "$RED"
        exit 1
    }
    
    print_color "✅ Integration tests passed" "$GREEN"
}

# Run MEV-Share tests
run_mevshare_tests() {
    print_header "💎 Running MEV-Share Tests"
    
    check_test_environment
    
    print_color "🚀 Starting MEV-Share tests..." "$GREEN"
    
    # Set up MEV-Share test environment
    export NODE_ENV=test
    export MEV_SHARE_ENABLED=true
    
    # Run MEV-Share specific tests
    node scripts/test/mevshare.mjs || npm run test:mevshare || {
        print_color "❌ MEV-Share tests failed" "$RED"
        exit 1
    }
    
    print_color "✅ MEV-Share tests passed" "$GREEN"
}

# Run hybrid optimization tests
run_hybrid_tests() {
    print_header "🔄 Running Hybrid Optimization Tests"
    
    check_test_environment
    
    print_color "🚀 Starting hybrid optimization tests..." "$GREEN"
    
    # Run hybrid tests
    node scripts/test/hybrid.mjs || {
        print_color "❌ Hybrid tests failed" "$RED"
        exit 1
    }
    
    print_color "✅ Hybrid optimization tests passed" "$GREEN"
}

# Run scanner tests
run_scanner_tests() {
    print_header "📊 Running Scanner Tests"
    
    check_test_environment
    
    print_color "🚀 Testing scanner components..." "$GREEN"
    
    # Test scanner modules
    node -e "
        console.log('Testing scanner module imports...');
        try {
            const { CrossDEXScanner } = require('./build/scanners/CrossDEXScanner.js');
            console.log('✅ CrossDEXScanner loaded');
            const { AnalyticalArbitrageEngine } = require('./build/engines/AnalyticalArbitrageEngine.js');
            console.log('✅ AnalyticalArbitrageEngine loaded');
            console.log('✅ Scanner modules OK');
        } catch (e) {
            console.error('❌ Scanner module error:', e.message);
            process.exit(1);
        }
    " || {
        print_color "⚠️  Scanner modules need building, building now..." "$YELLOW"
        npm run build:all
        print_color "✅ Build complete, retrying tests..." "$GREEN"
        run_scanner_tests
        return
    }
    
    # Test scanner initialization
    print_color "📋 Testing scanner initialization..." "$BLUE"
    npx tsx -e "
        const { ethers } = require('ethers');
        const { AGGRESSIVE_MARKET_FILTERS } = require('./build/config/marketFilters.js');
        console.log('✅ Market filters loaded');
        console.log('📊 Filter settings:');
        console.log('  Min liquidity:', AGGRESSIVE_MARKET_FILTERS.minLiquidityETH, 'ETH');
        console.log('  Min spread:', AGGRESSIVE_MARKET_FILTERS.minSpreadBasisPoints, 'bps');
        console.log('  Priority tokens:', AGGRESSIVE_MARKET_FILTERS.priorityTokens.length);
    "
    
    print_color "✅ Scanner tests passed" "$GREEN"
}

# Run quick smoke tests
run_quick_tests() {
    print_header "⚡ Running Quick Tests"
    
    check_test_environment
    
    print_color "🚀 Running quick validation tests..." "$GREEN"
    
    # Quick module load test
    print_color "📦 Testing core modules..." "$BLUE"
    node -e "
        const modules = [
            './build/Arbitrage.js',
            './build/engines/AnalyticalArbitrageEngine.js',
            './build/scanners/CrossDEXScanner.js',
            './build/config/marketFilters.js'
        ];
        
        let failed = false;
        modules.forEach(mod => {
            try {
                require(mod);
                console.log('✅', mod.replace('./build/', ''));
            } catch (e) {
                console.error('❌', mod.replace('./build/', ''), '- Error:', e.message);
                failed = true;
            }
        });
        
        if (failed) process.exit(1);
    " || {
        print_color "❌ Module loading failed, building..." "$RED"
        npm run build:all
        run_quick_tests
        return
    }
    
    # Quick configuration test
    print_color "⚙️  Testing configuration..." "$BLUE"
    node -e "
        const dotenv = require('dotenv');
        dotenv.config();
        
        const configs = {
            'RPC URL': process.env.ETHEREUM_RPC_URL,
            'Private Key': process.env.PRIVATE_KEY,
            'Bundle Executor': process.env.BUNDLE_EXECUTOR_ADDRESS,
            'Flashbots Key': process.env.FLASHBOTS_RELAY_SIGNING_KEY
        };
        
        Object.entries(configs).forEach(([key, value]) => {
            console.log(value ? '✅' : '⚠️ ', key + ':', value ? 'Configured' : 'Not configured');
        });
    "
    
    print_color "\n✅ Quick tests passed" "$GREEN"
}

# Generate test report
generate_report() {
    print_header "📊 Generating Test Report"
    
    TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')
    REPORT_FILE="test-reports/report_${TIMESTAMP}.txt"
    
    mkdir -p test-reports
    
    {
        echo "MEV Bot Test Report"
        echo "==================="
        echo "Generated: $(date)"
        echo ""
        echo "Test Results:"
        echo "-------------"
        
        # Run each test suite and capture results
        echo "Unit Tests: $(npm run test:unit 2>&1 | grep -c 'passing' || echo '0') passing"
        echo "Integration Tests: $(npm run test:integration 2>&1 | grep -c 'passing' || echo '0') passing"
        echo "Scanner Tests: $(run_scanner_tests 2>&1 | grep -c '✅' || echo '0') passing"
        
        echo ""
        echo "Configuration:"
        echo "--------------"
        node -e "
            const dotenv = require('dotenv');
            dotenv.config();
            console.log('Node Version:', process.version);
            console.log('Environment:', process.env.NODE_ENV || 'development');
            console.log('RPC Configured:', process.env.ETHEREUM_RPC_URL ? 'Yes' : 'No');
        "
    } > "$REPORT_FILE"
    
    print_color "✅ Test report saved to: $REPORT_FILE" "$GREEN"
    cat "$REPORT_FILE"
}

# Show help
show_help() {
    print_header "📚 MEV Bot Test Suite - Help"
    
    echo "Usage: $0 [suite]"
    echo ""
    echo "Available test suites:"
    echo "  all         - Run all test suites"
    echo "  unit        - Run unit tests only"
    echo "  integration - Run integration tests only"
    echo "  mevshare    - Run MEV-Share specific tests"
    echo "  hybrid      - Run hybrid optimization tests"
    echo "  scanner     - Run scanner component tests"
    echo "  quick       - Run quick smoke tests"
    echo "  report      - Generate test report"
    echo "  help        - Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 all         # Run complete test suite"
    echo "  $0 unit        # Run unit tests only"
    echo "  $0 quick       # Quick validation"
    echo "  $0 report      # Generate test report"
    echo ""
    echo "Environment variables:"
    echo "  NODE_ENV    - Set to 'test' for test mode"
    echo "  LOG_LEVEL   - Set logging level (debug/info/error)"
    echo ""
}

# Main script logic
main() {
    SUITE=${1:-help}
    
    case $SUITE in
        all)
            run_all_tests
            ;;
        unit)
            run_unit_tests
            ;;
        integration)
            run_integration_tests
            ;;
        mevshare)
            run_mevshare_tests
            ;;
        hybrid)
            run_hybrid_tests
            ;;
        scanner)
            run_scanner_tests
            ;;
        quick)
            run_quick_tests
            ;;
        report)
            generate_report
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            print_color "❌ Unknown test suite: $SUITE" "$RED"
            show_help
            exit 1
            ;;
    esac
}

# Run main function
main "$@"