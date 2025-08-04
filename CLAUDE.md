# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a MEV (Maximal Extractable Value) arbitrage bot built with TypeScript and Hardhat. The bot discovers, evaluates, and submits arbitrage opportunities to Flashbots bundles on Ethereum. It supports multiple operational modes including regular arbitrage, MEV-Share, WebSocket monitoring, and hybrid optimization strategies.

## Key Commands

### Build Commands
- `npm run build` - Compile TypeScript to JavaScript (main mode)
- `npm run build:ws` - Compile WebSocket version with separate tsconfig
- `npm run build:all` - Build both main and WebSocket versions
- `npm run build:scanner` - Compile scanner components with dedicated tsconfig
- `npm run compile` - Alias for TypeScript compilation
- `npm run prepare` - Automatic build on npm install

### Start Commands
- `npm run start` - Run main arbitrage bot via production shell script
- `npm run start:ws` - Run WebSocket version of the bot
- `npm run start:mevshare` - Run MEV-Share specific bot
- `npm run dev` - Build and start main bot in one command
- `npm run dev:ws` - Build and start WebSocket bot in one command

### Production Commands
- `npm run monitor` - Run bot in production mode (NODE_ENV=production)
- `npm run monitor:ws` - Run WebSocket bot in production mode

### Testing Commands
- `npm run test` - Run all tests using Hardhat with experimental VM modules
- `npm run test:unit` - Run unit tests only
- `npm run test:integration` - Run integration tests only
- `npm run test:mevshare` - Run MEV-Share specific tests via shell script
- `npm run test:hybrid` - Run hybrid optimization tests
- `npm run lint` - Run ESLint on source code

### Scanner Commands
- `npm run scanner` - Run basic scanner with ts-node
- `npm run scanner:basic` - Run basic market scanner via shell script
- `npm run scanner:simple` - Simple environment test and scanner validation
- `npm run scanner:advanced` - Run advanced market scanner via shell script
- `npm run scanner:advanced:direct` - Direct scanner execution with ts-node
- `npm run scanner:advanced:ts` - Advanced scanner using tsx runtime

### Development Scripts
- `./scripts/start.sh` - Production bot monitoring with auto-restart
- `./scripts/scanner/basic.sh` - Basic market scanning tools
- `./scripts/scanner/advanced.sh` - Advanced market analysis
- `./scripts/test/mevshare.sh` - MEV-Share test runner
- `./scripts/test/hybrid.mjs` - Hybrid optimization test suite

## Architecture

### Core Components

**Main Entry Points:**
- `src/index.ts` - Primary arbitrage bot with Flashbots integration
- `src/index.websocket.ts` - WebSocket-based monitoring and execution
- `src/index.mevshare.ts` - MEV-Share specific implementation

**Market Analysis:**
- `src/UniswapV2EthPair.ts` - Uniswap V2 pair analysis and market discovery
- `src/Arbitrage.ts` - Core arbitrage logic and profit calculations
- `src/EthMarket.ts` - Ethereum market abstraction
- `src/MevShareArbitrage.ts` - MEV-Share specific arbitrage strategies

**Scanner Infrastructure:**
- `src/scanner/` - Market scanning and discovery tools
  - `src/scanner/index.ts` - Main scanner entry point
  - `src/scanner/basic-scanner.ts` - Basic market scanning functionality
  - `src/scanner/advanced-scanner.ts` - Advanced market analysis tools
  - `src/scanner/market-scanner.ts` - Market discovery utilities

**Services:**
- `src/services/MulticallService.ts` - Batch RPC calls for efficiency
- `src/services/MevShareService.ts` - MEV-Share integration
- `src/services/CacheService.ts` - Market data caching

**Optimization:**
- `src/optimization/HybridOptimizer.ts` - Advanced optimization strategies and algorithms

**Utilities:**
- `src/utils/CircuitBreaker.ts` - Error handling and system protection
- `src/utils/GasPriceManager.ts` - Dynamic gas price management
- `src/utils/logger.ts` - Structured logging

**Configuration:**
- `src/config/` - Centralized configuration management
  - `src/config/config.ts` - System configuration and constants
  - `src/config/thresholds.ts` - Trading thresholds and limits

