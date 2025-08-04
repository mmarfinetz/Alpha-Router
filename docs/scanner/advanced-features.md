# Advanced MEV Market Scanner - Features & Architecture

## 🎯 Overview

The Advanced MEV Market Scanner is a sophisticated tool for identifying and analyzing arbitrage opportunities across decentralized exchanges (DEXes) on Ethereum. It leverages the optimization algorithms from the core MEV bot to detect profitable price differences between Uniswap V2-like exchanges.

Unlike the basic scanner, the advanced scanner:
1. Uses the full `Arbitrage` class with its optimization algorithms
2. Can optionally execute trades through Flashbots bundles
3. Provides more detailed analysis of potential profits
4. Incorporates gas price management and circuit breaker patterns

## 🏗 Architecture

The advanced scanner consists of several key components:

### Core Components

#### 1. Provider Connection
- Connects to Ethereum via a JSON-RPC endpoint
- Handles network communication and blockchain queries
- Implements connection pooling and retry logic

#### 2. Market Data Collection
- Uses `UniswapV2EthPair` to fetch and update market data
- Retrieves reserves from DEX pairs using multicall for efficiency
- Maintains real-time market state

#### 3. Arbitrage Engine
- Leverages the `Arbitrage` class for opportunity detection
- Uses optimization algorithms to identify profitable trades
- Calculates optimal trade volumes and expected profits

#### 4. Display System
- Formats and displays arbitrage opportunities
- Shows token symbols, reserves, prices, and profit estimates
- Provides detailed analytics and metrics

#### 5. Execution System (Optional)
- Can execute trades via Flashbots bundles
- Includes retry logic and error handling
- Implements slippage protection

### Supporting Components

#### 1. Circuit Breaker
- Prevents excessive failed operations
- Implements backoff strategy for error conditions
- Monitors system health and performance

#### 2. Gas Price Manager
- Optimizes gas prices for transaction submission
- Balances cost vs. probability of inclusion
- Implements EIP-1559 dynamic pricing

#### 3. Token Information
- Maintains comprehensive token metadata
- Handles decimal conversions and formatting
- Provides symbol mapping for display

## 🚀 Advanced Usage

### Starting the Advanced Scanner

```bash
# Run the advanced market scanner
./scripts/scanner/advanced.sh

# Or run directly with TypeScript
npx ts-node src/advanced-scanner.ts
```

### Configuration Options

Create an advanced configuration file:

```typescript
// config/advanced-scanner.config.ts
export const AdvancedScannerConfig = {
  // Scanning parameters
  scanInterval: 30000, // 30 seconds
  maxConcurrentScans: 5,
  
  // Profitability thresholds
  minProfitETH: 0.01,
  minProfitPercentage: 1.0,
  
  // Gas management
  maxGasPrice: parseUnits('100', 'gwei'),
  priorityFee: parseUnits('2', 'gwei'),
  
  // Circuit breaker
  maxFailures: 5,
  resetTimeout: 300000, // 5 minutes
  
  // Execution settings
  executeArbitrage: false,
  maxSlippage: 0.5, // 0.5%
  deadline: 300 // 5 minutes
};
```

### Example Output

