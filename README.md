# MEV Arbitrage Bot

A sophisticated MEV (Maximal Extractable Value) arbitrage bot built with TypeScript and Hardhat. The bot discovers, evaluates, and submits arbitrage opportunities to Flashbots bundles on Ethereum. It supports multiple operational modes including regular arbitrage, MEV-Share, WebSocket monitoring, and hybrid optimization strategies.

## 🚀 Features

- **Multi-Mode Operation**: Regular arbitrage, MEV-Share, WebSocket monitoring, hybrid optimization
- **Flashbots Integration**: Private mempool submission via Flashbots bundles
- **Smart Contract Execution**: Automated arbitrage execution through deployed contracts
- **Real-time Market Scanning**: Continuous monitoring of DEX pairs for opportunities
- **Gas Optimization**: Dynamic gas price management and circuit breaker protection
- **Comprehensive Testing**: Full test suite with integration and unit tests

## 📁 Project Structure

```
├── src/                    # Source code
│   ├── index.ts           # Main arbitrage bot
│   ├── index.websocket.ts # WebSocket-based monitoring
│   ├── index.mevshare.ts  # MEV-Share implementation
│   ├── scanner/           # Market scanning utilities
│   ├── services/          # Core services (Multicall, MEV-Share, Cache)
│   ├── utils/             # Utilities (Circuit breaker, Gas manager, Logger)
│   └── config/            # Configuration files
├── contracts/             # Smart contracts
├── test/                  # Test suite
│   ├── unit/             # Unit tests
│   ├── integration/      # Integration tests
│   └── mevshare/         # MEV-Share specific tests
├── scripts/              # Utility scripts
├── docs/                 # Documentation
└── frontend/             # React monitoring dashboard
```

## 📋 Prerequisites

- Node.js (v16+)
- TypeScript
- Hardhat
- Ethereum RPC endpoint (Alchemy, Infura, etc.)
- Basic understanding of DeFi and arbitrage concepts

## 🔑 Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `ETHEREUM_RPC_URL` | Ethereum RPC endpoint (different from Flashbots RPC) | Yes | - |
| `PRIVATE_KEY` | Private key for transaction submission | Yes | - |
| `FLASHBOTS_RELAY_SIGNING_KEY` | Key for signing Flashbots payloads | No | Random key |
| `HEALTHCHECK_URL` | URL for monitoring successful bundle submissions | No | - |
| `MINER_REWARD_PERCENTAGE` | Percentage of profits allocated to miners (0-100) | No | 80 |

## 🛠 Setup

### Installation

```bash
npm install
```

### Environment Configuration

Create a `.env` file with the required variables:

```env
# Required
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/your-api-key
PRIVATE_KEY=your_private_key
BUNDLE_EXECUTOR_ADDRESS=your_deployed_contract_address

# Optional
FLASHBOTS_RELAY_SIGNING_KEY=random_private_key_for_flashbots_auth
MINER_REWARD_PERCENTAGE=80
HEALTHCHECK_URL=your_health_check_endpoint
```

### Smart Contract Deployment

1. Deploy the BundleExecutor contract:
```bash
npx hardhat run scripts/deploy.ts --network mainnet
```

2. Transfer WETH to the deployed contract for arbitrage capital.

## 🚀 Usage

### Development Mode

```bash
# Build and start main bot
npm run dev

# Build and start WebSocket bot
npm run dev:ws

# Run market scanner
npm run scanner
```

### Production Mode

```bash
# Build the project
npm run build

# Start in production
npm run monitor

# Start WebSocket version
npm run monitor:ws
```

### Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:mevshare

# Run linting
npm run lint
```

## 🔧 Configuration

### Operational Modes

1. **Standard Arbitrage** (`npm run start`)
   - Monitors Uniswap pairs for price discrepancies
   - Submits profitable trades via Flashbots

2. **MEV-Share** (`npm run start:mevshare`)
   - Participates in MEV-Share auctions
   - Backruns profitable transactions

3. **WebSocket Mode** (`npm run start:ws`)
   - Real-time monitoring with WebSocket connections
   - Lower latency opportunity detection

4. **Scanner Mode** (`npm run scanner`)
   - Market discovery and analysis
   - No trade execution (monitoring only)

### Key Parameters

- `MINER_REWARD_PERCENTAGE`: Percentage of profit sent to miners (default: 80%)
- `MIN_PROFIT_ETH`: Minimum profit threshold for trade execution
- `GAS_LIMIT`: Maximum gas limit for transactions
- `MAX_PRIORITY_FEE`: Maximum priority fee for EIP-1559 transactions

## 📊 Monitoring

The bot includes a React-based frontend for real-time monitoring:

```bash
cd frontend
npm install
npm start
```

Features:
- Real-time WebSocket connection to bot
- Transaction logging and profit tracking
- System status monitoring
- Market metrics visualization

## 🔒 Security Considerations

- **Private Key Security**: Bot wallet and BundleExecutor owner keys must be secured
- **Contract Security**: BundleExecutor prevents WETH loss but malicious actors could drain it
- **Circuit Breaker**: Automatic protection against excessive losses
- **Gas Management**: Prevents overpaying for gas in competitive environments

## 📚 Documentation

- [Testing Guide](docs/testing.md) - Comprehensive testing instructions
- [Scanner Documentation](docs/scanner/) - Market scanning tools
- [API Reference](docs/api/) - Smart contract interfaces
- [Deployment Guide](docs/deployment/) - Production deployment instructions

## 🧪 Testing

The project includes comprehensive test coverage:

- **Unit Tests**: Individual component testing
- **Integration Tests**: End-to-end arbitrage workflows
- **Contract Tests**: Smart contract functionality
- **MEV-Share Tests**: MEV-Share specific functionality

Run tests with mainnet forking for realistic conditions:

```bash
# Test with mainnet fork
npm test

# Test specific components
npm run test:arbitrage
npm run test:contracts
npm run test:bundles
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## ⚠️ Disclaimer

This software is for educational and research purposes. MEV arbitrage involves significant financial risk. The authors are not responsible for any financial losses. Use at your own risk and ensure you understand the implications before deploying with real funds.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Resources

- [Flashbots Documentation](https://docs.flashbots.net/)
- [MEV-Share Documentation](https://docs.flashbots.net/flashbots-mev-share/introduction)
- [Uniswap V2 Documentation](https://docs.uniswap.org/protocol/V2/introduction)
- [Hardhat Documentation](https://hardhat.org/docs)
