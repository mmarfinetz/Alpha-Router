import { BigNumber, ethers } from 'ethers';
import { PriceOracle } from './PriceOracle';
import { OneInchOracle } from './OneInchOracle';
import { PythOracle } from './PythOracle';
import logger from '../../utils/logger';
import { CoWAuction } from '../types';
import { solverMetrics } from '../monitoring/SolverMetrics';

/**
 * Oracle Manager - Coordinates multiple price oracles with fallback strategy
 *
 * Priority order:
 * 1. CoW Protocol native prices (if provided in auction)
 * 2. 1inch Spot Price Aggregator (liquidity-weighted, most accurate)
 * 3. Pyth Network (real-time, low latency)
 * 4. Fallback to 1:1 (last resort)
 */
export class OracleManager {
  private oracles: PriceOracle[];
  private readonly PRECISION = BigNumber.from('1000000000000000000');
  private readonly MIN_COVERAGE_THRESHOLD = 0.7; // Need 70% of tokens priced
  private lastKnownPrices: Map<string, { price: BigNumber; timestamp: number }> = new Map();
  private readonly LAST_KNOWN_PRICE_TTL = 300000; // 5 minutes

  constructor(provider: ethers.providers.Provider) {
    // Initialize oracles in priority order
    this.oracles = [
      new OneInchOracle(provider),  // Primary: Best for DEX-traded tokens
      new PythOracle(provider)       // Secondary: Good for major assets
      // Could add: UniswapV3TWAPOracle, ChainlinkOracle, etc.
    ];

    logger.info('Oracle Manager initialized', {
      oracleCount: this.oracles.length,
      oracles: this.oracles.map(o => o.name)
    });
  }

  /**
   * Get external prices with cascading fallback strategy
   *
   * @param tokens Array of token addresses to price
   * @param auction Optional auction data (may contain native prices)
   * @returns Map of token addresses (lowercase) to prices in ETH (18 decimals)
   */
  async getExternalPrices(
    tokens: string[],
    auction?: CoWAuction
  ): Promise<Map<string, BigNumber>> {

    const uniqueTokens = [...new Set(tokens.map(t => t.toLowerCase()))];
    logger.info(`Fetching external prices for ${uniqueTokens.length} tokens`);

    // PRIORITY 1: Check if CoW Protocol provides native prices in auction
    if (auction) {
      const nativePrices = this.extractCoWNativePrices(auction);
      if (nativePrices.size > 0) {
        logger.info(`Using CoW Protocol native prices for ${nativePrices.size} tokens`);

        // Verify coverage
        if (nativePrices.size >= uniqueTokens.length * this.MIN_COVERAGE_THRESHOLD) {
          return nativePrices;
        }

        logger.warn(`CoW native prices only covered ${nativePrices.size}/${uniqueTokens.length} tokens, falling back`);
      }
    }

    // PRIORITY 2-N: Try each oracle in order
    for (const oracle of this.oracles) {
      try {
        logger.debug(`Attempting to fetch prices from ${oracle.name}`);
        const startTime = Date.now();

        const prices = await oracle.getExternalPrices(uniqueTokens);
        const elapsed = Date.now() - startTime;

        const coverage = prices.size / uniqueTokens.length;
        logger.info(`${oracle.name} provided ${prices.size}/${uniqueTokens.length} prices (${(coverage * 100).toFixed(1)}%) in ${elapsed}ms`);

        // Record oracle metrics
        solverMetrics.recordOracleRequest(true, elapsed, false);

        // Accept if we got reasonable coverage
        if (coverage >= this.MIN_COVERAGE_THRESHOLD) {
          // Cache successful prices
          this.cachePrices(prices);
          return prices;
        }

        logger.warn(`${oracle.name} coverage ${(coverage * 100).toFixed(1)}% below threshold ${this.MIN_COVERAGE_THRESHOLD * 100}%, trying next oracle`);

      } catch (error) {
        logger.error(`${oracle.name} failed`, {
          error: error instanceof Error ? error.message : String(error)
        });

        // Record oracle failure
        solverMetrics.recordOracleRequest(false, 0, false);

        // Continue to next oracle
      }
    }

    // BEFORE falling back to 1:1, try last known prices
    if (this.hasRecentPrices(uniqueTokens)) {
      logger.warn('⚠️  Using cached last-known prices due to oracle failures');

      // Record fallback usage
      solverMetrics.recordOracleRequest(true, 0, true);

      return this.getLastKnownPrices(uniqueTokens);
    }

    // If we truly have no price data, throw error instead of returning 1:1
    logger.error('❌ All price oracles failed - no price data available');
    logger.error('❌ Cannot score solution accurately - refusing to return placeholder prices');
    throw new Error('Price oracle failure - insufficient price coverage');
  }

