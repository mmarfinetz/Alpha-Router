import { BigNumber, ethers } from 'ethers';
import { PriceOracle } from './PriceOracle';
import logger from '../../utils/logger';
import { WETH_ADDRESS } from '../../addresses';

/**
 * Pyth Network Oracle
 *
 * Real-time price feeds with sub-second updates from 95+ data providers.
 * Provides 450+ price feeds for crypto, equities, commodities, and FX.
 *
 * Docs: https://docs.pyth.network/price-feeds
 *
 * Note: Requires mapping token addresses to Pyth feed IDs
 */
export class PythOracle implements PriceOracle {
  public readonly name = 'Pyth Network';

  private pyth: ethers.Contract;
  private readonly PRECISION = BigNumber.from('1000000000000000000');

  // Pyth contract address on Ethereum mainnet
  private readonly PYTH_CONTRACT = '0x4305FB66699C3B2702D4d05CF36551390A4c69C6';

  // Pyth price feed IDs (from https://pyth.network/developers/price-feed-ids)
  private readonly FEED_IDS: { [key: string]: string } = {
    'ETH/USD': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
    'BTC/USD': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
    'USDC/USD': '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
    'USDT/USD': '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
    'DAI/USD': '0xb0948a5e5313200c632b51bb5ca32f6de0d36e9950a942d19751e833f70dabfd',
    'WBTC/USD': '0xc9d8b075a5c69303365ae23633d4e085199bf5c520a3b90fed1322a0342ffc33'
  };

  // Token address to feed ID mapping
  // TODO: Expand this mapping for more tokens
  private readonly TOKEN_TO_FEED: { [addr: string]: string } = {
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'ETH/USD', // WETH
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC/USD',
    '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT/USD',
    '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI/USD',
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'WBTC/USD'
  };

  constructor(private provider: ethers.providers.Provider) {
    this.pyth = new ethers.Contract(
      this.PYTH_CONTRACT,
      [
        // getPriceUnsafe doesn't check staleness - good for off-chain queries
        'function getPriceUnsafe(bytes32 id) external view returns (int64 price, uint64 conf, int32 expo, uint256 publishTime)'
      ],
      provider
    );

    logger.info('Pyth Oracle initialized', {
      contract: this.PYTH_CONTRACT,
      supportedFeeds: Object.keys(this.FEED_IDS).length
    });
  }

  /**
   * Get token price in USD from Pyth
   */
  private async getTokenPriceInUSD(feedId: string): Promise<BigNumber> {
    try {
      const priceData = await this.pyth.getPriceUnsafe(feedId);

      // Pyth returns price with an exponent (usually -8 for USD prices)
      const price = BigNumber.from(priceData.price);
      const expo = priceData.expo;

      // Normalize to 18 decimals
      // If expo = -8 and price = 300000000000, actual price = 3000.00 USD
      let normalizedPrice: BigNumber;

      if (expo < 0) {
        // Most common case: expo is negative
        const divisor = BigNumber.from(10).pow(Math.abs(expo));
        normalizedPrice = price.mul(this.PRECISION).div(divisor);
      } else {
        // Rare case: expo is positive
        const multiplier = BigNumber.from(10).pow(expo);
        normalizedPrice = price.mul(multiplier).mul(this.PRECISION);
      }

      return normalizedPrice;
    } catch (error) {
      logger.debug(`Failed to get Pyth price for feed ${feedId}`, {
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

    try {
      // Get ETH price in USD as reference
      const ethFeedId = this.FEED_IDS['ETH/USD'];
      const ethPriceUSD = await this.getTokenPriceInUSD(ethFeedId);

      logger.debug(`ETH price from Pyth: ${ethPriceUSD.toString()}`);

      // Process each token
      for (const token of tokens) {
        const tokenLower = token.toLowerCase();

        // WETH is 1:1 with ETH
        if (tokenLower === WETH_ADDRESS.toLowerCase()) {
          prices.set(tokenLower, this.PRECISION);
          continue;
        }

        // Get feed ID for token
        const feedName = this.TOKEN_TO_FEED[tokenLower];
        if (!feedName) {
          logger.debug(`No Pyth feed mapping for token ${token}`);
          continue;
        }

        const feedId = this.FEED_IDS[feedName];
        if (!feedId) {
          logger.warn(`Feed ID missing for ${feedName}`);
          continue;
        }

        try {
          // Get token price in USD
          const tokenPriceUSD = await this.getTokenPriceInUSD(feedId);

          // Convert to ETH-denominated (CoW Protocol scores in ETH)
          const tokenPriceInETH = tokenPriceUSD
            .mul(this.PRECISION)
            .div(ethPriceUSD);

          prices.set(tokenLower, tokenPriceInETH);

          logger.debug(`Pyth price for ${feedName}: ${tokenPriceInETH.toString()}`);
        } catch (error) {
          logger.debug(`Failed to get Pyth price for ${feedName}`);
        }
      }

      logger.info(`Pyth Oracle provided prices for ${prices.size}/${tokens.length} tokens`);

    } catch (error) {
      logger.error('Pyth Oracle failed to get ETH reference price', {
        error: error instanceof Error ? error.message : String(error)
      });
      // Return empty map if we can't even get ETH price
      return new Map();
    }

    return prices;
  }

  /**
   * Add custom token to feed mapping
   * Useful for expanding coverage without code changes
   */
  addTokenMapping(tokenAddress: string, feedName: string): void {
    if (!this.FEED_IDS[feedName]) {
      logger.warn(`Unknown feed name: ${feedName}`);
      return;
    }

    this.TOKEN_TO_FEED[tokenAddress.toLowerCase()] = feedName;
    logger.info(`Added Pyth mapping: ${tokenAddress} -> ${feedName}`);
  }
}