import { BigNumber } from 'ethers';
import { EthMarket } from '../../EthMarket';
import { ParsedOrder, OrderExecutionPath } from '../OrderSettlementEngine';
import logger from '../../utils/logger';

interface SplitRoute {
  routes: Array<{
    market: EthMarket;
    inputAmount: BigNumber;
    outputAmount: BigNumber;
  }>;
  totalInput: BigNumber;
  totalOutput: BigNumber;
  totalGas: BigNumber;
  totalSurplus: BigNumber;
}

/**
 * Route Splitter - Optimizes order execution by splitting across multiple routes
 */
export class RouteSplitter {
  private readonly PRECISION = BigNumber.from('1000000000000000000');
  private readonly UNISWAP_FEE = BigNumber.from('997');
  private readonly UNISWAP_FEE_DENOM = BigNumber.from('1000');

  /**
   * Find optimal split across multiple routes
   * Uses optimization to maximize output while minimizing gas
   */
  async findOptimalSplit(
    order: ParsedOrder,
    candidateRoutes: OrderExecutionPath[]
  ): Promise<SplitRoute | null> {
    if (candidateRoutes.length === 0) return null;
    if (candidateRoutes.length === 1) {
      // Single route, no splitting needed
      return this.convertToSplitRoute(candidateRoutes[0]);
    }

    // Try different split strategies
    const bestSplit = await this.optimizeSplit(order, candidateRoutes);

    if (!bestSplit) {
      // Splitting doesn't improve, use best single route
      const bestSingle = candidateRoutes.reduce((best, current) =>
        current.surplus.gt(best.surplus) ? current : best
      );
      return this.convertToSplitRoute(bestSingle);
    }

    return bestSplit;
  }

  /**
   * Optimize split ratios across routes
   */
  private async optimizeSplit(
    order: ParsedOrder,
    routes: OrderExecutionPath[]
  ): Promise<SplitRoute | null> {
    const totalInput = order.sellAmount.sub(order.feeAmount);

    // Try different split strategies
    const strategies = [
      this.equalSplit(totalInput, routes),
      this.liquidityWeightedSplit(totalInput, routes),
      this.priceOptimizedSplit(totalInput, routes)
    ];

    let bestSplit: SplitRoute | null = null;
    let bestScore = BigNumber.from(0);

    for (const split of strategies) {
      if (!split) continue;

      // Score = surplus - gas cost (in wei)
      const gasPrice = BigNumber.from('30000000000'); // 30 gwei
      const gasCost = split.totalGas.mul(gasPrice);
      const score = split.totalSurplus.sub(gasCost);

      if (score.gt(bestScore)) {
        bestScore = score;
        bestSplit = split;
      }
    }

    return bestSplit;
  }

  /**
   * Split equally across all routes
   */
  private equalSplit(
    totalInput: BigNumber,
    routes: OrderExecutionPath[]
  ): SplitRoute | null {
    const perRoute = totalInput.div(routes.length);

    return this.calculateSplitOutcome(
      routes.map(r => ({ route: r, inputAmount: perRoute }))
    );
  }

  /**
   * Split proportional to liquidity depth
   */
  private liquidityWeightedSplit(
    totalInput: BigNumber,
    routes: OrderExecutionPath[]
  ): SplitRoute | null {
    // Calculate total liquidity across all routes
    const liquidities = routes.map(r => this.getRouteLiquidity(r));
    const totalLiquidity = liquidities.reduce((sum, l) => sum.add(l), BigNumber.from(0));

    if (totalLiquidity.isZero()) return null;

    // Split proportionally
    const splits = routes.map((route, i) => ({
      route,
      inputAmount: totalInput.mul(liquidities[i]).div(totalLiquidity)
    }));

    return this.calculateSplitOutcome(splits);
  }

  /**
   * Split to optimize price impact (more sophisticated)
   */
  private priceOptimizedSplit(
    totalInput: BigNumber,
    routes: OrderExecutionPath[]
  ): SplitRoute | null {
    // Use binary search to find optimal distribution
    // This is simplified - full implementation would use numerical optimization

    // For now, try 5%, 10%, 25%, 50%, 75%, 90%, 95% splits for 2 routes
    if (routes.length !== 2) {
      return this.liquidityWeightedSplit(totalInput, routes);
    }

    const ratios = [5, 10, 25, 50, 75, 90, 95];
    let bestSplit: SplitRoute | null = null;
    let bestOutput = BigNumber.from(0);

    for (const ratio of ratios) {
      const amount1 = totalInput.mul(ratio).div(100);
      const amount2 = totalInput.sub(amount1);

      const split = this.calculateSplitOutcome([
        { route: routes[0], inputAmount: amount1 },
        { route: routes[1], inputAmount: amount2 }
      ]);

      if (split && split.totalOutput.gt(bestOutput)) {
        bestOutput = split.totalOutput;
        bestSplit = split;
      }
    }

    return bestSplit;
  }

