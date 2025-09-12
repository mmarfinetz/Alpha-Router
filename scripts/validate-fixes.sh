#!/bin/bash

# MEV Bot Fixes Validation Script
# This script validates that the critical issues have been resolved

echo "🔍 MEV Bot Fixes Validation Script"
echo "=================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
WARNINGS=0

# Function to check if a string exists in a file
check_code_exists() {
    local file="$1"
    local pattern="$2"
    local description="$3"
    
    if grep -q "$pattern" "$file" 2>/dev/null; then
        echo -e "${GREEN}✓ PASS${NC}: $description"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC}: $description"
        ((FAILED++))
        return 1
    fi
}

# Function to check if a string does NOT exist in a file
check_code_not_exists() {
    local file="$1"
    local pattern="$2"
    local description="$3"
    
    if ! grep -q "$pattern" "$file" 2>/dev/null; then
        echo -e "${GREEN}✓ PASS${NC}: $description"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC}: $description"
        ((FAILED++))
        return 1
    fi
}

echo ""
echo "1. Memory Leak Prevention Checks"
echo "--------------------------------"

# Check for EventEmitter.defaultMaxListeners
check_code_exists "src/websocketmanager.ts" "EventEmitter.defaultMaxListeners = 20" \
    "EventEmitter max listeners increased to prevent warnings"

# Check for AbortController management
check_code_exists "src/websocketmanager.ts" "private abortControllers: Map<string, AbortController>" \
    "AbortController tracking map implemented"

# Check for operation locks
check_code_exists "src/websocketmanager.ts" "private operationLocks: Set<string>" \
    "Operation deduplication locks implemented"

# Check for cleanup method enhancements
check_code_exists "src/websocketmanager.ts" "for (const \[key, controller\] of this.abortControllers.entries())" \
    "AbortController cleanup in cleanup method"

echo ""
echo "2. WebSocket Block Event Validation"
echo "-----------------------------------"

# Check for enhanced block validation
check_code_exists "src/websocketmanager.ts" "if (event.number)" \
    "Enhanced block event validation implemented"

# Check for controlled fallback
check_code_exists "src/websocketmanager.ts" "const abortController = new AbortController();" \
    "AbortController used in fallback block fetching"

echo ""
echo "3. Operation Coordination Checks"
echo "--------------------------------"

# Check for coordinated operation manager
check_code_exists "src/index.websocket.ts" "const operationManager = {" \
    "Coordinated operation manager implemented"

# Check for minimum interval protection
check_code_exists "src/index.websocket.ts" "MIN_INTERVAL: 10000" \
    "Minimum interval protection for operations"

# Check for operation manager injection
check_code_exists "src/websocketmanager.ts" "public operationManager: any = null" \
    "Operation manager injection point added"

echo ""
echo "4. Reserve Update Optimizations"
echo "------------------------------"

# Check for contract caching
check_code_exists "src/UniswapV2EthPair.ts" "const contractCache = new Map<string, Contract>()" \
    "Contract caching implemented in static updateReserves"

# Check for batch size reduction
check_code_exists "src/UniswapV2EthPair.ts" "const BATCH_SIZE = 50" \
    "Batch size reduced to 50 for memory efficiency"

# Check for individual updateReserves timeout
check_code_exists "src/UniswapV2EthPair.ts" "const timeoutId = setTimeout(() => abortController.abort(), 8000)" \
    "Individual updateReserves method has timeout protection"

echo ""
echo "5. Graceful Shutdown Implementation"
echo "-----------------------------------"

# Check for SIGINT/SIGTERM handlers
check_code_exists "src/index.websocket.ts" "process.on('SIGINT'" \
    "SIGINT handler implemented"

check_code_exists "src/index.websocket.ts" "process.on('SIGTERM'" \
    "SIGTERM handler implemented"

# Check for disconnect method
check_code_exists "src/websocketmanager.ts" "public async disconnect()" \
    "WebSocket disconnect method implemented"

echo ""
echo "6. Health Monitoring Enhancements"
echo "---------------------------------"

# Check for operation status method
check_code_exists "src/websocketmanager.ts" "public getOperationStatus()" \
    "Operation status monitoring method implemented"

# Check for health check interval
check_code_exists "src/index.websocket.ts" "System health check" \
    "Health check logging implemented"

echo ""
echo "7. Code Quality Checks"
echo "---------------------"

# Check that console.error was replaced with proper logging
check_code_not_exists "src/UniswapV2EthPair.ts" "console.error" \
    "console.error replaced with proper logging in updateReserves"

# Check for proper error handling
check_code_exists "src/websocketmanager.ts" "error instanceof Error ? error : new Error" \
    "Proper error type checking implemented"

echo ""
echo "8. Build and Syntax Validation"
echo "------------------------------"

# Check if TypeScript compilation passes
echo "Checking TypeScript compilation..."
if npm run build:ws > /dev/null 2>&1; then
    echo -e "${GREEN}✓ PASS${NC}: TypeScript compilation successful"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}: TypeScript compilation failed"
    ((FAILED++))
fi

# Check if main files exist and are readable
for file in "src/websocketmanager.ts" "src/index.websocket.ts" "src/UniswapV2EthPair.ts"; do
    if [ -r "$file" ]; then
        echo -e "${GREEN}✓ PASS${NC}: $file is readable and exists"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAIL${NC}: $file is missing or not readable"
        ((FAILED++))
    fi
done

echo ""
echo "9. Configuration Validation"
echo "---------------------------"

# Check for required environment variables documentation
if [ -f ".env.example" ] || [ -f "README.md" ]; then
    echo -e "${GREEN}✓ PASS${NC}: Environment documentation exists"
    ((PASSED++))
else
    echo -e "${YELLOW}⚠ WARNING${NC}: Consider adding .env.example for environment documentation"
    ((WARNINGS++))
fi

# Check for package.json scripts
if grep -q "start:ws" package.json 2>/dev/null; then
    echo -e "${GREEN}✓ PASS${NC}: WebSocket start script exists in package.json"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}: WebSocket start script missing in package.json"
    ((FAILED++))
fi

echo ""
echo "=========================================="
echo "🏁 VALIDATION SUMMARY"
echo "=========================================="
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo -e "Warnings: ${YELLOW}$WARNINGS${NC}"

if [ $FAILED -eq 0 ]; then
    echo ""
    echo -e "${GREEN}🎉 ALL CRITICAL FIXES VALIDATED SUCCESSFULLY!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Test the bot with: npm run start:ws"
    echo "2. Monitor logs for the resolved issues:"
    echo "   - No MaxListenersExceededWarning messages"
    echo "   - Reduced 'block event without valid block number' warnings"
    echo "   - No duplicate operation timestamps"
    echo "3. Monitor memory usage over time"
    echo "4. Test graceful shutdown with Ctrl+C"
    exit 0
else
    echo ""
    echo -e "${RED}❌ VALIDATION FAILED - ISSUES FOUND${NC}"
    echo ""
    echo "Please review the failed checks above and ensure all fixes are properly implemented."
    exit 1
fi