import { BigNumber } from 'ethers';

export interface MarketFilters {
  // Core fields for compatibility
  minLiquidityETH: number;
  minSpreadBasisPoints: number;
  maxGasPrice: number;
  enabledDEXes: string[];
  priorityTokens: string[];
  
  // Extended fields
  MIN_LIQUIDITY_USD: number;
  MAX_PRICE_IMPACT: number;
  MIN_PROFIT_ETH: BigNumber;
  MAX_GAS_PRICE: BigNumber;
  PRIORITY_TOKENS: string[];
  MIN_SPREAD_BASIS_POINTS: number;
  MAX_SLIPPAGE_PERCENT: number;
  MAX_TRADE_PERCENT_OF_LIQUIDITY: number;
  MIN_RESERVE_RATIO: number;
  MAX_RESERVE_RATIO: number;
  BASE_GAS_COST: BigNumber;
  GAS_COST_PER_SWAP: BigNumber;
  EXCLUDED_FACTORIES: string[];
  PREFERRED_FACTORIES: string[];
  MAX_DATA_AGE_MS: number;
  MIN_BLOCK_CONFIRMATIONS: number;
}

export const MARKET_FILTERS: MarketFilters = {
  // Core compatibility fields
  minLiquidityETH: 0.1,
  minSpreadBasisPoints: 10, // 0.1%
  maxGasPrice: 100,
  enabledDEXes: [], // Empty means all enabled
  priorityTokens: [
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    '0xA0b86a33E6417c17e22F6Aea9bF4b2e5FC853bDE', // USDC
    '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
    '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
    '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
  ],
  
  // Extended fields
  MIN_LIQUIDITY_USD: 10000,
  MAX_PRICE_IMPACT: 0.05, // 5%
  MIN_PROFIT_ETH: BigNumber.from('1000000000000000'), // 0.001 ETH
  MAX_GAS_PRICE: BigNumber.from('100'), // 100 gwei
  
  PRIORITY_TOKENS: [
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    '0xA0b86a33E6417c17e22F6Aea9bF4b2e5FC853bDE', // USDC
    '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
    '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
    '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
    '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
    '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI
    '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', // MATIC
    '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', // SHIB
  ],
  
  MIN_SPREAD_BASIS_POINTS: 10, // 0.1%
  MAX_SLIPPAGE_PERCENT: 5, // 5%
  MAX_TRADE_PERCENT_OF_LIQUIDITY: 10, // 10%
  MIN_RESERVE_RATIO: 0.001, // 1000:1 ratio maximum imbalance
  MAX_RESERVE_RATIO: 1000,
  
  BASE_GAS_COST: BigNumber.from('350000'),
  GAS_COST_PER_SWAP: BigNumber.from('150000'),
  
  EXCLUDED_FACTORIES: [],
  PREFERRED_FACTORIES: [
    '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', // Uniswap V2
    '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac', // SushiSwap
  ],
  
  MAX_DATA_AGE_MS: 30000, // 30 seconds
  MIN_BLOCK_CONFIRMATIONS: 1,
};

// Additional filter configurations for different market conditions
export const AGGRESSIVE_MARKET_FILTERS: MarketFilters = {
  ...MARKET_FILTERS,
  minLiquidityETH: 0.05,
  minSpreadBasisPoints: 5, // 0.05%
  MIN_LIQUIDITY_USD: 5000,
  MIN_PROFIT_ETH: BigNumber.from('500000000000000'), // 0.0005 ETH
  MAX_PRICE_IMPACT: 0.1, // 10%
  MIN_SPREAD_BASIS_POINTS: 5,
  MAX_SLIPPAGE_PERCENT: 10,
  MAX_TRADE_PERCENT_OF_LIQUIDITY: 15,
};