  /**
   * Extract native prices from CoW Protocol auction if provided
   */
  private extractCoWNativePrices(auction: CoWAuction): Map<string, BigNumber> {
    const prices = new Map<string, BigNumber>();

    // Check multiple possible field names where prices might be provided
    const possibleFields = [
      'external_prices',
      'externalPrices',
      'native_prices',
      'nativePrices',
      'reference_prices',
      'referencePrices',
      'prices'
    ];

    for (const field of possibleFields) {
      const pricesObj = (auction as any)[field];
      if (pricesObj && typeof pricesObj === 'object') {
        logger.debug(`Found native prices in auction.${field}`);

        for (const [token, price] of Object.entries(pricesObj)) {
          try {
            const priceBN = typeof price === 'string'
              ? BigNumber.from(price)
              : BigNumber.from((price as any).toString());

            prices.set(token.toLowerCase(), priceBN);
          } catch (error) {
            logger.warn(`Failed to parse native price for ${token}: ${price}`);
          }
        }

        if (prices.size > 0) {
          logger.info(`Extracted ${prices.size} native prices from CoW Protocol auction`);
          return prices;
        }
      }
    }

    return prices;
  }

  /**
   * Generate 1:1 placeholder prices (last resort)
   */
  private getPlaceholderPrices(tokens: string[]): Map<string, BigNumber> {
    const prices = new Map<string, BigNumber>();

    for (const token of tokens) {
      prices.set(token.toLowerCase(), this.PRECISION);
    }

    return prices;
  }

  /**
   * Get statistics about oracle performance
   */
  getStats() {
    return {
      oracleCount: this.oracles.length,
      oracles: this.oracles.map(o => ({
        name: o.name,
        type: o.constructor.name
      })),
      minCoverageThreshold: this.MIN_COVERAGE_THRESHOLD
    };
  }

  /**
   * Test all oracles with a sample token
   * Useful for health checks and debugging
   */
  async testOracles(sampleToken: string): Promise<{
    [oracleName: string]: { success: boolean; price?: string; error?: string }
  }> {
    const results: any = {};

    for (const oracle of this.oracles) {
      try {
        const prices = await oracle.getExternalPrices([sampleToken]);
        const price = prices.get(sampleToken.toLowerCase());

        results[oracle.name] = {
          success: price !== undefined,
          price: price?.toString()
        };
      } catch (error) {
        results[oracle.name] = {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    return results;
  }

  /**
   * Check if we have recent cached prices for given tokens
   */
  private hasRecentPrices(tokens: string[]): boolean {
    const now = Date.now();
    let recentCount = 0;

    for (const token of tokens) {
      const cached = this.lastKnownPrices.get(token.toLowerCase());
      if (cached && now - cached.timestamp < this.LAST_KNOWN_PRICE_TTL) {
        recentCount++;
      }
    }

    return recentCount >= tokens.length * this.MIN_COVERAGE_THRESHOLD;
  }

  /**
   * Get last known prices from cache
   */
  private getLastKnownPrices(tokens: string[]): Map<string, BigNumber> {
    const prices = new Map<string, BigNumber>();
    const now = Date.now();

    for (const token of tokens) {
      const cached = this.lastKnownPrices.get(token.toLowerCase());
      if (cached && now - cached.timestamp < this.LAST_KNOWN_PRICE_TTL) {
        prices.set(token.toLowerCase(), cached.price);
      }
    }

    return prices;
  }

  /**
   * Cache successful price fetches
   */
  private cachePrices(prices: Map<string, BigNumber>): void {
    const now = Date.now();
    for (const [token, price] of prices.entries()) {
      this.lastKnownPrices.set(token, { price, timestamp: now });
    }
  }
}