**Script Infrastructure:**
- `scripts/` - Production and development shell scripts
  - `scripts/start.sh` - Production bot monitoring with auto-restart
  - `scripts/scanner/basic.sh` - Basic market scanning execution
  - `scripts/scanner/advanced.sh` - Advanced market analysis execution
  - `scripts/test/mevshare.sh` - MEV-Share testing automation
  - `scripts/test/hybrid.mjs` - Hybrid optimization test runner

### Smart Contracts

Located in `contracts/` directory with Hardhat compilation:
- `BundleExecutor.sol` - Main execution contract for arbitrage bundles
- `FlashLoanExecutor.sol` - Flash loan execution logic
- `UniswapFlashQuery.sol` - Uniswap price queries

### Environment Setup

**Required Environment Variables:**
- `ETHEREUM_RPC_URL` - Ethereum RPC endpoint (cannot be same as Flashbots)
- `PRIVATE_KEY` - Private key for bot wallet
- `BUNDLE_EXECUTOR_ADDRESS` - Deployed BundleExecutor contract address
- `FLASHBOTS_RELAY_SIGNING_KEY` - Key for Flashbots authentication
- `MINER_REWARD_PERCENTAGE` - Percentage of profit to send to miners (default: 80)

**WebSocket Mode Variables (for `npm run start:ws`):**
- `ALCHEMY_WEBSOCKET_URL` - WebSocket URL for real-time blockchain monitoring (must start with `wss://`)
- `ETHEREUM_WS_URL` - Alternative WebSocket URL (fallback if ALCHEMY_WEBSOCKET_URL not set)

**Optional Configuration:**
- WebSocket mode can derive RPC URL from WebSocket URL if ETHEREUM_RPC_URL not provided
- Circuit breaker and gas price management use default configurations if not specified
- Scanner tools require RPC access but can operate without WebSocket connections

### Testing Framework

Uses Hardhat with Mocha/Chai for contract testing and Jest for TypeScript unit tests:

**Test Categories:**
- **Unit Tests**: `npm run test:unit` - Isolated component testing in `test/unit/`
- **Integration Tests**: `npm run test:integration` - Full system integration tests
- **Contract Tests**: `npm run test` - Hardhat-based smart contract testing
- **MEV-Share Tests**: `npm run test:mevshare` - Specialized MEV-Share testing via shell script
- **Hybrid Tests**: `npm run test:hybrid` - Advanced optimization algorithm testing

**Test Infrastructure:**
- Mainnet forking for realistic testing environment
- MEV-Share specific test suite in `test/mevshare/` with mock services
- Contract tests with deployment simulation in `test/integration/`
- Jest with ESM support for TypeScript unit testing
- 30-second timeout for network-dependent tests
- Experimental VM modules for modern JavaScript features

**Test Organization:**
- `test/unit/` - Unit tests for individual components
- `test/integration/` - Integration tests for full workflows
- `test/mevshare/` - MEV-Share specific test suite with mocks
- Shell script automation for complex test scenarios

### Build Configuration

**TypeScript Configurations:**
- `tsconfig.json` - Main TypeScript configuration for core bot
- `tsconfig.websocket.json` - WebSocket-specific build configuration
- `tsconfig.scanner.json` - Scanner tools build configuration
- `src/scanner/tsconfig.json` - Scanner-specific TypeScript settings

**Hardhat Configuration:**
- `hardhat.config.cjs` - CommonJS format configuration (migrated from .ts)
- Supports Solidity versions 0.6.12, 0.8.19, and 0.8.20
- Mainnet forking enabled for testing
- Optimization enabled with 200 runs
- Network configurations for Sepolia testnet
- Experimental VM modules support for ESM compatibility

**Jest Configuration:**
- `jest.config.js` - ESM-compatible testing configuration
- Uses `ts-jest` with ESM preset for TypeScript support
- 30-second test timeout for network operations
- Setup file integration for test environment preparation
- Configured to handle both `.ts` and `.js` file extensions

### Operational Modes