```
=== Advanced MEV Market Scanner ===
Initializing...

Connected to network: homestead
Current block: 18,123,456
Gas price: 25.5 gwei (base: 23.2, priority: 2.3)

Using wallet address: 0x1234...5678
Available balance: 5.25 ETH

Starting continuous market scanning...
Scanning interval: 30 seconds

=== Scanning markets for arbitrage opportunities ===

Fetching markets...
Found 1,250 market pairs across 625 tokens

Updating market reserves using multicall...
Reserves updated successfully (batch size: 100)

Evaluating markets for arbitrage opportunities...
Analyzed 1,250 pairs in 2.3 seconds

=== Found 3 Arbitrage Opportunities ===

Opportunity #1:
  Pair: WETH-USDT
  Buy from: Uniswap V2 (0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852)
  Sell to: SushiSwap (0x06da0fd433C1A5d7a4faa01111c044910A184553)
  
  Optimal Volume: 1.5 ETH
  Expected Input: 1.5000 WETH
  Expected Output: 1.5123 WETH
  Gross Profit: 0.0123 WETH ($29.52)
  
  Cost Analysis:
    Gas cost: ~0.0025 ETH ($6.00)
    Slippage: ~0.0008 ETH ($1.92)
    Total costs: 0.0033 ETH ($7.92)
  
  Net Profit: 0.0090 ETH ($21.60)
  ROI: 0.60%
  Confidence: 87%

Opportunity #2:
  Pair: USDC-DAI
  Buy from: SushiSwap (0x...)
  Sell to: Uniswap V2 (0x...)
  Net Profit: 0.0045 ETH ($10.80)
  ROI: 0.34%

Opportunity #3:
  Pair: WBTC-WETH
  Buy from: Uniswap V2 (0x...)
  Sell to: SushiSwap (0x...)
  Net Profit: 0.0032 ETH ($7.68)
  ROI: 0.28%

=== Execution Status ===
Arbitrage execution is DISABLED
Set EXECUTE_ARBITRAGE=true to enable trade execution

Current block: 18,123,456
Next scan in: 28 seconds

=== Performance Metrics ===
Scan duration: 2.3s
RPC calls: 157
Opportunities found: 3
Success rate: 100%
Circuit breaker: OK
```

## 🔧 Optimization Algorithms

### Arbitrage Detection Algorithm

The advanced scanner uses a multi-step process:

1. **Market Discovery**: Identify all relevant trading pairs
2. **Reserve Updates**: Batch update all market reserves
3. **Opportunity Screening**: Quick profit estimation
4. **Detailed Analysis**: Precise calculation for promising opportunities
5. **Execution Planning**: Optimal trade sizing and routing

### Profit Calculation

```typescript
class ProfitCalculator {
  calculateOptimalVolume(marketA: Market, marketB: Market): BigNumber {
    // Use quadratic formula for optimal volume
    const k1 = marketA.reserve0.mul(marketA.reserve1);
    const k2 = marketB.reserve0.mul(marketB.reserve1);
    
    // Calculate optimal input that maximizes profit
    const optimalInput = this.solveOptimalInput(k1, k2, marketA.fee, marketB.fee);
    return optimalInput;
  }
  
  estimateGasCost(complexity: number): BigNumber {
    const baseGas = 150000; // Base arbitrage execution
    const additionalGas = complexity * 50000; // Per additional hop
    return BigNumber.from(baseGas + additionalGas);
  }
}
```

### Circuit Breaker Implementation

```typescript
class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }
  
  private onFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    
    if (this.failures >= this.maxFailures) {
      this.state = 'OPEN';
    }
  }
}
```

## 🎛 Advanced Configuration

### Multi-Exchange Support

Configure additional exchanges:

```typescript
const EXCHANGES = [
  {
    name: 'Uniswap V2',
    factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    fee: 0.003, // 0.3%
    priority: 1
  },
  {
    name: 'SushiSwap',
    factory: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
    fee: 0.003,
    priority: 2
  },
  {
    name: 'Shibaswap',
    factory: '0x115934131916C8b277DD010Ee02de363c09d037c',
    fee: 0.003,
    priority: 3
  }
];
```

### Token Whitelist/Blacklist

Configure which tokens to monitor:

```typescript
const TOKEN_CONFIG = {
  whitelist: [
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    '0xA0b86a33E6417c7fb8248c5dB2E9d0a54E2F05D6', // USDC
    '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
    '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
  ],
  blacklist: [
    '0x...', // Known scam tokens
  ],
  minLiquidity: parseEther('10'), // Minimum pool liquidity
  maxSlippage: 0.05 // 5% max slippage
};
```

### Gas Optimization Strategy

```typescript
class GasManager {
  async getOptimalGasPrice(): Promise<GasPrice> {
    const network = await this.provider.getNetwork();
    const block = await this.provider.getBlock('latest');
    
    if (network.chainId === 1) { // Mainnet
      return this.calculateEIP1559GasPrice(block);
    } else {
      return this.calculateLegacyGasPrice();
    }
  }
  
  private calculateEIP1559GasPrice(block: Block): GasPrice {
    const baseFee = block.baseFeePerGas || parseUnits('20', 'gwei');
    const priorityFee = this.config.priorityFee;
    
    // Add 10% buffer for base fee volatility
    const maxFeePerGas = baseFee.mul(110).div(100).add(priorityFee);
    
    return {
      maxFeePerGas,
      maxPriorityFeePerGas: priorityFee,
      gasLimit: this.config.gasLimit
    };
  }
}
```

