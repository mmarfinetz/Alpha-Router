# MEV Market Scanner - Basic Usage

This tool provides real-time monitoring of Ethereum DEX markets to identify price differences and arbitrage opportunities. It leverages the algorithms from the MEV bot to continuously scan Uniswap V2 and SushiSwap markets.

## 🎯 Features

- **Basic Market Scanner**: Monitors DEX pairs and displays price differences between markets
- **Advanced Market Scanner**: Uses sophisticated optimization algorithms to identify profitable arbitrage opportunities
- **Real-time Updates**: Continuously scans markets at configurable intervals
- **Detailed Output**: Shows reserves, prices, and potential profit calculations
- **Execution Option**: Advanced scanner can optionally execute arbitrage trades (disabled by default)

## 📋 Prerequisites

- Node.js (v14+)
- TypeScript
- Ethereum RPC endpoint (Alchemy, Infura, etc.)
- For advanced scanner: Deployed BundleExecutor contract and private key

## ⚙️ Configuration

Set the following environment variables in your `.env` file:

```env
# Required for both scanners
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/your-api-key

# Required only for advanced scanner
PRIVATE_KEY=your_private_key
BUNDLE_EXECUTOR_ADDRESS=your_bundle_executor_contract_address
EXECUTE_ARBITRAGE=false  # Set to true to enable actual arbitrage execution
```

## 🚀 Basic Market Scanner

The basic scanner monitors DEX pairs and displays price differences without executing trades.

### Usage

```bash
# Run the basic market scanner
./scripts/scanner/basic.sh

# Or run directly with npm
npm run scanner
```

### Example Output

```
=== MEV Market Scanner ===
Initializing...

Connected to network: homestead

Starting continuous market scanning...
Scanning interval: 10 seconds

Scanning markets for arbitrage opportunities...

Checking Uniswap V2 WETH-USDC (0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc)...
Pair: WETH-USDC
Token0 (WETH) Reserve: 4866.495379988073
Token1 (USDC) Reserve: 11356369.265791
Price WETH/USDC: 2333.5826665921613
Price USDC/WETH: 0.0004285256375598411

Checking SushiSwap WETH-USDC (0x397FF1542f962076d0BFE58eA045FfA2d347ACa0)...
Pair: WETH-USDC
Token0 (WETH) Reserve: 1319.578721290894
Token1 (USDC) Reserve: 3079357.463205
Price WETH/USDC: 2333.5913299606564
Price USDC/WETH: 0.00042852404667481327

Analyzing token pair: WETH-USDC
Price difference between Uniswap V2 WETH-USDC and SushiSwap WETH-USDC: 0.0004%

Arbitrage scan completed!
```

### Interpretation

- **Price Information**: Shows current reserves and calculated prices for each token pair
- **Price Differences**: Displays percentage differences between markets
- **Arbitrage Signals**: Highlights opportunities above configured thresholds

## 📊 Market Data

### Monitored Pairs

The basic scanner monitors these default pairs:

```javascript
const MONITORED_PAIRS = [
  // ETH-USDC pairs
  { address: '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc', name: 'Uniswap V2 ETH-USDC' },
  { address: '0x397FF1542f962076d0BFE58eA045FfA2d347ACa0', name: 'SushiSwap ETH-USDC' },
  
  // ETH-USDT pairs
  { address: '0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852', name: 'Uniswap V2 ETH-USDT' },
  { address: '0x06da0fd433C1A5d7a4faa01111c044910A184553', name: 'SushiSwap ETH-USDT' },
  
  // Add more pairs as needed
];
```

### Price Calculation

Prices are calculated using the constant product formula:

```
Price Token A = Reserve B / Reserve A
Price Token B = Reserve A / Reserve B
```

Price differences are calculated as:

```
Price Difference % = |Price_Market1 / Price_Market2 - 1| * 100
```

## ⚙️ Customization

### Scan Interval

Modify the scanning frequency by updating the configuration:

```javascript
const SCAN_INTERVAL_MS = 10000; // 10 seconds (default)
```

### Price Difference Threshold

Set minimum price difference to display:

```javascript
const MIN_PRICE_DIFFERENCE_THRESHOLD = 0.1; // 0.1% minimum difference
```

### Token Information

Add custom token mappings for better display:

```javascript
const TOKEN_SYMBOLS = {
  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': 'WETH',
  '0xA0b86a33E6417c7fb8248c5dB2E9d0a54E2F05D6': 'USDC',
  '0xdAC17F958D2ee523a2206206994597C13D831ec7': 'USDT'
};

const TOKEN_DECIMALS = {
  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': 18, // WETH
  '0xA0b86a33E6417c7fb8248c5dB2E9d0a54E2F05D6': 6,  // USDC
  '0xdAC17F958D2ee523a2206206994597C13D831ec7': 6   // USDT
};
```

## 🔧 Command Line Options

The scanner supports various command line options:

```bash
# Set custom scan interval
npm run scanner -- --interval 5000

# Set minimum price difference threshold
npm run scanner -- --threshold 0.5

# Enable verbose logging
npm run scanner -- --verbose

# Monitor specific pairs only
npm run scanner -- --pairs eth-usdc,eth-usdt
```

## 📈 Performance Optimization

### RPC Rate Limiting

To avoid hitting RPC rate limits:

1. Increase scan interval for free tier RPC providers
2. Use premium RPC services for higher frequency scanning
3. Implement exponential backoff on failures

```javascript
const RPC_CONFIG = {
  freeProvider: { maxRequestsPerSecond: 5, scanInterval: 30000 },
  paidProvider: { maxRequestsPerSecond: 100, scanInterval: 5000 }
};
```

### Multicall Optimization

For scanning many pairs efficiently:

```javascript
// Use multicall to batch multiple reserve calls
const reserves = await multicall.callStatic.aggregate(calls);
```

## 🛠 Troubleshooting

### Common Issues

#### "Invalid JSON RPC response"
- Check your RPC URL and network connectivity
- Verify API key is valid and has sufficient credits
- Try a different RPC provider

#### "No opportunities found"
- Lower the price difference threshold
- Check if markets are active (sufficient liquidity)
- Verify pair addresses are correct

#### High CPU usage
- Increase scan interval to reduce frequency
- Optimize token list (monitor fewer pairs)
- Check for memory leaks in long-running instances

### Debug Mode

Enable detailed logging for troubleshooting:

```bash
DEBUG=scanner:* npm run scanner
```

### Network Status Check

Verify connectivity before scanning:

```bash
# Test RPC connection
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  $ETHEREUM_RPC_URL
```

## 📝 Logs and Monitoring

### Log Output

The scanner generates structured logs:

```
[2023-07-28 10:30:00] INFO: Starting market scan
[2023-07-28 10:30:01] DEBUG: Fetching reserves for 4 pairs
[2023-07-28 10:30:02] INFO: Found price difference: 0.05% (WETH-USDC)
[2023-07-28 10:30:03] INFO: Scan completed in 3.2s
```

### Performance Metrics

Track scanner performance:

- Scan completion time
- RPC request count
- Opportunities detected
- Error rate

## 🚀 Next Steps

After familiarizing yourself with the basic scanner:

1. Try the [Advanced Scanner](advanced-features.md) for more sophisticated analysis
2. Set up monitoring alerts for significant price differences
3. Integrate with trading execution systems
4. Explore historical data analysis capabilities