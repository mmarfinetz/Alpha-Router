/**
 * Basic Market Scanner
 * 
 * Monitors DEX pairs and displays price differences between markets.
 * This is a simplified scanner that focuses on price difference detection
 * without executing any trades.
 */

import { ethers } from 'ethers';
import { logInfo as info, logError as error, logWarn as warn } from '../utils/logger';

interface BasicScannerConfig {
  scanInterval: number;
  priceThreshold: number;
  verbose: boolean;
}

interface MarketPair {
  address: string;
  name: string;
}

interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  reserve: number;
}

interface MarketData {
  address: string;
  name: string;
  token0: TokenInfo;
  token1: TokenInfo;
  price0Per1: number;
  price1Per0: number;
}

export class BasicMarketScanner {
  private provider: ethers.providers.JsonRpcProvider;
  private config: BasicScannerConfig;
  private isRunning = false;
  private scanTimer?: NodeJS.Timeout;

  // Common ABI for UniswapV2 pairs
  private readonly UNISWAP_V2_PAIR_ABI = [
    'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function token0() external view returns (address)',
    'function token1() external view returns (address)'
  ];

  // Simplified ERC20 ABI
  private readonly ERC20_ABI = [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function balanceOf(address) view returns (uint256)'
  ];

  // Default pairs to monitor
  private readonly DEFAULT_PAIRS: MarketPair[] = [
    // ETH-USDC pairs on different DEXes
    { address: '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc', name: 'Uniswap V2 ETH-USDC' },
    { address: '0x397FF1542f962076d0BFE58eA045FfA2d347ACa0', name: 'SushiSwap ETH-USDC' },
    
    // ETH-USDT pairs
    { address: '0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852', name: 'Uniswap V2 ETH-USDT' },
    { address: '0x06da0fd433C1A5d7a4faa01111c044910A184553', name: 'SushiSwap ETH-USDT' },
    
    // ETH-DAI pairs
    { address: '0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11', name: 'Uniswap V2 ETH-DAI' },
    { address: '0xC3D03e4F041Fd4cD388c549Ee2A29a9E5075882f', name: 'SushiSwap ETH-DAI' }
  ];

  constructor(config: BasicScannerConfig) {
    this.config = config;
    
    if (!process.env.ETHEREUM_RPC_URL) {
      throw new Error('ETHEREUM_RPC_URL environment variable is required');
    }
    
    this.provider = new ethers.providers.JsonRpcProvider(process.env.ETHEREUM_RPC_URL);
  }

  async start(): Promise<void> {
    info('=== MEV Basic Market Scanner ===');
    info('Initializing...');
    
    try {
      // Test network connection
      const network = await this.provider.getNetwork();
      info(`Connected to network: ${network.name}`);
      
      const blockNumber = await this.provider.getBlockNumber();
      info(`Current block: ${blockNumber}`);
      
      this.isRunning = true;
      info('\nStarting continuous market scanning...');
      info(`Scanning interval: ${this.config.scanInterval / 1000} seconds`);
      info(`Price threshold: ${this.config.priceThreshold}%\n`);
      
      // Start scanning loop
      await this.scanLoop();
      
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      error('Failed to initialize scanner:', { error: err instanceof Error ? err : new Error(String(err)) });
      throw err;
    }
  }