export const CONSERVATIVE_MARKET_FILTERS: MarketFilters = {
  ...MARKET_FILTERS,
  minLiquidityETH: 1,
  minSpreadBasisPoints: 50, // 0.5%
  MIN_LIQUIDITY_USD: 50000,
  MIN_PROFIT_ETH: BigNumber.from('10000000000000000'), // 0.01 ETH
  MAX_PRICE_IMPACT: 0.02, // 2%
  MIN_SPREAD_BASIS_POINTS: 50,
  MAX_SLIPPAGE_PERCENT: 2,
  MAX_TRADE_PERCENT_OF_LIQUIDITY: 5,
};

// Helper functions for filter validation
export class MarketFilterValidator {
  static validateLiquidity(reserves: [BigNumber, BigNumber], filters: MarketFilters): boolean {
    const [reserve0, reserve1] = reserves;
    
    // Check minimum reserves
    const totalReserves = reserve0.add(reserve1);
    const minLiquidityWei = BigNumber.from('1000000000000000000') // 1 ETH
      .mul(filters.MIN_LIQUIDITY_USD || 10000)
      .div(3000); // Assume 1 ETH = $3000 for rough USD conversion
    
    if (totalReserves.lt(minLiquidityWei)) {
      return false;
    }
    
    // Check reserve ratio balance
    if (reserve0.eq(0) || reserve1.eq(0)) {
      return false;
    }
    
    const ratio = reserve0.gt(reserve1) 
      ? reserve0.div(reserve1) 
      : reserve1.div(reserve0);
    
    if (ratio.gt(filters.MAX_RESERVE_RATIO) || ratio.lt(filters.MIN_RESERVE_RATIO)) {
      return false;
    }
    
    return true;
  }
  
  static validatePriceImpact(
    inputAmount: BigNumber,
    outputAmount: BigNumber,
    expectedOutput: BigNumber,
    filters: MarketFilters
  ): boolean {
    if (expectedOutput.eq(0)) return false;
    
    const priceImpact = expectedOutput.sub(outputAmount)
      .mul(10000)
      .div(expectedOutput)
      .toNumber() / 10000; // Convert to decimal percentage
    
    return priceImpact <= filters.MAX_PRICE_IMPACT;
  }
  
  static validateSpread(spreadBasisPoints: number, filters: MarketFilters): boolean {
    return spreadBasisPoints >= filters.MIN_SPREAD_BASIS_POINTS;
  }
  
  static isPriorityToken(tokenAddress: string, filters: MarketFilters): boolean {
    return filters.PRIORITY_TOKENS.includes(tokenAddress.toLowerCase()) ||
           filters.priorityTokens.includes(tokenAddress.toLowerCase());
  }
  
  static validateGasPrice(currentGasPrice: BigNumber, filters: MarketFilters): boolean {
    return currentGasPrice.lte(filters.MAX_GAS_PRICE || filters.maxGasPrice);
  }
  
  static calculateMinProfit(
    gasPrice: BigNumber,
    filters: MarketFilters,
    numSwaps: number = 2
  ): BigNumber {
    const gasCost = filters.BASE_GAS_COST
      .add(filters.GAS_COST_PER_SWAP.mul(numSwaps))
      .mul(gasPrice);
    
    // Add minimum profit on top of gas costs
    return gasCost.add(filters.MIN_PROFIT_ETH);
  }
  
  static shouldProcessMarket(
    market: any,
    currentBlock: number,
    filters: MarketFilters
  ): boolean {
    // Check if market data is recent enough
    if (market.lastUpdatedBlock) {
      const blockAge = currentBlock - market.lastUpdatedBlock;
      if (blockAge > filters.MIN_BLOCK_CONFIRMATIONS * 10) {
        return false; // Data too old
      }
    }
    
    // Check if factory is excluded
    if (market.factoryAddress && filters.EXCLUDED_FACTORIES.includes(market.factoryAddress)) {
      return false;
    }
    
    // Prefer certain factories if specified
    if (filters.PREFERRED_FACTORIES.length > 0 && market.factoryAddress) {
      return filters.PREFERRED_FACTORIES.includes(market.factoryAddress);
    }
    
    return true;
  }
}