1. **Standard Arbitrage**: Monitor Uniswap pairs for price discrepancies using traditional RPC polling
2. **MEV-Share**: Participate in MEV-Share auctions for backrun opportunities with competitive bidding
3. **WebSocket Mode**: Real-time monitoring with WebSocket connections for low-latency execution
4. **Hybrid Optimization**: Advanced optimization strategies using HybridOptimizer algorithms
5. **Scanner Mode**: Market discovery and analysis tools
   - **Basic Scanner** (`npm run scanner:basic`): Simple market scanning for pair discovery
   - **Advanced Scanner** (`npm run scanner:advanced`): Comprehensive market analysis with profitability calculations
   - **Direct Scanner** (`npm run scanner:advanced:direct`): Direct execution scanner with ts-node
6. **Production Monitoring**: 
   - Auto-restart functionality with crash recovery (`scripts/start.sh`)
   - Continuous monitoring with logging and error handling
   - Circuit breaker protection for loss prevention
7. **Development Mode**: Enhanced development workflow with TypeScript watch modes and hot reloading
8. **Hybrid Testing Mode**: 
   - Advanced optimization algorithm testing (`npm run test:hybrid`)
   - Mathematical model validation and performance benchmarking
   - Integration testing with production-like scenarios

### Security Considerations

**Key Management:**
- Bot wallet and BundleExecutor owner keys must be kept secure
- BundleExecutor contract should be deployed from a secured account
- Store private keys in secure environment variables, never in code
- Use separate keys for testing and production environments

**Smart Contract Security:**
- Contract is designed to prevent WETH loss but malicious users could drain it
- Only deploy contracts from trusted, audited sources
- Verify contract addresses before deployment to production

**Operational Security:**
- Circuit breaker protection against excessive losses
- Gas price management to prevent overpaying
- Monitor and limit maximum transaction amounts
- Implement rate limiting for API calls and transaction submissions

**Shell Script Security:**
- Ensure shell scripts in `scripts/` directory have proper permissions (755)
- Validate all environment variables before script execution
- Use absolute paths in production scripts to prevent path injection
- Monitor script execution logs for suspicious activity
- Restrict script execution to authorized users only

**WebSocket Security:**
- Use secure WebSocket connections (wss://) for all real-time communications
- Validate WebSocket URL format and source
- Implement connection timeout and retry logic
- Monitor WebSocket connection health and detect anomalies

**Environment Security:**
- Use `.env` files for sensitive configuration (never commit to version control)
- Implement proper file permissions for configuration files
- Regularly rotate API keys and access tokens
- Use network firewalls to restrict access to RPC endpoints

### Script Documentation

The MEV bot includes a comprehensive shell script infrastructure for production monitoring, scanning, and testing automation.

**Production Monitoring (`scripts/start.sh`)**
- **Auto-Restart Functionality**: Automatically restarts the WebSocket bot on crashes
- **Crash Logging**: Logs all crashes with timestamps to `logs/crash_log.txt`
- **Configurable Limits**: Maximum 10 restart attempts with 30-second delays
- **Session Logging**: Creates timestamped log files for each bot session
- **Exit Code Tracking**: Monitors and logs exit codes for debugging
- **Usage**: `npm run start` (uses this script internally)

**Scanner Scripts**
- **Advanced Scanner** (`scripts/scanner/advanced.sh`):
  - Uses `tsx` for direct TypeScript execution
  - Sets production environment with arbitrage execution disabled by default
  - Bypasses module conflicts through direct TypeScript compilation
  - Usage: `npm run scanner:advanced`

- **Basic Scanner** (`scripts/scanner/basic.sh`):
  - Lightweight market scanning for pair discovery
  - Quick environment validation and setup
  - Usage: `npm run scanner:basic`

**Test Automation Scripts**
- **MEV-Share Testing** (`scripts/test/mevshare.sh`):
  - Automates MEV-Share specific test execution
  - Handles complex test setup and teardown
  - Usage: `npm run test:mevshare`

- **Hybrid Testing** (`scripts/test/hybrid.mjs`):
  - ES module-based test runner for optimization algorithms
  - Mathematical model validation and performance benchmarking
  - Usage: `npm run test:hybrid`

**Script Maintenance**
- All scripts use proper error handling and logging
- Scripts validate environment variables before execution
- Log files are automatically organized by timestamp
- Configuration can be modified in script headers
- Scripts support graceful shutdown and cleanup

### Frontend

React-based monitoring dashboard in `frontend/` directory:
- Real-time WebSocket connection to bot
- Transaction logging and profit tracking
- System status monitoring
- Market metrics visualization