## 🎯 Execution Mode

### Enabling Trade Execution

To enable actual arbitrage execution:

1. Deploy BundleExecutor contract
2. Fund the contract with WETH
3. Set environment variables:

```env
EXECUTE_ARBITRAGE=true
BUNDLE_EXECUTOR_ADDRESS=0x...
PRIVATE_KEY=0x...
MIN_PROFIT_ETH=0.01
MAX_SLIPPAGE=0.5
```

### Execution Workflow

```typescript
class ArbitrageExecutor {
  async executeOpportunity(opportunity: ArbitrageOpportunity): Promise<boolean> {
    try {
      // 1. Pre-execution validation
      await this.validateOpportunity(opportunity);
      
      // 2. Build transaction bundle
      const bundle = await this.buildBundle(opportunity);
      
      // 3. Simulate bundle execution
      const simulation = await this.simulateBundle(bundle);
      
      if (!simulation.success) {
        throw new Error('Bundle simulation failed');
      }
      
      // 4. Submit to Flashbots
      const bundleResponse = await this.flashbotsProvider.sendBundle(bundle);
      
      // 5. Monitor inclusion
      return await this.waitForInclusion(bundleResponse);
      
    } catch (error) {
      this.logger.error('Execution failed:', error);
      return false;
    }
  }
}
```

### Risk Management

```typescript
const RISK_LIMITS = {
  maxTradeSize: parseEther('10'), // 10 ETH max per trade
  maxDailyLoss: parseEther('1'),  // 1 ETH max daily loss
  maxPositionSize: parseEther('50'), // 50 ETH max total position
  stopLossThreshold: 0.02, // 2% stop loss
  circuitBreakerThreshold: 5 // Max 5 failures before pause
};
```

## 📊 Monitoring & Analytics

### Performance Metrics

Track key performance indicators:

```typescript
interface ScannerMetrics {
  // Performance
  avgScanDuration: number;
  rpcCallsPerScan: number;
  successRate: number;
  
  // Opportunities
  opportunitiesFound: number;
  avgProfitPerOpportunity: number;
  executionRate: number;
  
  // System health
  circuitBreakerState: string;
  lastErrorTime: number;
  memoryUsage: number;
}
```

### Alerting System

Set up alerts for important events:

```typescript
class AlertManager {
  async sendAlert(type: AlertType, data: any) {
    switch (type) {
      case 'LARGE_OPPORTUNITY':
        if (data.profit > parseEther('0.1')) {
          await this.webhook.send(`Large arbitrage opportunity: ${formatEther(data.profit)} ETH profit`);
        }
        break;
        
      case 'EXECUTION_FAILURE':
        await this.webhook.send(`Execution failed: ${data.error}`);
        break;
        
      case 'CIRCUIT_BREAKER_OPEN':
        await this.webhook.send('Circuit breaker OPEN - scanner paused');
        break;
    }
  }
}
```

## 🔧 Troubleshooting

### Common Issues

1. **High Gas Costs**: Adjust gas price strategy or increase profit thresholds
2. **RPC Rate Limits**: Implement better caching and request batching
3. **Stale Data**: Reduce scan interval or improve data freshness checks
4. **Execution Failures**: Review slippage tolerance and deadline settings

### Debug Mode

Enable comprehensive debugging:

```bash
DEBUG=arbitrage:*,scanner:*,gas:* npm run scanner:advanced
```

### Performance Optimization

```typescript
// Use connection pooling
const provider = new ethers.providers.JsonRpcProvider({
  url: process.env.ETHEREUM_RPC_URL,
  throttleLimit: 10,
  timeout: 30000
});

// Implement smart caching
const cache = new NodeCache({ 
  stdTTL: 30, // 30 second cache
  checkperiod: 60 
});

// Batch RPC calls efficiently
const multicall = new Multicall(provider);
```

This advanced scanner provides the foundation for sophisticated MEV strategies while maintaining robust error handling and performance optimization.