  stop(): void {
    info('Stopping scanner...');
    this.isRunning = false;
    
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
    }
  }

  private async scanLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.performScan();
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        error('Scan failed:', { error: err instanceof Error ? err : new Error(String(err)) });
      }
      
      if (this.isRunning) {
        await this.sleep(this.config.scanInterval);
      }
    }
  }

  private async performScan(): Promise<void> {
    info('Scanning markets for arbitrage opportunities...');
    
    const marketData: MarketData[] = [];
    
    // Collect market data from all pairs
    for (const pair of this.DEFAULT_PAIRS) {
      try {
        const data = await this.fetchMarketData(pair);
        if (data) {
          marketData.push(data);
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        warn(`Failed to fetch data for ${pair.name}: ${errorMessage}`);
      }
    }
    
    if (marketData.length === 0) {
      warn('No market data collected');
      return;
    }
    
    // Analyze for arbitrage opportunities
    await this.analyzeArbitrageOpportunities(marketData);
    
    info('Arbitrage scan completed!\n');
  }

  private async fetchMarketData(pair: MarketPair): Promise<MarketData | null> {
    if (this.config.verbose) {
      info(`Checking ${pair.name} (${pair.address})...`);
    }
    
    try {
      const pairContract = new ethers.Contract(pair.address, this.UNISWAP_V2_PAIR_ABI, this.provider);
      
      // Get tokens in the pair
      const token0Address = await pairContract.token0();
      const token1Address = await pairContract.token1();
      const token0 = new ethers.Contract(token0Address, this.ERC20_ABI, this.provider);
      const token1 = new ethers.Contract(token1Address, this.ERC20_ABI, this.provider);
      
      // Get token info and reserves in parallel
      const [token0Symbol, token1Symbol, reserves, token0Decimals, token1Decimals] = await Promise.all([
        token0.symbol(),
        token1.symbol(),
        pairContract.getReserves(),
        token0.decimals(),
        token1.decimals()
      ]);

      const [reserve0, reserve1] = reserves;
      
      // Format reserves
      const formattedReserve0 = parseFloat(ethers.utils.formatUnits(reserve0, token0Decimals));
      const formattedReserve1 = parseFloat(ethers.utils.formatUnits(reserve1, token1Decimals));
      
      // Calculate prices
      const price0Per1 = formattedReserve1 / formattedReserve0;
      const price1Per0 = formattedReserve0 / formattedReserve1;
      
      if (this.config.verbose) {
        info(`Pair: ${token0Symbol}-${token1Symbol}`);
        info(`Token0 (${token0Symbol}) Reserve: ${formattedReserve0.toLocaleString()}`);
        info(`Token1 (${token1Symbol}) Reserve: ${formattedReserve1.toLocaleString()}`);
        info(`Price ${token0Symbol}/${token1Symbol}: ${price0Per1.toFixed(6)}`);
        info(`Price ${token1Symbol}/${token0Symbol}: ${price1Per0.toFixed(6)}`);
      }
      
      return {
        address: pair.address,
        name: pair.name,
        token0: {
          address: token0Address,
          symbol: token0Symbol,
          decimals: token0Decimals,
          reserve: formattedReserve0
        },
        token1: {
          address: token1Address,
          symbol: token1Symbol,
          decimals: token1Decimals,
          reserve: formattedReserve1
        },
        price0Per1,
        price1Per0
      };
      
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to fetch market data: ${errorMessage}`);
    }
  }

  private async analyzeArbitrageOpportunities(marketData: MarketData[]): Promise<void> {
    info('Checking for arbitrage opportunities...');
    
    // Group markets by token pair
    const tokenPairs: { [key: string]: MarketData[] } = {};
    
    marketData.forEach(market => {
      // Create a unique key for each token pair, regardless of order
      const tokens = [market.token0.symbol, market.token1.symbol].sort().join('-');
      
      if (!tokenPairs[tokens]) {
        tokenPairs[tokens] = [];
      }
      tokenPairs[tokens].push(market);
    });
    
    let opportunitiesFound = 0;
    
    // Look for profitable arbitrage opportunities
    for (const [tokens, markets] of Object.entries(tokenPairs)) {
      if (markets.length < 2) continue; // Need at least 2 markets for arbitrage
      
      if (this.config.verbose) {
        info(`\nAnalyzing token pair: ${tokens}`);
      }
      
      // Normalize all markets to compare the same token direction
      this.normalizeMarketPrices(markets, tokens);
      
      for (let i = 0; i < markets.length; i++) {
        for (let j = i + 1; j < markets.length; j++) {
          const opportunity = this.calculateArbitrageOpportunity(markets[i], markets[j]);
          
          if (opportunity.priceDiffPercent >= this.config.priceThreshold) {
            this.displayArbitrageOpportunity(opportunity, tokens);
            opportunitiesFound++;
          } else if (this.config.verbose) {
            info(`Price difference between ${markets[i].name} and ${markets[j].name}: ${opportunity.priceDiffPercent.toFixed(4)}%`);
          }
        }
      }
    }
    
    if (opportunitiesFound === 0) {
      info('No arbitrage opportunities found above threshold');
    } else {
      info(`Found ${opportunitiesFound} arbitrage opportunities!`);
    }
  }

  private normalizeMarketPrices(markets: MarketData[], tokenPairKey: string): void {
    markets.forEach(market => {
      const currentOrder = [market.token0.symbol, market.token1.symbol].join('-');
      if (currentOrder !== tokenPairKey) {
        // Flip the prices to match the normalized order
        const temp = market.price0Per1;
        market.price0Per1 = market.price1Per0;
        market.price1Per0 = temp;
      }
    });
  }

  private calculateArbitrageOpportunity(marketA: MarketData, marketB: MarketData) {
    const priceDiffPercent = Math.abs((marketA.price0Per1 / marketB.price0Per1 - 1) * 100);
    
    const cheaperMarket = marketA.price0Per1 < marketB.price0Per1 ? marketA : marketB;
    const expensiveMarket = marketA.price0Per1 > marketB.price0Per1 ? marketA : marketB;
    
    return {
      priceDiffPercent,
      cheaperMarket,
      expensiveMarket,
      buyPrice: cheaperMarket.price0Per1,
      sellPrice: expensiveMarket.price0Per1
    };
  }

  private displayArbitrageOpportunity(opportunity: any, tokenPair: string): void {
    info(`\n🔥 ARBITRAGE OPPORTUNITY DETECTED! 🔥`);
    info(`Token Pair: ${tokenPair}`);
    info(`Price Difference: ${opportunity.priceDiffPercent.toFixed(4)}%`);
    info(`Buy from: ${opportunity.cheaperMarket.name} at ${opportunity.buyPrice.toFixed(6)}`);
    info(`Sell to: ${opportunity.expensiveMarket.name} at ${opportunity.sellPrice.toFixed(6)}`);
    info(`Potential profit (before fees and slippage): ~${opportunity.priceDiffPercent.toFixed(4)}%`);
    
    // Calculate liquidity constraints
    const maxTradeSize = Math.min(
      opportunity.cheaperMarket.token0.reserve * 0.1, // Max 10% of pool
      opportunity.expensiveMarket.token0.reserve * 0.1
    );
    
    info(`Estimated max trade size: ${maxTradeSize.toFixed(4)} ${tokenPair.split('-')[0]}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}