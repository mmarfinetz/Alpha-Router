import { BigNumber, ethers } from 'ethers';
import { PriceOracle } from './PriceOracle';
import logger from '../../utils/logger';
import { WETH_ADDRESS } from '../../addresses';

/**
 * 1inch Spot Price Aggregator Oracle
 *
 * Uses 1inch's OffchainOracle contract to get liquidity-weighted prices
 * across 50+ DEX types.
 *
 * Contract: https://github.com/1inch/spot-price-aggregator
 * ⚠️ OFF-CHAIN USE ONLY - not meant for on-chain execution
 */
export class OneInchOracle implements PriceOracle {
  public readonly name = '1inch Spot Price Aggregator';

  private oracle: ethers.Contract;
  private cache: Map<string, { price: BigNumber; timestamp: number }>;
  private readonly CACHE_TTL = 30000; // 30 seconds
  private readonly PRECISION = BigNumber.from('1000000000000000000');

  // 1inch OffchainOracle contract address on Ethereum mainnet
  private readonly OFFCHAIN_ORACLE_ADDRESS = '0x07D91f5fb9Bf7798734C3f606dB065549F6893bb';

  constructor(private provider: ethers.providers.Provider) {
    this.oracle = new ethers.Contract(
      this.OFFCHAIN_ORACLE_ADDRESS,
      [
        'function getRateToEth(address srcToken, bool useSrcWrappers) external view returns (uint256 weightedRate)',
        'function getRate(address srcToken, address dstToken, bool useWrappers) external view returns (uint256 weightedRate)'
      ],
      provider
    );

    this.cache = new Map();

    logger.info('1inch Oracle initialized', {
      contract: this.OFFCHAIN_ORACLE_ADDRESS
    });
  }

  /**
   * Get token price in ETH using 1inch liquidity-weighted aggregation
   */
  private async getTokenPriceInETH(token: string): Promise<BigNumber> {
    const now = Date.now();
    const cached = this.cache.get(token.toLowerCase());

    // Return cached price if still valid
    if (cached && now - cached.timestamp < this.CACHE_TTL) {
      return cached.price;
    }

    try {
      // getRateToEth returns: (1 token) * 10^18 / (1 ETH)
      // So if token is worth 0.5 ETH, returns 0.5 * 10^18 = 500000000000000000
      const rate = await this.oracle.getRateToEth(token, true);

      // Cache the result
      this.cache.set(token.toLowerCase(), {
        price: rate,
        timestamp: now
      });

      return rate;
    } catch (error) {
      logger.debug(`Failed to get 1inch price for ${token}`, {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get external prices for multiple tokens
   */
  async getExternalPrices(tokens: string[]): Promise<Map<string, BigNumber>> {
    const prices = new Map<string, BigNumber>();

    // WETH is always 1:1 with ETH
    prices.set(WETH_ADDRESS.toLowerCase(), this.PRECISION);

    // Batch fetch all token prices (with Promise.allSettled for error handling)
    const pricePromises = tokens.map(async (token) => {
      const tokenLower = token.toLowerCase();

      // Skip WETH
      if (tokenLower === WETH_ADDRESS.toLowerCase()) {
        return { token: tokenLower, price: this.PRECISION };
      }

      try {
        const price = await this.getTokenPriceInETH(token);
        return { token: tokenLower, price };
      } catch (error) {
        logger.debug(`No 1inch price available for ${token}`);
        return null;
      }
    });

    const results = await Promise.allSettled(pricePromises);

    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        prices.set(result.value.token, result.value.price);
      }
    });

    logger.info(`1inch Oracle provided prices for ${prices.size}/${tokens.length} tokens`);

    return prices;
  }

  /**
   * Clear price cache (useful for testing or forcing refresh)
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug('1inch Oracle cache cleared');
  }
}