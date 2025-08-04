# MEV Arbitrage Bot - Testing Guide

This guide provides comprehensive instructions for testing all components of the MEV arbitrage bot, from unit tests to full integration testing.

## 🛠 Setup

### Prerequisites

Ensure you have the following installed:
- Node.js (v16+)
- npm or yarn
- TypeScript
- Hardhat

### Environment Configuration

Create a `.env` file in the project root with the following variables:

```env
# Required for all tests
ETH_MAINNET_URL="your_mainnet_rpc_url"
SEPOLIA_RPC_URL="your_sepolia_rpc_url"

# Required for integration tests
PRIVATE_KEY="your_private_key"
FLASHBOTS_RELAY_SIGNING_KEY="your_flashbots_key"

# Contract addresses
WETH_ADDRESS="0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
BUNDLE_EXECUTOR_ADDRESS="your_deployed_contract_address"

# Trading parameters
MIN_PROFIT_ETH="0.1"
GAS_LIMIT="500000"
MAX_PRIORITY_FEE="2"
MINER_REWARD_PERCENTAGE="80"
```

### Installation

```bash
npm install
```

## 🧪 Test Suites

### 1. Unit Tests

Unit tests focus on individual components and pure functions:

```bash
# Run all unit tests
npm run test:unit

# Run specific unit test files
npm test test/unit/HybridOptimizer.test.ts
```

**Coverage includes:**
- HybridOptimizer algorithms
- Utility functions
- Configuration validation
- Price calculation logic

### 2. Integration Tests

Integration tests validate end-to-end workflows using mainnet forking:

```bash
# Run all integration tests
npm run test:integration

# Run specific integration test suites
npm test test/integration/arbitrage.test.ts
npm test test/integration/bundle-operations.test.ts
npm test test/integration/contracts.test.ts
```

**Test Categories:**

#### Arbitrage Detection Tests (`arbitrage.test.ts`)
- Network connectivity validation
- Market data collection from live DEXes
- Price difference detection algorithms
- Arbitrage opportunity identification

#### Bundle Operations Tests (`bundle-operations.test.ts`)
- Flashbots provider setup
- Transaction bundle creation
- Bundle simulation and validation
- Gas optimization strategies
- MEV protection mechanisms

#### Smart Contract Tests (`contracts.test.ts`)
- Contract deployment on forked mainnet
- BundleExecutor functionality
- FlashLoan execution logic
- Access control validation
- Gas estimation and optimization

### 3. MEV-Share Tests

Specialized tests for MEV-Share functionality:

```bash
# Run MEV-Share specific tests
npm run test:mevshare

# Run individual MEV-Share test files
npm test test/mevshare/MevShareArbitrage.test.ts
npm test test/mevshare/MevShareArbitrage.mainnet.test.ts
```

### 4. Full Test Suite

Run all tests with mainnet forking:

```bash
# Complete test suite
npm test

# Test with verbose output
npm test -- --verbose

# Test with coverage report
npm run test:coverage
```

## 🔧 Test Configuration

### Hardhat Configuration

Tests use Hardhat's mainnet forking feature for realistic testing:

```javascript
// hardhat.config.ts
networks: {
  hardhat: {
    forking: {
      url: process.env.ETH_MAINNET_URL,
      blockNumber: 19000000 // Pinned for consistent testing
    }
  }
}
```

### Test Environment Variables

Tests require specific environment configuration:

```env
# Test-specific settings
NODE_ENV=test
HARDHAT_NETWORK=hardhat
ENABLE_GAS_REPORT=true
```

## 📊 Test Coverage

### Coverage Reports

Generate detailed coverage reports:

```bash
# Generate coverage report
npm run coverage

# View coverage in browser
open coverage/index.html
```

**Target Coverage Metrics:**
- Lines: >90%
- Functions: >90%
- Branches: >85%
- Statements: >90%

### Key Areas Covered

1. **Arbitrage Logic**
   - Price calculation accuracy
   - Profit estimation algorithms
   - Market data validation

2. **Smart Contracts**
   - Deployment and initialization
   - Function execution
   - Access control mechanisms
   - Error handling

