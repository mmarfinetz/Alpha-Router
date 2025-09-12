import { BigNumber } from 'ethers';

// Scanner configuration for maximum market discovery
export const SCANNER_CONFIG = {
  // Batch processing settings
  BATCH_SIZE: 1000,           // Increased batch size for more pairs per request
  CONCURRENT_REQUESTS: 30,    // Increased concurrent requests for better throughput
  BATCH_DELAY: 25,            // Minimal delay between batches (ms)
  MAX_PAIRS_PER_DEX: 10000,   // Maximum pairs to load per DEX
  MAX_TOTAL_PAIRS: 50000,     // Maximum total pairs across all DEXes
  
  // Liquidity thresholds (extremely low for maximum discovery)
  MIN_LIQUIDITY_ETH: BigNumber.from('10000000000000000'),  // 0.01 ETH (10x lower)
  MIN_WETH_BALANCE: BigNumber.from('10000000000000000'),   // 0.01 ETH
  
  // Price impact thresholds
  MAX_PRICE_IMPACT_PERCENT: 10,  // Allow up to 10% price impact
  
  // Profit thresholds (very low for discovery)
  MIN_PROFIT_WEI: BigNumber.from('100000000000000'),  // 0.0001 ETH
  
  // Market filtering
  SKIP_LOW_LIQUIDITY: false,  // Don't skip low liquidity pairs during discovery
  SKIP_NO_WETH: false,        // Don't skip pairs without WETH
  
  // DEX-specific settings
  PRIORITIZE_DEXES: [
    '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', // Uniswap V2 (highest volume)
    '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac', // SushiSwap
  ],
  
  // Performance settings
  USE_MULTICALL: true,
  CACHE_DURATION_MS: 30000,  // Cache market data for 30 seconds
  
  // Logging
  VERBOSE_LOGGING: false,     // Reduce logging for performance
  LOG_BATCH_PROGRESS: true,   // Show batch processing progress
};

// Export convenience functions
export function getScannerConfig(mode?: 'discovery' | 'production' | 'aggressive') {
  switch (mode) {
    case 'production':
      return {
        ...SCANNER_CONFIG,
        MIN_LIQUIDITY_ETH: BigNumber.from('1000000000000000000'), // 1 ETH
        MIN_PROFIT_WEI: BigNumber.from('10000000000000000'),     // 0.01 ETH
        MAX_PAIRS_PER_DEX: 1000,
        SKIP_LOW_LIQUIDITY: true,
        SKIP_NO_WETH: true,
      };
    
    case 'aggressive':
      return {
        ...SCANNER_CONFIG,
        MIN_LIQUIDITY_ETH: BigNumber.from('50000000000000000'),  // 0.05 ETH
        MIN_PROFIT_WEI: BigNumber.from('1000000000000000'),      // 0.001 ETH
        MAX_PAIRS_PER_DEX: 5000,
      };
    
    case 'discovery':
    default:
      return SCANNER_CONFIG;
  }
}