  /**
   * Calculate actual outcome of a split
   */
  private calculateSplitOutcome(
    splits: Array<{ route: OrderExecutionPath; inputAmount: BigNumber }>
  ): SplitRoute | null {
    const outcomes = splits.map(({ route, inputAmount }) => {
      // Recalculate output for this input amount
      const market = route.route[0]; // Simplified for single-hop
      return this.calculateSwapOutput(market, inputAmount);
    });

    const totalInput = splits.reduce((sum, s) => sum.add(s.inputAmount), BigNumber.from(0));
    const totalOutput = outcomes.reduce((sum, o) => sum.add(o.output), BigNumber.from(0));
    const totalGas = outcomes.reduce((sum, o) => sum.add(o.gas), BigNumber.from(0));

    // Calculate surplus (simplified)
    const totalSurplus = totalOutput; // Would need proper limit price comparison

    return {
      routes: outcomes.map((o, i) => ({
        market: splits[i].route.route[0],
        inputAmount: splits[i].inputAmount,
        outputAmount: o.output
      })),
      totalInput,
      totalOutput,
      totalGas,
      totalSurplus
    };
  }

  /**
   * Get liquidity depth of a route
   *
   * For single-hop: returns minimum of the two reserves (effective liquidity depth)
   * For multi-hop: returns minimum liquidity across all hops (bottleneck approach)
   *
   * This is critical for liquidity-weighted splitting to allocate more flow
   * to deeper markets and avoid excessive price impact on shallow pools.
   */
  private getRouteLiquidity(route: OrderExecutionPath): BigNumber {
    if (route.route.length === 0) {
      return BigNumber.from(0);
    }

    try {
      // For multi-hop routes, liquidity is limited by the smallest pool (bottleneck)
      let minLiquidity = BigNumber.from('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'); // Max uint256

      for (const market of route.route) {
        // Get reserves for this market
        // Note: This is synchronous access to cached reserves
        // Markets should have updated reserves from recent calls
        const reserves = market.getReserves ? market.getReserves() : null;

        if (!reserves || !Array.isArray(reserves) || reserves.length !== 2) {
          // If we can't get reserves for any hop, route has unknown liquidity
          logger.warn('Unable to get reserves for liquidity calculation', {
            marketAddress: market.marketAddress
          });
          return BigNumber.from(0);
        }

        const [reserve0, reserve1] = reserves;

        // Effective liquidity is the minimum of the two reserves
        // This represents how much can be swapped before severe price impact
        const effectiveLiquidity = reserve0.lt(reserve1) ? reserve0 : reserve1;

        // Track minimum across all hops
        if (effectiveLiquidity.lt(minLiquidity)) {
          minLiquidity = effectiveLiquidity;
        }
      }

      // Sanity check
      if (minLiquidity.eq(BigNumber.from('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'))) {
        return BigNumber.from(0);
      }

      logger.debug('Calculated route liquidity', {
        hops: route.route.length,
        liquidity: minLiquidity.toString()
      });

      return minLiquidity;

    } catch (error) {
      logger.warn('Error calculating route liquidity', {
        error: error instanceof Error ? error.message : String(error)
      });
      return BigNumber.from(0);
    }
  }

  /**
   * Calculate swap output for a market
   */
  private calculateSwapOutput(
    market: EthMarket,
    inputAmount: BigNumber
  ): { output: BigNumber; gas: BigNumber } {
    // Simplified constant product calculation
    // In reality, would call market.getTokensOut()

    const output = inputAmount.mul(this.UNISWAP_FEE).div(this.UNISWAP_FEE_DENOM);
    const gas = BigNumber.from(150000);

    return { output, gas };
  }

  /**
   * Convert single route to split route format
   */
  private convertToSplitRoute(route: OrderExecutionPath): SplitRoute {
    return {
      routes: [{
        market: route.route[0],
        inputAmount: route.inputAmount,
        outputAmount: route.outputAmount
      }],
      totalInput: route.inputAmount,
      totalOutput: route.outputAmount,
      totalGas: route.estimatedGas,
      totalSurplus: route.surplus
    };
  }
}
