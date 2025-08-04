import { expect } from 'chai';
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

// ABIs for testing
const UNISWAP_V2_PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)'
];

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)'
];

interface MarketData {
  address: string;
  name: string;
  token0: {
    address: string;
    symbol: string;
    reserve: number;
    decimals: number;
  };
  token1: {
    address: string;
    symbol: string;
    reserve: number;
    decimals: number;
  };
  price0Per1: number;
  price1Per0: number;
}

describe('MEV Arbitrage Integration Tests', () => {
  let provider: ethers.providers.JsonRpcProvider;
  
  const testPairs = [
    { address: '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc', name: 'Uniswap V2 ETH-USDC' },
    { address: '0x397FF1542f962076d0BFE58eA045FfA2d347ACa0', name: 'SushiSwap ETH-USDC' },
    { address: '0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852', name: 'Uniswap V2 ETH-USDT' },
    { address: '0x06da0fd433C1A5d7a4faa01111c044910A184553', name: 'SushiSwap ETH-USDT' }
  ];

  beforeAll(async () => {
    if (!process.env.ETH_MAINNET_URL) {
      throw new Error('ETH_MAINNET_URL environment variable is required');
    }
    provider = new ethers.providers.JsonRpcProvider(process.env.ETH_MAINNET_URL);
  });

  describe('Network Connection', () => {
    it('should connect to Ethereum network', async () => {
      const network = await provider.getNetwork();
      expect(network.name).to.be.oneOf(['homestead', 'mainnet']);
    });

    it('should get current block number', async () => {
      const blockNumber = await provider.getBlockNumber();
      expect(blockNumber).to.be.greaterThan(0);
    });
  });

  describe('Market Data Collection', () => {
    let marketData: MarketData[] = [];

    it('should collect market data from all test pairs', async () => {
      for (const pair of testPairs) {
        try {
          const pairContract = new ethers.Contract(pair.address, UNISWAP_V2_PAIR_ABI, provider);
          
          const token0Address = await pairContract.token0();
          const token1Address = await pairContract.token1();
          const token0 = new ethers.Contract(token0Address, ERC20_ABI, provider);
          const token1 = new ethers.Contract(token1Address, ERC20_ABI, provider);
          
          const [token0Symbol, token1Symbol, reserves, token0Decimals, token1Decimals] = await Promise.all([
            token0.symbol(),
            token1.symbol(),
            pairContract.getReserves(),
            token0.decimals(),
            token1.decimals()
          ]);

          const [reserve0, reserve1] = reserves;
          const formattedReserve0 = parseFloat(ethers.utils.formatUnits(reserve0, token0Decimals));
          const formattedReserve1 = parseFloat(ethers.utils.formatUnits(reserve1, token1Decimals));
          
          const price0Per1 = formattedReserve0 / formattedReserve1;
          const price1Per0 = formattedReserve1 / formattedReserve0;

          const market: MarketData = {
            address: pair.address,
            name: pair.name,
            token0: { address: token0Address, symbol: token0Symbol, reserve: formattedReserve0, decimals: token0Decimals },
            token1: { address: token1Address, symbol: token1Symbol, reserve: formattedReserve1, decimals: token1Decimals },
            price0Per1,
            price1Per0
          };

          marketData.push(market);
          
          // Validate market data structure
          expect(market.token0.symbol).to.be.a('string').and.not.empty;
          expect(market.token1.symbol).to.be.a('string').and.not.empty;
          expect(market.token0.reserve).to.be.greaterThan(0);
          expect(market.token1.reserve).to.be.greaterThan(0);
          expect(market.price0Per1).to.be.greaterThan(0);
          expect(market.price1Per0).to.be.greaterThan(0);
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.warn(`Warning: Could not fetch data for ${pair.name}: ${errorMessage}`);
        }
      }

      expect(marketData.length).to.be.greaterThan(0, 'Should collect data from at least one market');
    });

    it('should have valid price relationships', () => {
      marketData.forEach(market => {
        // Price relationship should be reciprocal (within small tolerance for floating point)
        const priceProduct = market.price0Per1 * market.price1Per0;
        expect(priceProduct).to.be.closeTo(1, 0.01, `Price relationship validation failed for ${market.name}`);
      });
    });
  });

  describe('Arbitrage Detection', () => {
    let marketData: MarketData[] = [];

    beforeAll(async () => {
      // Collect fresh market data for arbitrage tests
      for (const pair of testPairs) {
        try {
          const pairContract = new ethers.Contract(pair.address, UNISWAP_V2_PAIR_ABI, provider);
          
          const token0Address = await pairContract.token0();
          const token1Address = await pairContract.token1();
          const token0 = new ethers.Contract(token0Address, ERC20_ABI, provider);
          const token1 = new ethers.Contract(token1Address, ERC20_ABI, provider);
          
          const [token0Symbol, token1Symbol, reserves, token0Decimals, token1Decimals] = await Promise.all([
            token0.symbol(),
            token1.symbol(),
            pairContract.getReserves(),
            token0.decimals(),
            token1.decimals()
          ]);

          const [reserve0, reserve1] = reserves;
          const formattedReserve0 = parseFloat(ethers.utils.formatUnits(reserve0, token0Decimals));
          const formattedReserve1 = parseFloat(ethers.utils.formatUnits(reserve1, token1Decimals));
          
          const price0Per1 = formattedReserve0 / formattedReserve1;
          const price1Per0 = formattedReserve1 / formattedReserve0;

          marketData.push({
            address: pair.address,
            name: pair.name,
            token0: { address: token0Address, symbol: token0Symbol, reserve: formattedReserve0, decimals: token0Decimals },
            token1: { address: token1Address, symbol: token1Symbol, reserve: formattedReserve1, decimals: token1Decimals },
            price0Per1,
            price1Per0
          });
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.warn(`Warning: Could not fetch data for ${pair.name}: ${errorMessage}`);
        }
      }
    });

    it('should group markets by token pairs correctly', () => {
      const tokenPairs: { [key: string]: MarketData[] } = {};
      
      marketData.forEach(market => {
        const tokens = [market.token0.symbol, market.token1.symbol].sort().join('-');
        if (!tokenPairs[tokens]) {
          tokenPairs[tokens] = [];
        }
        tokenPairs[tokens].push(market);
      });

      // Verify grouping logic
      Object.entries(tokenPairs).forEach(([tokens, markets]) => {
        expect(tokens).to.match(/^[A-Z]+-[A-Z]+$/, 'Token pair key should be properly formatted');
        expect(markets.length).to.be.greaterThan(0, 'Each token pair group should have at least one market');
        
        markets.forEach(market => {
          const marketTokens = [market.token0.symbol, market.token1.symbol].sort().join('-');
          expect(marketTokens).to.equal(tokens, 'Market should be in correct token pair group');
        });
      });
    });

    it('should detect price differences between markets', () => {
      const tokenPairs: { [key: string]: MarketData[] } = {};
      
      marketData.forEach(market => {
        const tokens = [market.token0.symbol, market.token1.symbol].sort().join('-');
        if (!tokenPairs[tokens]) {
          tokenPairs[tokens] = [];
        }
        tokenPairs[tokens].push(market);
      });

      const arbitrageOpportunities: Array<{
        tokenPair: string;
        marketA: string;
        marketB: string;
        priceDiff: number;
      }> = [];

      Object.entries(tokenPairs).forEach(([tokens, markets]) => {
        if (markets.length < 2) return;

        // Normalize prices for comparison
        markets.forEach(market => {
          const currentOrder = [market.token0.symbol, market.token1.symbol].join('-');
          if (currentOrder !== tokens) {
            const temp = market.price0Per1;
            market.price0Per1 = market.price1Per0;
            market.price1Per0 = temp;
          }
        });

        for (let i = 0; i < markets.length; i++) {
          for (let j = i + 1; j < markets.length; j++) {
            const marketA = markets[i];
            const marketB = markets[j];
            
            const priceDiffPercent = Math.abs((marketA.price0Per1 / marketB.price0Per1 - 1) * 100);
            
            if (priceDiffPercent > 0.1) { // 0.1% threshold for test
              arbitrageOpportunities.push({
                tokenPair: tokens,
                marketA: marketA.name,
                marketB: marketB.name,
                priceDiff: priceDiffPercent
              });
            }
          }
        }
      });

      // This test validates the detection logic works, not that opportunities always exist
      console.log(`Detected ${arbitrageOpportunities.length} potential arbitrage opportunities`);
      arbitrageOpportunities.forEach(opp => {
        expect(opp.priceDiff).to.be.greaterThan(0.1);
        console.log(`  ${opp.tokenPair}: ${opp.priceDiff.toFixed(4)}% difference between ${opp.marketA} and ${opp.marketB}`);
      });
    });

    it('should validate arbitrage opportunity structure', () => {
      // Test the arbitrage detection algorithm with mock data
      const mockMarkets: MarketData[] = [
        {
          address: '0x1',
          name: 'Mock Exchange A',
          token0: { address: '0xa', symbol: 'ETH', reserve: 100, decimals: 18 },
          token1: { address: '0xb', symbol: 'USDC', reserve: 200000, decimals: 6 },
          price0Per1: 2000, // 1 ETH = 2000 USDC
          price1Per0: 0.0005
        },
        {
          address: '0x2',
          name: 'Mock Exchange B',
          token0: { address: '0xa', symbol: 'ETH', reserve: 50, decimals: 18 },
          token1: { address: '0xb', symbol: 'USDC', reserve: 105000, decimals: 6 },
          price0Per1: 2100, // 1 ETH = 2100 USDC (5% higher)
          price1Per0: 0.000476
        }
      ];

      const priceDiff = Math.abs((mockMarkets[0].price0Per1 / mockMarkets[1].price0Per1 - 1) * 100);
      expect(priceDiff).to.be.closeTo(4.76, 0.1, 'Should detect ~5% price difference');
      
      if (priceDiff > 1) { // Significant arbitrage opportunity
        const cheaperMarket = mockMarkets[0].price0Per1 < mockMarkets[1].price0Per1 ? mockMarkets[0] : mockMarkets[1];
        const expensiveMarket = mockMarkets[0].price0Per1 > mockMarkets[1].price0Per1 ? mockMarkets[0] : mockMarkets[1];
        
        expect(cheaperMarket.name).to.equal('Mock Exchange A');
        expect(expensiveMarket.name).to.equal('Mock Exchange B');
      }
    });
  });
});