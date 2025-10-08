import { BigNumber } from 'ethers';
import { EthMarket } from '../../EthMarket';
import logger from '../../utils/logger';

/**
 * Gas Estimator - Provides protocol-specific gas cost estimates
 */
export class GasEstimator {
  private readonly BASE_TX_COST = BigNumber.from(21000);
  private readonly SWAP_BASE_COST = BigNumber.from(100000);

  // Protocol-specific costs (measured from mainnet data)
  private readonly PROTOCOL_COSTS: { [key: string]: BigNumber } = {
    'UniswapV2': BigNumber.from(110000),
    'Sushiswap': BigNumber.from(110000),
    'Balancer': BigNumber.from(180000),
    'BalancerV2': BigNumber.from(180000),
    'Curve': BigNumber.from(200000),
    'KyberDMM': BigNumber.from(120000),
    'DODOV2': BigNumber.from(150000),
    'CoW-UniswapV2': BigNumber.from(110000),
    'CoW-ConstantProduct': BigNumber.from(110000),
    'CoW-Balancer': BigNumber.from(180000),
    'CoW-Curve': BigNumber.from(200000),
    'CoW-Kyber': BigNumber.from(120000),
    'CoW-DODO': BigNumber.from(150000),
  };

  /**
   * Estimate gas for a route through multiple markets
   */
  estimateRouteGas(route: EthMarket[]): BigNumber {
    if (route.length === 0) {
      return this.BASE_TX_COST;
    }

    let totalGas = this.BASE_TX_COST;

    for (const market of route) {
      const marketCost = this.estimateMarketGas(market);
      totalGas = totalGas.add(marketCost);
    }

    // Add overhead for multi-hop (approval, intermediate transfers, etc.)
    if (route.length > 1) {
      const overhead = BigNumber.from(50000).mul(route.length - 1);
      totalGas = totalGas.add(overhead);
    }

    // Add 10% safety margin
    totalGas = totalGas.mul(110).div(100);

    logger.debug(`Estimated gas for ${route.length}-hop route: ${totalGas.toString()}`);

    return totalGas;
  }

  /**
   * Estimate gas for a single market swap
   */
  private estimateMarketGas(market: EthMarket): BigNumber {
    const protocol = market.protocol || 'UniswapV2';

    return this.PROTOCOL_COSTS[protocol] || this.SWAP_BASE_COST;
  }

  /**
   * Estimate gas for CoW matching (internal settlement)
   */
  estimateCoWMatchingGas(tokenCount: number): BigNumber {
    // CoW matching is very gas-efficient (no DEX interaction)
    const baseCoWCost = BigNumber.from(50000);
    const perTokenCost = BigNumber.from(10000);

    return baseCoWCost.add(perTokenCost.mul(tokenCount));
  }

  /**
   * Estimate gas for a batch of settlements
   */
  estimateBatchGas(
    cowCount: number,
    liquidityRoutes: EthMarket[][]
  ): BigNumber {
    let totalGas = this.BASE_TX_COST;

    // Add CoW matching costs
    if (cowCount > 0) {
      totalGas = totalGas.add(this.estimateCoWMatchingGas(cowCount * 2)); // 2 tokens per CoW
    }

    // Add liquidity routing costs
    for (const route of liquidityRoutes) {
      totalGas = totalGas.add(this.estimateRouteGas(route));
    }

    return totalGas;
  }
}
