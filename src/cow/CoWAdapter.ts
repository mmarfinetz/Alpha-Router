import { BigNumber, ethers } from 'ethers';
import { UniswapV2EthPair } from '../UniswapV2EthPair';
import { MarketsByToken, CrossedMarketDetails } from '../types';
import logger from '../utils/logger';
import {
  CoWAuction,
  CoWOrder,
  CoWLiquidity,
  CoWSolution,
  CoWTrade,
  CoWInteraction,
  SolverResponse
} from './types';
import {
  OrderSettlementEngine,
  ParsedOrder,
  CoincidenceOfWants,
  OrderExecutionPath
} from './OrderSettlementEngine';
import { OracleManager } from './oracles/OracleManager';
import { Arbitrage } from '../Arbitrage';
import { CircuitBreaker } from '../utils/CircuitBreaker';
import { GasPriceManager } from '../utils/GasPriceManager';
import { DEFAULT_THRESHOLDS } from '../config/thresholds';
import { COW_SOLVER_THRESHOLDS } from '../config/cow-thresholds';
import { EthMarket } from '../EthMarket';
import { BalancerV2Pool, BalancerPoolType } from '../markets/BalancerV2Pool';
import { CurvePool } from '../markets/CurvePool';
import { KyberDMMPool } from '../markets/KyberDMMPool';
import { DODOV2Pool } from '../markets/DODOV2Pool';
import { GasEstimator } from './utils/GasEstimator';
import { RouteSplitter } from './routing/RouteSplitter';
import { solverMetrics, AuctionMetrics } from './monitoring/SolverMetrics';
import { HybridGAEngine } from '../engines/HybridGAEngine';

export class CoWAdapter {
  private orderCache: Map<string, CoWOrder> = new Map();
  private auctionCount: number = 0;
  private settlementEngine: OrderSettlementEngine;
  private oracleManager: OracleManager;
  private arbitrage: Arbitrage | null = null;
  private hybridGAEngine: HybridGAEngine | null = null;
  private gasEstimator: GasEstimator;
  private routeSplitter: RouteSplitter;
  private readonly PRECISION = BigNumber.from('1000000000000000000');

