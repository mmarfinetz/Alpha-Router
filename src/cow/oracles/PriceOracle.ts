import { BigNumber } from 'ethers';

/**
 * Interface for external price oracles
 */
export interface PriceOracle {
  /**
   * Get external prices for a list of tokens
   * @param tokens Array of token addresses
   * @returns Map of token address (lowercase) to price in ETH (18 decimals)
   */
  getExternalPrices(tokens: string[]): Promise<Map<string, BigNumber>>;

  /**
   * Oracle name for logging
   */
  readonly name: string;
}