// Export preset configurations for easy use
export const MarketFilterPresets = {
  DEFAULT: MARKET_FILTERS,
  AGGRESSIVE: AGGRESSIVE_MARKET_FILTERS,
  CONSERVATIVE: CONSERVATIVE_MARKET_FILTERS,
  
  // Ultra-aggressive for testing
  TESTING: {
    ...AGGRESSIVE_MARKET_FILTERS,
    minLiquidityETH: 0.01,
    minSpreadBasisPoints: 1, // 0.01%
    MIN_LIQUIDITY_USD: 100,
    MIN_PROFIT_ETH: BigNumber.from('100000000000000'), // 0.0001 ETH
    MIN_SPREAD_BASIS_POINTS: 1,
  } as MarketFilters,
  
  // Production settings
  PRODUCTION: {
    ...CONSERVATIVE_MARKET_FILTERS,
    minLiquidityETH: 5,
    minSpreadBasisPoints: 100, // 1%
    MIN_LIQUIDITY_USD: 100000,
    MIN_PROFIT_ETH: BigNumber.from('50000000000000000'), // 0.05 ETH
    MIN_SPREAD_BASIS_POINTS: 100,
  } as MarketFilters,
};

// Export helper function to get filter based on environment
export function getMarketFilters(mode?: string): MarketFilters {
  switch (mode || process.env.MARKET_FILTER_MODE) {
    case 'aggressive':
      return AGGRESSIVE_MARKET_FILTERS;
    case 'conservative':
      return CONSERVATIVE_MARKET_FILTERS;
    case 'testing':
      return MarketFilterPresets.TESTING;
    case 'production':
      return MarketFilterPresets.PRODUCTION;
    default:
      return MARKET_FILTERS;
  }
}

// Enhanced validation class with more comprehensive checks
export class EnhancedMarketValidator {
  private filters: MarketFilters;
  private stats = {
    marketsProcessed: 0,
    marketsFiltered: 0,
    filterReasons: new Map<string, number>(),
  };
  
  constructor(filters: MarketFilters = MARKET_FILTERS) {
    this.filters = filters;
  }
  
  validateMarket(market: any): { valid: boolean; reason?: string } {
    this.stats.marketsProcessed++;
    
    // Check liquidity
    if (market.reserves) {
      if (!MarketFilterValidator.validateLiquidity(market.reserves, this.filters)) {
        this.recordFilterReason('Low liquidity');
        return { valid: false, reason: 'Low liquidity' };
      }
    }
    
    // Check spread
    if (market.spread !== undefined) {
      if (!MarketFilterValidator.validateSpread(market.spread, this.filters)) {
        this.recordFilterReason('Spread too low');
        return { valid: false, reason: 'Spread too low' };
      }
    }
    
    // Check if it's a priority token
    if (market.tokenAddress) {
      const isPriority = MarketFilterValidator.isPriorityToken(market.tokenAddress, this.filters);
      if (isPriority) {
        // Apply relaxed filters for priority tokens
        return { valid: true };
      }
    }
    
    // Check DEX if specified
    if (this.filters.enabledDEXes.length > 0 && market.dexName) {
      if (!this.filters.enabledDEXes.includes(market.dexName)) {
        this.recordFilterReason('DEX not enabled');
        return { valid: false, reason: 'DEX not enabled' };
      }
    }
    
    return { valid: true };
  }
  
  private recordFilterReason(reason: string) {
    this.stats.marketsFiltered++;
    this.stats.filterReasons.set(
      reason,
      (this.stats.filterReasons.get(reason) || 0) + 1
    );
  }
  
  getStats() {
    return {
      ...this.stats,
      filterReasons: Array.from(this.stats.filterReasons.entries()),
      passRate: ((this.stats.marketsProcessed - this.stats.marketsFiltered) / this.stats.marketsProcessed * 100).toFixed(2) + '%',
    };
  }
  
  resetStats() {
    this.stats.marketsProcessed = 0;
    this.stats.marketsFiltered = 0;
    this.stats.filterReasons.clear();
  }
}