  constructor(
    private provider: ethers.providers.Provider,
    wallet?: ethers.Wallet,
    bundleExecutor?: ethers.Contract
  ) {
    this.settlementEngine = new OrderSettlementEngine(provider);
    this.oracleManager = new OracleManager(provider);
    this.gasEstimator = new GasEstimator();
    this.routeSplitter = new RouteSplitter();

    // Initialize Arbitrage if wallet provided for advanced routing
    if (wallet && bundleExecutor) {
      try {
        const circuitBreaker = new CircuitBreaker({
          maxFailures: 5,
          resetTimeoutMs: 60000,
          cooldownPeriodMs: 30000
        });

        const gasPriceManager = new GasPriceManager(provider, {
          maxFeePerGas: ethers.utils.parseUnits('300', 'gwei'),
          maxPriorityFeePerGas: ethers.utils.parseUnits('3', 'gwei'),
          minProfitMultiplier: 1.05,
          priorityFeePremium: 1.1
        });

        this.arbitrage = new Arbitrage(
          wallet,
          provider as any,
          bundleExecutor,
          COW_SOLVER_THRESHOLDS,  // Use CoW-specific thresholds (much more permissive)
          circuitBreaker,
          gasPriceManager
        );

        // Initialize Hybrid GA Engine for multi-path optimization
        this.hybridGAEngine = new HybridGAEngine(
          wallet,
          provider as any,
          bundleExecutor,
          COW_SOLVER_THRESHOLDS,
          circuitBreaker,
          gasPriceManager
        );

        logger.info('Advanced routing engine initialized', {
          arbitrage: true,
          geneticAlgorithm: true
        });
      } catch (error) {
        logger.warn('Failed to initialize Arbitrage, using basic routing', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    logger.info('CoW Protocol Adapter initialized', {
      settlementEngine: 'OrderSettlementEngine',
      oracleManager: this.oracleManager.getStats(),
      advancedRouting: this.arbitrage !== null
    });
  }

  /**
   * Convert CoW auction liquidity pools to our market format
   */
  private async parseAuction(auction: CoWAuction): Promise<{
    marketsByToken: MarketsByToken;
    orders: Map<string, CoWOrder>;
  }> {
    const marketsByToken: MarketsByToken = {};
    const orders = new Map<string, CoWOrder>();

    // Store orders for matching later
    auction.orders.forEach(order => {
      orders.set(order.uid, order);
      logger.debug(`Order ${order.uid}: ${order.sellAmount} ${order.sellToken} -> ${order.buyAmount} ${order.buyToken}`);
    });

    // Convert CoW liquidity pools to our UniswapV2EthPair format
    for (const pool of auction.liquidity) {
      try {
        await this.addPoolToMarkets(pool, marketsByToken);
      } catch (error: any) {
        logger.warn(`Failed to add pool: ${error.message}`);
      }
    }

    // Count protocol usage
    const protocolCounts: { [key: string]: number } = {};
    for (const pool of auction.liquidity) {
      protocolCounts[pool.kind] = (protocolCounts[pool.kind] || 0) + 1;
    }

    logger.info(`Parsed ${auction.liquidity.length} pools into ${Object.keys(marketsByToken).length} token markets`, {
      protocols: protocolCounts
    });
    return { marketsByToken, orders };
  }

  /**
   * Add a single pool to the markets structure with multi-protocol support
   */
  private async addPoolToMarkets(
    pool: CoWLiquidity,
    marketsByToken: MarketsByToken
  ): Promise<void> {
    try {
      let market: EthMarket | null = null;

      // Uniswap V2 / Constant Product (case-insensitive)
      const poolKind = pool.kind.toLowerCase();
      if (poolKind === 'constantproduct' || poolKind === 'uniswapv2') {
        market = await this.createUniswapV2Market(pool);
      }
      // Balancer Weighted Pools
      else if (poolKind === 'weightedproduct' || poolKind === 'balancerv2' || poolKind === 'weighted') {
        market = await this.createBalancerMarket(pool);
      }
      // Curve Stable Pools
      else if (poolKind === 'stable' || poolKind === 'curve') {
        market = await this.createCurveMarket(pool);
      }
      // Kyber DMM
      else if (pool.kind === 'KyberDMM') {
        market = await this.createKyberMarket(pool);
      }
      // DODO V2
      else if (pool.kind === 'DODOV2') {
        market = await this.createDodoMarket(pool);
      }
      // Unknown pool type
      else {
        logger.debug(`Unsupported pool kind: ${pool.kind}`);
        return;
      }

      if (!market) return;

      // Add to markets by token (use lowercase for consistency)
      // Handle both array and object formats
      const tokenAddresses = Array.isArray(pool.tokens) 
        ? pool.tokens 
        : Object.keys(pool.tokens);
      
      for (const token of tokenAddresses) {
        const tokenKey = token.toLowerCase();
        if (!marketsByToken[tokenKey]) marketsByToken[tokenKey] = [];
        marketsByToken[tokenKey].push(market);
      }

      logger.debug(`✅ Added ${pool.kind} pool: ${tokenAddresses.join('/')}`);

    } catch (error: any) {
      const tokenAddresses = Array.isArray(pool.tokens) 
        ? pool.tokens 
        : Object.keys(pool.tokens);
      logger.warn(`❌ Failed to add ${pool.kind} pool`, {
        error: error.message,
        tokens: tokenAddresses
      });
    }
  }

  /**
   * Create Uniswap V2 market (existing logic)
   */
  private async createUniswapV2Market(pool: CoWLiquidity): Promise<EthMarket | null> {
    // Handle both array and object formats for tokens
    let tokens: string[];
    let reserves: BigNumber[];
    
    if (Array.isArray(pool.tokens)) {
      tokens = pool.tokens;
      reserves = pool.reserves.map(r => BigNumber.from(r));
    } else {
      // Object format: { "0xabc...": { "balance": "123" }, ... }
      tokens = Object.keys(pool.tokens);
      reserves = tokens.map(addr => BigNumber.from((pool.tokens as any)[addr].balance));
    }

    if (tokens.length !== 2) {
      logger.warn(`ConstantProduct pool must have exactly 2 tokens, got ${tokens.length}`);
      return null;
    }

    const [token0, token1] = tokens;
    const [reserve0, reserve1] = reserves;

    if (reserve0.isZero() || reserve1.isZero()) {
      return null;
    }

    const pair = new UniswapV2EthPair(
      pool.address || pool.router,
      [token0, token1],
      `CoW-${pool.kind}`,
      token0,
      this.provider
    );

    await pair.setReservesViaOrderedBalances([reserve0, reserve1]);
    
    // Verify reserves are accessible
    const testReserves = await pair.getReservesByToken();
    logger.debug(`✅ Created market with reserves: ${Array.isArray(testReserves) ? testReserves[0].toString() + ', ' + testReserves[1].toString() : 'ERROR: Not an array'}`);
    
    return pair;
  }

  /**
   * Create Balancer market with weighted product math
   */
  private async createBalancerMarket(pool: CoWLiquidity): Promise<EthMarket | null> {
    if (!pool.weights || pool.weights.length !== pool.tokens.length) {
      logger.warn('Balancer pool missing weights');
      return null;
    }

    const reserves = pool.reserves.map(r => BigNumber.from(r));

    if (reserves.some(r => r.isZero())) {
      return null;
    }

    // Determine pool type - default to WEIGHTED
    const poolType = pool.kind === 'Stable' || pool.kind === 'StablePhantom'
      ? BalancerPoolType.STABLE
      : BalancerPoolType.WEIGHTED;

    const poolId = pool.address || ethers.utils.hexZeroPad('0x00', 32);

    const market = new BalancerV2Pool(
      pool.address || pool.router,
      poolId,
      pool.tokens,
      this.provider,
      poolType
    );

    await market.setReservesViaOrderedBalances(reserves);
    return market;
  }

  /**
   * Create Curve market with StableSwap amplification math
   */
  private async createCurveMarket(pool: CoWLiquidity): Promise<EthMarket | null> {
    const reserves = pool.reserves.map(r => BigNumber.from(r));

    if (reserves.some(r => r.isZero())) {
      return null;
    }

    const market = new CurvePool(
      pool.address || pool.router,
      pool.tokens,
      this.provider
    );

    await market.setReservesViaOrderedBalances(reserves);
    return market;
  }

  /**
   * Create Kyber DMM market with dynamic fee and amplification
   */
  private async createKyberMarket(pool: CoWLiquidity): Promise<EthMarket | null> {
    const reserves = pool.reserves.map(r => BigNumber.from(r));

    if (reserves.some(r => r.isZero())) {
      return null;
    }

    const market = new KyberDMMPool(
      pool.address || pool.router,
      pool.tokens,
      this.provider
    );

    await market.setReservesViaOrderedBalances(reserves);
    return market;
  }

  /**
   * Create DODO V2 market with PMM (Proactive Market Maker) algorithm
   */
  private async createDodoMarket(pool: CoWLiquidity): Promise<EthMarket | null> {
    const reserves = pool.reserves.map(r => BigNumber.from(r));

    if (reserves.some(r => r.isZero() || reserves.length !== 2)) {
      return null;
    }

    // DODO uses base/quote token model
    const [baseToken, quoteToken] = pool.tokens;

    const market = new DODOV2Pool(
      pool.address || pool.router,
      baseToken,
      quoteToken,
      this.provider
    );

    await market.setReservesViaOrderedBalances(reserves);
    return market;
  }

  /**
   * Build CoW solution from a Coincidence of Wants
   */
  private buildCoWSolution(
    cow: CoincidenceOfWants,
    solutionId: number,
    gasPrice: BigNumber,
    externalPrices: Map<string, BigNumber>
  ): CoWSolution {
    const solution: CoWSolution = {
      id: solutionId,
      prices: {},
      trades: [],
      interactions: [],
      gas: this.gasEstimator.estimateCoWMatchingGas(2).toNumber() // 2 tokens matched
    };

    // Set uniform clearing prices
    solution.prices[cow.sellOrder.sellToken] = this.PRECISION.toString();
    solution.prices[cow.sellOrder.buyToken] = cow.clearingPrice.toString();

    // Add trades for both matched orders
    solution.trades.push({
      kind: 'fulfillment',
      order: cow.sellOrder.uid,
      executedAmount: cow.matchedAmount.toString()
    });

    solution.trades.push({
      kind: 'fulfillment',
      order: cow.buyOrder.uid,
      executedAmount: cow.matchedAmount.mul(cow.clearingPrice).div(this.PRECISION).toString()
    });

    // For CoWs, there's no external liquidity interaction (internal matching)
    // But we still report the interaction for transparency
    solution.interactions.push({
      kind: 'liquidity',
      internalize: true, // This is an internal match
      inputToken: cow.sellOrder.sellToken,
      outputToken: cow.sellOrder.buyToken,
      inputAmount: cow.matchedAmount.toString(),
      outputAmount: cow.matchedAmount.mul(cow.clearingPrice).div(this.PRECISION).toString()
    });

    // Calculate score according to CoW Protocol spec
    // Score = sum of (user_surplus + protocol_fees) * external_price
    const sellTokenPrice = externalPrices.get(cow.sellOrder.sellToken.toLowerCase()) || this.PRECISION;
    const buyTokenPrice = externalPrices.get(cow.sellOrder.buyToken.toLowerCase()) || this.PRECISION;

    // For sell order: surplus is in buy token
    const sellOrderScore = cow.sellOrderSurplus
      .mul(buyTokenPrice)
      .div(this.PRECISION);

    // For buy order: surplus is in sell token
    const buyOrderScore = cow.buyOrderSurplus
      .mul(sellTokenPrice)
      .div(this.PRECISION);

    // Subtract gas cost (in wei)
    const gasCost = BigNumber.from(solution.gas).mul(gasPrice);

    solution.score = sellOrderScore
      .add(buyOrderScore)
      .sub(gasCost)
      .toString();

    return solution;
  }

  /**
   * Build CoW solution from a liquidity-based order execution
   */
  private buildLiquiditySolution(
    execution: OrderExecutionPath,
    solutionId: number,
    gasPrice: BigNumber,
    externalPrices: Map<string, BigNumber>
  ): CoWSolution {
    const solution: CoWSolution = {
      id: solutionId,
      prices: {},
      trades: [],
      interactions: [],
      gas: this.gasEstimator.estimateRouteGas(execution.route).toNumber()
    };

    const order = execution.order;

    // Set uniform clearing prices
    solution.prices[order.sellToken] = this.PRECISION.toString();
    solution.prices[order.buyToken] = execution.clearingPrice.toString();

    // Add trade fulfillment
    const executedAmount = order.kind === 'sell'
      ? execution.inputAmount.toString()
      : execution.outputAmount.toString();

    solution.trades.push({
      kind: 'fulfillment',
      order: order.uid,
      executedAmount,
      fee: order.feeAmount.toString()
    });

    // Add liquidity interactions for the route
    // Each market in the route represents a liquidity interaction
    if (execution.route.length > 0) {
      solution.interactions.push({
        kind: 'liquidity',
        internalize: false,
        inputToken: order.sellToken,
        outputToken: order.buyToken,
        inputAmount: execution.inputAmount.toString(),
        outputAmount: execution.outputAmount.toString()
      });
    }

    // Calculate score according to CoW Protocol spec
    // For sell orders: score = surplus * buy_token_price
    // For buy orders: score = surplus * buy_token_price * limit_price
    const buyTokenPrice = externalPrices.get(order.buyToken.toLowerCase()) || this.PRECISION;

    let score: BigNumber;

    if (order.kind === 'sell') {
      // Surplus is already in buy token
      score = execution.surplus.mul(buyTokenPrice).div(this.PRECISION);
    } else {
      // For buy orders, multiply by limit price
      score = execution.surplus
        .mul(buyTokenPrice)
        .mul(order.limitPrice)
        .div(this.PRECISION)
        .div(this.PRECISION);
    }

    // Subtract gas cost
    const gasCost = execution.estimatedGas.mul(gasPrice);
    score = score.sub(gasCost);

    solution.score = score.toString();

    return solution;
  }

  /**
   * Get external reference prices for tokens (for score calculation)
   * Uses OracleManager with cascading fallback strategy:
   * 1. CoW Protocol native prices (if in auction)
   * 2. 1inch Spot Price Aggregator
   * 3. Pyth Network
   * 4. Fallback to 1:1 (last resort)
   */
  private async getExternalPrices(
    tokens: string[],
    auction?: CoWAuction
  ): Promise<Map<string, BigNumber>> {
    return await this.oracleManager.getExternalPrices(tokens, auction);
  }

  /**
   * Use advanced routing engine to find optimal liquidity routes with route splitting
   * Falls back to OrderSettlementEngine if advanced engine unavailable
   */
  private async findAdvancedLiquidityRoutes(
    orders: ParsedOrder[],
    marketsByToken: MarketsByToken
  ): Promise<OrderExecutionPath[]> {
    // If we have advanced routing, use it
    if (this.arbitrage) {
      logger.info('🚀 Using ADVANCED ROUTING ENGINE with CFMM optimization + route splitting');
      return await this.findRoutesWithArbitrageEngine(orders, marketsByToken);
    }

    // Fallback to basic routing with optional route splitting
    logger.warn('⚠️  Advanced routing not available, using basic routing with route splitting');
    const basicPaths = await this.settlementEngine.findLiquidityRoutes(orders, marketsByToken);

    // Try to improve with route splitting
    return await this.optimizePathsWithSplitting(basicPaths, orders, marketsByToken);
  }

  /**
   * Optimize paths by attempting route splitting for large orders
   */
  private async optimizePathsWithSplitting(
    existingPaths: OrderExecutionPath[],
    orders: ParsedOrder[],
    marketsByToken: MarketsByToken
  ): Promise<OrderExecutionPath[]> {
    const optimizedPaths: OrderExecutionPath[] = [];

    for (const path of existingPaths) {
      // Find all alternative routes for this order
      const alternatives = await this.findAlternativeRoutes(path.order, marketsByToken);

      if (alternatives.length > 1) {
        // Try route splitting
        const splitRoute = await this.routeSplitter.findOptimalSplit(path.order, alternatives);

        if (splitRoute && this.isSplitBetter(splitRoute, path)) {
          logger.info(`✂️  Route splitting improved execution for order ${path.order.uid.substring(0, 10)}...`, {
            originalSurplus: path.surplus.toString(),
            splitSurplus: splitRoute.totalSurplus.toString(),
            routes: splitRoute.routes.length
          });

          // Convert split route back to OrderExecutionPath
          optimizedPaths.push(this.convertSplitToPath(path.order, splitRoute));
          continue;
        }
      }

      // Keep original path if splitting doesn't help
      optimizedPaths.push(path);
    }

    return optimizedPaths;
  }

  /**
   * Find alternative routes for an order
   */
  private async findAlternativeRoutes(
    order: ParsedOrder,
    marketsByToken: MarketsByToken
  ): Promise<OrderExecutionPath[]> {
    const alternatives: OrderExecutionPath[] = [];

    // Get all markets that can handle this trade
    const sellToken = order.sellToken.toLowerCase();
    const buyToken = order.buyToken.toLowerCase();

    const sellMarkets = marketsByToken[sellToken] || [];
    const buyMarkets = marketsByToken[buyToken] || [];

    // Find direct markets
    const directMarkets = sellMarkets.filter(m => buyMarkets.includes(m));

    // Evaluate each market
    for (const market of directMarkets) {
      try {
        const reserves = await market.getReservesByToken();
        if (!Array.isArray(reserves) || reserves.length !== 2) continue;

        const tokenIndexIn = market.tokens.findIndex(t => t.toLowerCase() === sellToken);
        const tokenIndexOut = market.tokens.findIndex(t => t.toLowerCase() === buyToken);

        if (tokenIndexIn === -1 || tokenIndexOut === -1) continue;

        const reserveIn = reserves[tokenIndexIn];
        const reserveOut = reserves[tokenIndexOut];

        if (reserveIn.isZero() || reserveOut.isZero()) continue;

        // Calculate output
        const inputAmount = order.sellAmount.sub(order.feeAmount);
        const amountInWithFee = inputAmount.mul(997);
        const numerator = amountInWithFee.mul(reserveOut);
        const denominator = reserveIn.mul(1000).add(amountInWithFee);
        const outputAmount = numerator.div(denominator);

        const clearingPrice = outputAmount.mul(this.PRECISION).div(inputAmount);

        // Calculate surplus
        const surplus = order.kind === 'sell'
          ? outputAmount.sub(order.minBuyAmountAfterFee)
          : order.maxSellAmountAfterFee.sub(
            reserveIn.mul(order.buyAmount).mul(1000).div(
              reserveOut.sub(order.buyAmount).mul(997)
            )
          );

        if (surplus.lte(0)) continue;

        const estimatedGas = this.gasEstimator.estimateRouteGas([market]);

        alternatives.push({
          order,
          route: [market],
          inputAmount,
          outputAmount,
          estimatedGas,
          clearingPrice,
          surplus
        });
      } catch (error) {
        continue;
      }
    }

    return alternatives;
  }

  /**
   * Check if split route is better than single route
   */
  private isSplitBetter(
    splitRoute: { totalSurplus: BigNumber; totalGas: BigNumber; totalOutput: BigNumber },
    singlePath: OrderExecutionPath
  ): boolean {
    // Account for additional gas cost of splitting
    const gasPrice = BigNumber.from('30000000000'); // 30 gwei
    const splitGasCost = splitRoute.totalGas.mul(gasPrice);
    const singleGasCost = singlePath.estimatedGas.mul(gasPrice);

    const splitScore = splitRoute.totalSurplus.sub(splitGasCost);
    const singleScore = singlePath.surplus.sub(singleGasCost);

    return splitScore.gt(singleScore);
  }

  /**
   * Convert split route to OrderExecutionPath
   */
  private convertSplitToPath(
    order: ParsedOrder,
    splitRoute: { routes: any[]; totalInput: BigNumber; totalOutput: BigNumber; totalGas: BigNumber; totalSurplus: BigNumber }
  ): OrderExecutionPath {
    // Use the first route as representative (simplified - in production would combine properly)
    const firstRoute = splitRoute.routes[0];

    return {
      order,
      route: [firstRoute.market],
      inputAmount: splitRoute.totalInput,
      outputAmount: splitRoute.totalOutput,
      estimatedGas: splitRoute.totalGas,
      clearingPrice: splitRoute.totalOutput.mul(this.PRECISION).div(splitRoute.totalInput),
      surplus: splitRoute.totalSurplus
    };
  }

  /**
   * Find all possible routes for an order (for multi-path optimization)
   */
  private async findAllRoutesForOrder(
    order: ParsedOrder,
    marketsByToken: MarketsByToken
  ): Promise<OrderExecutionPath[]> {
    const routes: OrderExecutionPath[] = [];
    const sellToken = order.sellToken.toLowerCase();
    const buyToken = order.buyToken.toLowerCase();

    // Find all markets that trade this token pair
    const sellMarkets = marketsByToken[sellToken] || [];
    const buyMarkets = marketsByToken[buyToken] || [];
    
    logger.info(`  Markets for ${sellToken.substring(0, 10)}: ${sellMarkets.length}, Markets for ${buyToken.substring(0, 10)}: ${buyMarkets.length}`);
    
    // Find direct markets (pools that have both tokens)
    const directMarkets = sellMarkets.filter(m => 
      m.tokens.map(t => t.toLowerCase()).includes(buyToken)
    );

    logger.info(`  Direct markets that trade this pair: ${directMarkets.length}`);

    if (directMarkets.length === 0) {
      logger.warn(`  ❌ No direct markets for ${sellToken.substring(0, 10)} → ${buyToken.substring(0, 10)}`);
      logger.info(`  Available tokens in marketsByToken: ${Object.keys(marketsByToken).map(t => t.substring(0, 10)).join(', ')}`);
      return routes;
    }

    logger.info(`  Evaluating ${directMarkets.length} potential routes...`);

    // Evaluate each market
    for (const market of directMarkets) {
      try {
        logger.info(`    Testing route via ${market.protocol} at ${market.marketAddress.substring(0, 10)}...`);
        
        // Debug: Check market reserves
        const reserves = await market.getReservesByToken();
        if (Array.isArray(reserves)) {
          logger.info(`    Market reserves: [${reserves[0].toString()}, ${reserves[1].toString()}]`);
          logger.info(`    Market tokens: [${market.tokens[0].substring(0, 10)}, ${market.tokens[1].substring(0, 10)}]`);
        }
        
        // Get output amount for this route
        const output = await market.getTokensOut(
          sellToken,
          buyToken,
          order.sellAmount
        );

        // Get token decimals from auction data (default to 18 if not available)
        const buyTokenDecimals = 18; // TODO: Get from auction.tokens[buyToken].decimals
        
        logger.info(`    Output: ${ethers.utils.formatUnits(output, buyTokenDecimals)} (raw: ${output.toString()})`);
        logger.info(`    Required: ${ethers.utils.formatUnits(order.buyAmount, buyTokenDecimals)} (raw: ${order.buyAmount.toString()})`);

        // Only include if it meets the order's minimum output requirement (compare raw values)
        if (output.gte(order.buyAmount)) {
          const surplus = output.sub(order.buyAmount);
          
          routes.push({
            order,
            route: [market],
            inputAmount: order.sellAmount,
            outputAmount: output,
            estimatedGas: BigNumber.from('150000'), // Single swap gas estimate
            clearingPrice: output.mul(this.PRECISION).div(order.sellAmount),
            surplus
          });

          logger.info(`    ✅ Valid route via ${market.protocol}: output=${ethers.utils.formatUnits(output, 18)}, surplus=${ethers.utils.formatUnits(surplus, 18)}`);
        } else {
          logger.warn(`    ❌ Route via ${market.protocol} insufficient: output=${ethers.utils.formatUnits(output, 18)} < required=${ethers.utils.formatUnits(order.buyAmount, 18)}`);
        }
      } catch (error) {
        logger.error(`    💥 Route evaluation FAILED for ${market.protocol}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Sort by output amount (best first)
    routes.sort((a, b) => (b.outputAmount.gt(a.outputAmount) ? 1 : -1));

    return routes;
  }

  /**
   * Route a single order through available liquidity to maximize output (DEPRECATED - use findAllRoutesForOrder)
   */
  private async routeOrderThroughLiquidity(
    order: ParsedOrder,
    marketsByToken: MarketsByToken
  ): Promise<OrderExecutionPath | null> {
    const routes = await this.findAllRoutesForOrder(order, marketsByToken);
    return routes.length > 0 ? routes[0] : null;
  }

  /**
   * Use Genetic Algorithm to optimize multi-path routing for an order
   */
  private async optimizeWithGA(
    order: ParsedOrder,
    candidatePaths: OrderExecutionPath[],
    marketsByToken: MarketsByToken
  ): Promise<OrderExecutionPath | null> {
    if (!this.hybridGAEngine || candidatePaths.length === 0) {
      return null;
    }

    try {
      logger.info(`  🧬 Running GA optimization for ${candidatePaths.length} candidate paths...`);
      
      // Run the hybrid GA engine with order size for context
      const opportunities = await this.hybridGAEngine.evaluateMarkets(
        marketsByToken,
        order.sellAmount
      );
      
      if (!opportunities || opportunities.length === 0) {
        logger.info(`  GA found no improvement over single-path routing`);
        return null;
      }

      logger.info(`  ✅ GA found ${opportunities.length} opportunities`);

      // Find opportunity that matches this order's token pair
      const matchingOpp = opportunities.find(opp => {
        const buyMarket = opp.buyFromMarket;
        const sellMarket = opp.sellToMarket;
        // Check if this opportunity can fulfill the order
        return (
          buyMarket.tokens.some(t => t.toLowerCase() === order.sellToken.toLowerCase()) &&
          sellMarket.tokens.some(t => t.toLowerCase() === order.buyToken.toLowerCase())
        );
      });

      if (!matchingOpp) {
        logger.info(`  No GA opportunity matches this order's token pair`);
        return null;
      }

      // Convert opportunity to execution path
      return {
        order,
        route: [matchingOpp.buyFromMarket, matchingOpp.sellToMarket],
        inputAmount: order.sellAmount,
        outputAmount: matchingOpp.profit, // Using profit as output for now
        estimatedGas: BigNumber.from('250000'), // Multi-hop estimate
        clearingPrice: this.PRECISION,
        surplus: matchingOpp.profit
      };

    } catch (error) {
      logger.warn(`  GA optimization failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Route CoW Protocol user orders to maximize surplus
   * Uses multi-path optimization with route splitting
   */
  private async findRoutesWithArbitrageEngine(
    orders: ParsedOrder[],
    marketsByToken: MarketsByToken
  ): Promise<OrderExecutionPath[]> {
    const settlements: OrderExecutionPath[] = [];

    logger.info('🎯 Routing user orders to maximize surplus (using multi-path optimization)');

    try {
      // Route each order to maximize user output
      for (const order of orders) {
        logger.info(`🔍 Routing order ${order.uid.substring(0, 10)}... (${order.sellToken.substring(0, 10)} → ${order.buyToken.substring(0, 10)})`);
        
        // Find all possible routes for this order
        const alternativePaths = await this.findAllRoutesForOrder(order, marketsByToken);
        
        logger.info(`Found ${alternativePaths.length} alternative paths for this order`);
        
        if (alternativePaths.length === 0) {
          logger.warn(`❌ No viable routes for order ${order.uid.substring(0, 10)}... (${order.sellToken.substring(0, 6)}...→${order.buyToken.substring(0, 6)}...)`);
          continue;
        }

        // If multiple paths exist, use GA for multi-path optimization
        let finalPath: OrderExecutionPath;
        if (alternativePaths.length > 1 && this.hybridGAEngine) {
          logger.info(`🧬 Using Genetic Algorithm to optimize ${alternativePaths.length}-path split`);
          
          // Use Hybrid GA Engine for optimal multi-path routing
          const gaOptimized = await this.optimizeWithGA(order, alternativePaths, marketsByToken);
          
          if (gaOptimized && gaOptimized.outputAmount.gt(alternativePaths[0].outputAmount)) {
            finalPath = gaOptimized;
            const improvement = gaOptimized.outputAmount.sub(alternativePaths[0].outputAmount);
            logger.info(`✅ GA improved output by ${ethers.utils.formatUnits(improvement, 18)} tokens (${alternativePaths.length} paths optimized)`);
          } else {
            // Single path is best
            finalPath = alternativePaths[0];
            logger.info(`📊 Single path optimal (GA didn't improve)`);
          }
        } else if (alternativePaths.length > 1) {
          // Fallback to RouteSplitter if GA not available
          const optimized = await this.routeSplitter.findOptimalSplit(order, alternativePaths);
          if (optimized && optimized.totalOutput.gt(alternativePaths[0].outputAmount)) {
            finalPath = this.convertSplitToPath(order, optimized);
            logger.info(`✂️  Heuristic split improved output`);
          } else {
            finalPath = alternativePaths[0];
          }
        } else {
          // Only one path available
          finalPath = alternativePaths[0];
        }
        
        settlements.push(finalPath);
        logger.info(`✅ Routed order ${order.uid.substring(0, 10)}...`, {
          sellAmount: ethers.utils.formatUnits(order.sellAmount, 18),
          expectedOutput: ethers.utils.formatUnits(finalPath.outputAmount, 18),
          surplus: ethers.utils.formatUnits(finalPath.surplus, 18),
          paths: alternativePaths.length,
          route: finalPath.route.map(m => m.protocol).join(' → ')
        });
      }

      logger.info(`Advanced routing settled ${settlements.length}/${orders.length} orders`);

    } catch (error) {
      logger.error('Order routing failed', {
        error: error instanceof Error ? error.message : String(error)
      });

      // Fallback to basic routing
      return await this.settlementEngine.findLiquidityRoutes(orders, marketsByToken);
    }

    return settlements;
  }

  /**
   * Check if an arbitrage opportunity can fulfill an order
   */
  private opportunityMatchesOrder(
    opportunity: CrossedMarketDetails,
    order: ParsedOrder
  ): boolean {
    const oppTokens = [
      opportunity.buyFromMarket.tokens[0],
      opportunity.buyFromMarket.tokens[1],
      opportunity.sellToMarket.tokens[0],
      opportunity.sellToMarket.tokens[1]
    ].map(t => t.toLowerCase());

    const orderTokens = [order.sellToken, order.buyToken].map(t => t.toLowerCase());

    // Check if opportunity involves the same tokens as the order
    return orderTokens.every(token => oppTokens.includes(token));
  }

  /**
   * Convert CrossedMarketDetails to OrderExecutionPath format
   */
  private convertOpportunityToPath(
    opportunity: CrossedMarketDetails,
    order: ParsedOrder,
    marketsByToken: MarketsByToken
  ): OrderExecutionPath | null {
    try {
      // Extract the route from the opportunity
      const route: EthMarket[] = [
        opportunity.buyFromMarket,
        opportunity.sellToMarket
      ];

      // Calculate execution details
      const inputAmount = order.sellAmount.sub(order.feeAmount);

      // Use the opportunity's profit calculation
      const outputAmount = opportunity.volume.add(opportunity.profit);

      // Calculate clearing price
      const clearingPrice = outputAmount.mul(this.PRECISION).div(inputAmount);

      // Calculate surplus
      let surplus: BigNumber;
      if (order.kind === 'sell') {
        surplus = outputAmount.sub(order.minBuyAmountAfterFee);
      } else {
        const requiredInput = order.buyAmount.mul(this.PRECISION).div(clearingPrice);
        surplus = order.maxSellAmountAfterFee.sub(requiredInput);
      }

      if (surplus.lte(0)) {
        return null;
      }

      // Use proper gas estimation
      const estimatedGas = this.gasEstimator.estimateRouteGas(route);

      return {
        order,
        route,
        inputAmount,
        outputAmount,
        estimatedGas,
        clearingPrice,
        surplus
      };

    } catch (error) {
      logger.debug(`Failed to convert opportunity to path for order ${order.uid}`, {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Main solver entry point - now using OrderSettlementEngine
   */
  async solve(auction: CoWAuction): Promise<SolverResponse> {
    const startTime = Date.now();
    this.auctionCount++;

    // Initialize auction metrics
    const auctionMetrics: AuctionMetrics = {
      auctionId: auction.id,
      timestamp: startTime,
      orderCount: auction.orders.length,
      liquidityCount: auction.liquidity.length,
      solveTimeMs: 0,
      success: false,
      solutionFound: false
    };

    try {
      logger.info(`🎯 Solving CoW auction ${auction.id} (${this.auctionCount})`);
      logger.info(`Orders: ${auction.orders.length}, Liquidity sources: ${auction.liquidity.length}`);

      // Step 1: Convert CoW liquidity format to our internal market format
      const { marketsByToken } = await this.parseAuction(auction);

      if (Object.keys(marketsByToken).length === 0) {
        logger.warn('No valid markets parsed from auction');
        return { solutions: [] };
      }

      // Step 2: Settlement with ADVANCED ROUTING
      logger.info('Running order settlement engine with advanced routing...');

      // Parse orders
      const parsedOrders = await this.settlementEngine.parseOrders(auction.orders);
      logger.info(`Parsed ${parsedOrders.length} orders`);

      // First, find CoWs (internal matching)
      const cows = this.settlementEngine.findCoincidenceOfWants(parsedOrders);
      logger.info(`Found ${cows.length} CoW matches`);

      // Then, find liquidity routes for remaining orders using ADVANCED ENGINE
      const settledOrderUids = new Set(
        cows.flatMap(cow => [cow.buyOrder.uid, cow.sellOrder.uid])
      );
      const remainingOrders = parsedOrders.filter(o => !settledOrderUids.has(o.uid));

      const liquiditySettlements = await this.findAdvancedLiquidityRoutes(
        remainingOrders,
        marketsByToken
      );

      const settledViaLiquidity = new Set(liquiditySettlements.map(s => s.order.uid));
      const unsettledOrders = remainingOrders.filter(order => !settledViaLiquidity.has(order.uid));

      logger.info('Settlement results:', {
        cowMatches: cows.length,
        liquiditySettlements: liquiditySettlements.length,
        unsettledOrders: unsettledOrders.length
      });

      // Step 3: Get external prices for score calculation
      const allTokens = new Set<string>();
      auction.orders.forEach(order => {
        allTokens.add(order.sellToken.toLowerCase());
        allTokens.add(order.buyToken.toLowerCase());
      });

      let externalPrices: Map<string, BigNumber>;
      try {
        externalPrices = await this.getExternalPrices(Array.from(allTokens), auction);
      } catch (error) {
        logger.error('Failed to get external prices, returning empty solutions', {
          error: error instanceof Error ? error.message : String(error)
        });
        return { solutions: [] }; // Fail gracefully instead of bad solutions
      }

      // Step 4: Convert settlements to CoW solution format
      const gasPrice = BigNumber.from(auction.effectiveGasPrice);
      const solutions: CoWSolution[] = [];
      let solutionId = 0;

      // Build solutions from CoWs
      for (const cow of cows) {
        const solution = this.buildCoWSolution(cow, solutionId++, gasPrice, externalPrices);
        if (BigNumber.from(solution.score || '0').gt(0)) {
          solutions.push(solution);
        }
      }

      // Build solutions from liquidity settlements
      for (const execution of liquiditySettlements) {
        const solution = this.buildLiquiditySolution(execution, solutionId++, gasPrice, externalPrices);
        if (BigNumber.from(solution.score || '0').gt(0)) {
          solutions.push(solution);
        }
      }

      // Step 5: Sort by score descending
      solutions.sort((a, b) => {
        const scoreA = BigNumber.from(a.score || '0');
        const scoreB = BigNumber.from(b.score || '0');
        return scoreB.gt(scoreA) ? 1 : -1;
      });

      const elapsed = Date.now() - startTime;
      logger.info(`🐮 Returning ${solutions.length} solutions for auction ${auction.id} (${elapsed}ms)`, {
        averageScore: solutions.length > 0
          ? solutions.reduce((sum, s) => sum.add(BigNumber.from(s.score || '0')), BigNumber.from(0))
              .div(solutions.length)
              .toString()
          : '0'
      });

      // Record successful solve metrics
      auctionMetrics.solveTimeMs = elapsed;
      auctionMetrics.success = true;
      auctionMetrics.solutionFound = solutions.length > 0;

      if (solutions.length > 0) {
        const topSolution = solutions[0];
        const totalSurplus = solutions.reduce((sum, s) => {
          const surplus = this.calculateSolutionSurplus(s, externalPrices);
          return sum.add(surplus);
        }, BigNumber.from(0));

        auctionMetrics.surplus = ethers.utils.formatEther(totalSurplus);
        auctionMetrics.score = topSolution.score;
        auctionMetrics.gasEstimate = topSolution.gas;
        auctionMetrics.routeCount = liquiditySettlements.length;
        auctionMetrics.cowMatchCount = cows.length;

        // Protocol breakdown
        const protocols = new Set<string>();
        for (const settlement of liquiditySettlements) {
          for (const market of settlement.route) {
            const protocol = this.getMarketProtocol(market);
            protocols.add(protocol);
          }
        }
        auctionMetrics.protocolsUsed = Array.from(protocols);

        auctionMetrics.submitted = true; // We're submitting this solution
      }

      solverMetrics.recordAuction(auctionMetrics);

      return { solutions };

    } catch (error: any) {
      logger.error(`💥 Solver error for auction ${auction.id}:`, error);

      // Record failure metrics
      const elapsed = Date.now() - startTime;
      auctionMetrics.solveTimeMs = elapsed;
      auctionMetrics.success = false;
      auctionMetrics.error = error.message || String(error);

      solverMetrics.recordAuction(auctionMetrics);

      return { solutions: [] };
    }
  }

  /**
   * Get solver statistics - now returns comprehensive metrics
   */
  getStats() {
    return {
      ...solverMetrics.getStats(),
      cachedOrders: this.orderCache.size,
      oracleMetrics: solverMetrics.getOracleMetrics()
    };
  }

  /**
   * Calculate surplus for a solution
   */
  private calculateSolutionSurplus(
    solution: CoWSolution,
    externalPrices: Map<string, BigNumber>
  ): BigNumber {
    let totalSurplus = BigNumber.from(0);

    // Surplus is encoded in the prices - orders get better execution than limit
    // For simplicity, we estimate from score
    if (solution.score) {
      // Score already factors in surplus value
      totalSurplus = BigNumber.from(solution.score);
    }

    return totalSurplus;
  }

  /**
   * Get protocol name from market
   */
  private getMarketProtocol(market: EthMarket): string {
    if (market instanceof BalancerV2Pool) {
      return 'Balancer V2';
    } else if (market instanceof CurvePool) {
      return 'Curve';
    } else if (market instanceof KyberDMMPool) {
      return 'Kyber DMM';
    } else if (market instanceof DODOV2Pool) {
      return 'DODO V2';
    } else if (market instanceof UniswapV2EthPair) {
      return 'Uniswap V2';
    }
    return 'Unknown';
  }

  /**
   * Get detailed metrics for export
   */
  exportMetrics(): string {
    return solverMetrics.exportToJSON();
  }
}