3. **Bundle Operations**
   - Transaction creation
   - Bundle simulation
   - Gas optimization
   - Flashbots integration

4. **Error Handling**
   - Network failures
   - Invalid data handling
   - Circuit breaker functionality

## 🐛 Debugging Tests

### Common Issues and Solutions

#### RPC Connection Issues
```bash
# Test RPC connectivity
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  $ETH_MAINNET_URL
```

#### Insufficient Test Account Balance
```bash
# Check account balance
npm run check-balance

# Fund test account if needed (testnet only)
npm run fund-account
```

#### Hardhat Network Issues
```bash
# Reset Hardhat network
npx hardhat clean
npx hardhat compile

# Restart with fresh fork
npm test -- --reset
```

### Test Debugging Options

```bash
# Run tests with debug output
DEBUG=* npm test

# Run specific test with timeout increase
npm test test/integration/contracts.test.ts -- --timeout 60000

# Run tests in watch mode
npm test -- --watch
```

## 🚀 Continuous Integration

### GitHub Actions Configuration

```yaml
name: Test Suite
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run lint
      - run: npm test
        env:
          ETH_MAINNET_URL: ${{ secrets.ETH_MAINNET_URL }}
```

### Pre-commit Hooks

Install pre-commit hooks for automatic testing:

```bash
# Install husky
npm install --save-dev husky

# Setup pre-commit hook
npx husky add .husky/pre-commit "npm test"
```

## 📝 Writing New Tests

### Test Structure Guidelines

```typescript
describe('Component Name', () => {
  let componentInstance: ComponentType;
  
  before(async () => {
    // Setup code that runs once before all tests
  });

  beforeEach(async () => {
    // Setup code that runs before each test
    componentInstance = new ComponentType();
  });

  describe('Functionality Group', () => {
    it('should perform specific action correctly', async () => {
      // Arrange
      const input = createTestInput();
      
      // Act
      const result = await componentInstance.performAction(input);
      
      // Assert
      expect(result).to.equal(expectedOutput);
    });
  });

  after(async () => {
    // Cleanup code
  });
});
```

### Best Practices

1. **Descriptive Test Names**: Use clear, descriptive test names
2. **Arrange-Act-Assert**: Follow the AAA pattern
3. **Test Isolation**: Each test should be independent
4. **Mock External Dependencies**: Use mocks for external services
5. **Error Testing**: Test both success and failure cases

### Integration Test Guidelines

```typescript
describe('Integration Test', () => {
  before(async function() {
    this.timeout(60000); // Increase timeout for setup
    // Fork mainnet and setup contracts
  });

  it('should execute end-to-end workflow', async function() {
    this.timeout(30000); // Increase timeout for complex operations
    // Test full workflow
  });
});
```

## 📈 Performance Testing

### Gas Usage Analysis

```bash
# Enable gas reporting
REPORT_GAS=true npm test

# Analyze gas usage patterns
npm run gas-report
```

### Load Testing

```bash
# Run performance benchmarks
npm run benchmark

# Load test with multiple concurrent operations
npm run load-test
```

## 🔒 Security Testing

### Smart Contract Security

```bash
# Run security analysis
npm run security-check

# Formal verification (if configured)
npm run verify-contracts
```

### Dependency Auditing

```bash
# Audit npm dependencies
npm audit

# Fix vulnerabilities
npm audit fix
```

## 📋 Test Checklist

Before deploying to production, ensure all tests pass:

- [ ] Unit tests pass (>90% coverage)
- [ ] Integration tests pass on mainnet fork
- [ ] MEV-Share tests validate correctly
- [ ] Contract tests deploy and execute successfully
- [ ] Gas optimization tests show reasonable costs
- [ ] Security tests pass without critical issues
- [ ] Performance tests meet benchmarks
- [ ] All linting rules pass

## 🆘 Getting Help

If you encounter issues with tests:

1. Check the [troubleshooting section](#debugging-tests)
2. Review test logs for specific error messages
3. Ensure environment variables are set correctly
4. Verify RPC endpoint connectivity and limits
5. Check for sufficient test account balance

For complex issues, consider:
- Running tests in isolation
- Checking network connectivity
- Validating contract deployments
- Reviewing recent changes to dependencies