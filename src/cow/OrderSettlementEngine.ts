import { BigNumber } from "@ethersproject/bignumber";
import { providers } from "ethers";
import { formatEther } from "@ethersproject/units";
import logger from '../utils/logger';
import { MarketsByToken } from '../types';
import { EthMarket } from '../EthMarket';
import { CoWOrder, CoWLiquidity } from './types';
import { WETH_ADDRESS } from '../addresses';

/**
 * Represents a validated and parsed user order with computed properties
 */
export interface ParsedOrder {
  uid: string;
  sellToken: string;
  buyToken: string;
  sellAmount: BigNumber;
  buyAmount: BigNumber;
  kind: 'sell' | 'buy';
  limitPrice: BigNumber; // Price in 18 decimal fixed point
  partiallyFillable: boolean;
  validTo: number;
  owner: string;
  feeAmount: BigNumber;

  // Computed fields
  minBuyAmountAfterFee: BigNumber; // For sell orders
  maxSellAmountAfterFee: BigNumber; // For buy orders
}

/**
 * Represents a Coincidence of Wants (CoW) - direct order matching
 */
export interface CoincidenceOfWants {
  buyOrder: ParsedOrder;
  sellOrder: ParsedOrder;
  matchedToken: string; // The token being traded
  matchedAmount: BigNumber; // Amount that can be matched
  clearingPrice: BigNumber; // Uniform clearing price
  buyOrderSurplus: BigNumber;
  sellOrderSurplus: BigNumber;
  totalSurplus: BigNumber;
}

/**
 * Represents an order execution path through liquidity
 */
export interface OrderExecutionPath {
  order: ParsedOrder;
  route: EthMarket[]; // Sequence of markets to trade through
  inputAmount: BigNumber;
  outputAmount: BigNumber;
  estimatedGas: BigNumber;
  clearingPrice: BigNumber;
  surplus: BigNumber;
}

/**
 * Trade direction for uniform clearing price grouping
 */
interface TradeDirection {
  sellToken: string;
  buyToken: string;
}

/**
 * Order Settlement Engine - Core logic for CoW Protocol batch auction settlement
 *
 * This engine implements the correct optimization problem:
 * - Maximize total user surplus across all orders
 * - Find Coincidence of Wants (direct order matching)
 * - Route remaining orders through liquidity optimally
 * - Ensure uniform directional clearing prices
 * - Respect order acceptance sets and constraints
 */
export class OrderSettlementEngine {
  private readonly provider: providers.Provider;
  private readonly PRECISION = BigNumber.from('1000000000000000000'); // 18 decimals
  private readonly UNISWAP_FEE = BigNumber.from('997'); // 0.3% fee
  private readonly UNISWAP_FEE_DENOM = BigNumber.from('1000');

  constructor(provider: providers.Provider) {
    this.provider = provider;
  }

  /**
   * Main entry point: Settle a batch of orders
   *
   * @param orders User orders from CoW auction
   * @param liquidity Available liquidity sources
   * @param marketsByToken Pre-parsed market data
   * @returns Array of settlement solutions (CoWs and liquidity routes)
   */
  public async settleBatch(
    orders: CoWOrder[],
    liquidity: CoWLiquidity[],
    marketsByToken: MarketsByToken
  ): Promise<{
    cows: CoincidenceOfWants[];
    liquiditySettlements: OrderExecutionPath[];
    unsettledOrders: ParsedOrder[];
  }> {
    logger.info('Starting batch settlement', {
      orderCount: orders.length,
      liquiditySourceCount: liquidity.length
    });

    // Step 1: Parse and validate all orders
    const parsedOrders = await this.parseOrders(orders);
    logger.info(`Parsed ${parsedOrders.length}/${orders.length} valid orders`);

    // Step 2: Find Coincidence of Wants (direct order matching)
    const cows = this.findCoincidenceOfWants(parsedOrders);
    logger.info(`Found ${cows.length} CoW matches`, {
      totalCoWSurplus: cows.reduce((sum, cow) => sum.add(cow.totalSurplus), BigNumber.from(0)).toString()
    });

    // Step 3: Get remaining orders that weren't matched in CoWs
    const settledOrderUids = new Set(
      cows.flatMap(cow => [cow.buyOrder.uid, cow.sellOrder.uid])
    );
    const remainingOrders = parsedOrders.filter(order => !settledOrderUids.has(order.uid));

    // Step 4: Find optimal liquidity routes for remaining orders
    const liquiditySettlements = await this.findLiquidityRoutes(
      remainingOrders,
      marketsByToken
    );
    logger.info(`Settled ${liquiditySettlements.length}/${remainingOrders.length} orders via liquidity`);

    // Step 5: Validate uniform clearing prices
    this.validateUniformClearingPrices([...cows, ...liquiditySettlements]);

    // Step 6: Identify unsettled orders
    const settledViaLiquidity = new Set(liquiditySettlements.map(s => s.order.uid));
    const unsettledOrders = remainingOrders.filter(order => !settledViaLiquidity.has(order.uid));

    logger.info('Batch settlement complete', {
      cowMatches: cows.length,
      liquiditySettlements: liquiditySettlements.length,
      unsettledOrders: unsettledOrders.length
    });

    return {
      cows,
      liquiditySettlements,
      unsettledOrders
    };
  }

  /**
   * Parse and validate user orders
   */
  public async parseOrders(orders: CoWOrder[]): Promise<ParsedOrder[]> {
    const parsed: ParsedOrder[] = [];

    for (const order of orders) {
      try {
        const sellAmount = BigNumber.from(order.sellAmount);
        const buyAmount = BigNumber.from(order.buyAmount);
        const feeAmount = BigNumber.from(order.feeAmount || '0');

        // Calculate limit price (how much buy token per sell token)
        // For sell orders: limitPrice = buyAmount / sellAmount
        // For buy orders: limitPrice = buyAmount / sellAmount (same formula)
        const limitPrice = buyAmount.mul(this.PRECISION).div(sellAmount);

        // Calculate acceptance constraints
        let minBuyAmountAfterFee = BigNumber.from(0);
        let maxSellAmountAfterFee = BigNumber.from(0);

        if (order.kind === 'sell') {
          // Sell order: User sells exactly sellAmount, expects at least buyAmount
          // After fee: net sell amount = sellAmount - feeAmount
          const netSellAmount = sellAmount.sub(feeAmount);
          minBuyAmountAfterFee = netSellAmount.mul(limitPrice).div(this.PRECISION);
        } else {
          // Buy order: User wants exactly buyAmount, willing to pay up to sellAmount
          // After fee: max sell = sellAmount + feeAmount
          maxSellAmountAfterFee = sellAmount.add(feeAmount);
        }

        const parsedOrder: ParsedOrder = {
          uid: order.uid,
          sellToken: order.sellToken.toLowerCase(),
          buyToken: order.buyToken.toLowerCase(),
          sellAmount,
          buyAmount,
          kind: order.kind,
          limitPrice,
          partiallyFillable: order.partiallyFillable,
          validTo: order.validTo,
          owner: order.owner,
          feeAmount,
          minBuyAmountAfterFee,
          maxSellAmountAfterFee
        };

        parsed.push(parsedOrder);

      } catch (error) {
        logger.warn(`Failed to parse order ${order.uid}`, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return parsed;
  }

  /**
   * Find Coincidence of Wants - orders that can be matched directly
   *
   * A CoW exists when:
   * - One user wants to buy token A with token B
   * - Another user wants to buy token B with token A
   * - Their limit prices cross (allowing profitable matching)
   */
  public findCoincidenceOfWants(orders: ParsedOrder[]): CoincidenceOfWants[] {
    const cows: CoincidenceOfWants[] = [];

    // Group orders by token pair
    const ordersByPair = new Map<string, ParsedOrder[]>();

    for (const order of orders) {
      // Create canonical pair key (sorted)
      const tokens = [order.sellToken, order.buyToken].sort();
      const pairKey = `${tokens[0]}-${tokens[1]}`;

      if (!ordersByPair.has(pairKey)) {
        ordersByPair.set(pairKey, []);
      }
      ordersByPair.get(pairKey)!.push(order);
    }

    // For each token pair, find matching orders
    for (const [pairKey, pairOrders] of Array.from(ordersByPair.entries())) {
      if (pairOrders.length < 2) continue;

      // Split into two directions
      const direction1 = pairOrders.filter(o =>
        o.sellToken < o.buyToken
      );
      const direction2 = pairOrders.filter(o =>
        o.sellToken > o.buyToken
      );

      // Try to match orders from opposite directions
      for (const order1 of direction1) {
        for (const order2 of direction2) {
          const cow = this.tryMatchOrders(order1, order2);
          if (cow) {
            cows.push(cow);
          }
        }
      }
    }

    // Sort by total surplus descending
    cows.sort((a, b) => b.totalSurplus.gt(a.totalSurplus) ? 1 : -1);

    return cows;
  }

  /**
   * Try to match two orders directly
   */
  private tryMatchOrders(order1: ParsedOrder, order2: ParsedOrder): CoincidenceOfWants | null {
    // Orders must trade opposite directions
    if (order1.sellToken !== order2.buyToken || order1.buyToken !== order2.sellToken) {
      return null;
    }

    // Check if limit prices cross
    // order1 sells A for B at price p1 (how much B per A)
    // order2 sells B for A at price p2 (how much A per B)
    // Prices cross if: p1 * p2 <= 1 (equivalent to: order1.limitPrice * order2.limitPrice <= PRECISION^2)

    const priceProduct = order1.limitPrice.mul(order2.limitPrice);
    const priceThreshold = this.PRECISION.mul(this.PRECISION);

    if (priceProduct.gt(priceThreshold)) {
      // Prices don't cross - no profitable match
      return null;
    }

    // Calculate matched amounts
    // The matched amount is limited by:
    // 1. order1's sell amount
    // 2. order2's buy amount (for the token order1 is selling)
    const maxMatchFromOrder1 = order1.sellAmount;
    const maxMatchFromOrder2 = order2.buyAmount; // order2 wants to buy what order1 sells

    const matchedAmount = maxMatchFromOrder1.lt(maxMatchFromOrder2)
      ? maxMatchFromOrder1
      : maxMatchFromOrder2;

    if (matchedAmount.isZero()) {
      return null;
    }

    // Calculate uniform clearing price (geometric mean of limit prices)
    // clearingPrice = sqrt(order1.limitPrice * order2.limitPrice)
    // This ensures both parties are better off than their limit prices
    const clearingPrice = this.geometricMean(order1.limitPrice, order2.limitPrice);

    // Calculate surplus for each order
    // order1 surplus: amount of buy token received above limit price
    const order1Executed = matchedAmount;
    const order1ExpectedReceive = order1Executed.mul(clearingPrice).div(this.PRECISION);
    const order1MinReceive = order1Executed.mul(order1.limitPrice).div(this.PRECISION);
    const order1Surplus = order1ExpectedReceive.sub(order1MinReceive);

    // order2 surplus: amount of sell token saved vs limit price
    const order2Received = order1Executed; // order2 receives what order1 sold
    const order2ExpectedPay = order2Received.mul(this.PRECISION).div(clearingPrice);
    const order2MaxPay = order2Received.mul(this.PRECISION).div(order2.limitPrice);
    const order2Surplus = order2MaxPay.sub(order2ExpectedPay);

    const totalSurplus = order1Surplus.add(order2Surplus);

    // Only accept if both orders get positive surplus
    if (order1Surplus.lte(0) || order2Surplus.lte(0)) {
      return null;
    }

    return {
      buyOrder: order1.kind === 'buy' ? order1 : order2,
      sellOrder: order1.kind === 'sell' ? order1 : order2,
      matchedToken: order1.sellToken,
      matchedAmount,
      clearingPrice,
      buyOrderSurplus: order1.kind === 'buy' ? order1Surplus : order2Surplus,
      sellOrderSurplus: order1.kind === 'sell' ? order1Surplus : order2Surplus,
      totalSurplus
    };
  }

  /**
   * Calculate geometric mean of two BigNumbers (for clearing price)
   */
  private geometricMean(a: BigNumber, b: BigNumber): BigNumber {
    // sqrt(a * b) = sqrt(a) * sqrt(b)
    // For better precision, we use: sqrt(a * b)

    // Use Newton's method for square root
    const product = a.mul(b);
    if (product.isZero()) return BigNumber.from(0);

    let x = product.div(2);
    let y = product;

    // Iterate until convergence
    for (let i = 0; i < 10; i++) {
      if (x.gte(y)) break;
      y = x;
      x = product.div(x).add(x).div(2);
    }

    return y;
  }

  /**
   * Find optimal liquidity routes for orders that couldn't be matched directly
   */
  public async findLiquidityRoutes(
    orders: ParsedOrder[],
    marketsByToken: MarketsByToken
  ): Promise<OrderExecutionPath[]> {
    const settlements: OrderExecutionPath[] = [];

    for (const order of orders) {
      try {
        const path = await this.findOptimalPath(order, marketsByToken);
        if (path) {
          settlements.push(path);
        }
      } catch (error) {
        logger.debug(`Failed to find liquidity route for order ${order.uid}`, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return settlements;
  }

  /**
   * Find optimal execution path for a single order through available liquidity
   *
   * Implements multi-hop pathfinding through intermediary tokens:
   * - Direct swaps (1 hop)
   * - Intermediate routing (2-3 hops) through common tokens (WETH, USDC, USDT, DAI, WBTC)
   * - Accounts for gas costs per hop
   * - Selects path with maximum net surplus
   */
  private async findOptimalPath(
    order: ParsedOrder,
    marketsByToken: MarketsByToken
  ): Promise<OrderExecutionPath | null> {
    const sellToken = order.sellToken.toLowerCase();
    const buyToken = order.buyToken.toLowerCase();

    const sellMarkets = marketsByToken[sellToken] || [];
    const buyMarkets = marketsByToken[buyToken] || [];

    logger.debug('Looking for markets', {
      sellToken,
      buyToken,
      sellMarketsCount: sellMarkets.length,
      buyMarketsCount: buyMarkets.length
    });

    // Find markets that have both tokens (direct swap)
    const directMarkets = sellMarkets.filter(market =>
      buyMarkets.includes(market)
    );

    logger.debug('Direct markets found', { count: directMarkets.length });

    // Collect all possible paths (direct + multi-hop)
    const candidatePaths: OrderExecutionPath[] = [];

    // Try direct paths (most gas efficient)
    for (const market of directMarkets) {
      try {
        const path = await this.evaluateMarketForOrder(order, market as EthMarket);
        if (path && path.surplus.gt(0)) {
          candidatePaths.push(path);
        }
      } catch (error) {
        continue;
      }
    }

    // Try multi-hop paths if no direct path or to find better execution
    const multiHopPaths = await this.findMultiHopPaths(order, marketsByToken);
    candidatePaths.push(...multiHopPaths);

    if (candidatePaths.length === 0) {
      logger.debug('No viable paths found for order', { orderUid: order.uid });
      return null;
    }

    // Select path with highest net surplus (accounting for gas costs)
    let bestPath: OrderExecutionPath | null = null;
    let bestNetSurplus = BigNumber.from(0);

    // Estimate gas price for cost calculations (30 gwei)
    const gasPrice = BigNumber.from('30000000000');

    for (const path of candidatePaths) {
      // Calculate net surplus = trading surplus - gas cost
      const gasCost = path.estimatedGas.mul(gasPrice);
      const netSurplus = path.surplus.sub(gasCost);

      logger.debug('Evaluating path', {
        hops: path.route.length,
        surplus: formatEther(path.surplus),
        gasCost: formatEther(gasCost),
        netSurplus: formatEther(netSurplus)
      });

      if (netSurplus.gt(bestNetSurplus)) {
        bestPath = path;
        bestNetSurplus = netSurplus;
      }
    }

    if (bestPath) {
      logger.info('Selected optimal path', {
        orderUid: order.uid,
        hops: bestPath.route.length,
        surplus: formatEther(bestPath.surplus),
        netSurplus: formatEther(bestNetSurplus)
      });
    }

    return bestPath;
  }

  /**
   * Find all viable multi-hop paths for an order
   *
   * Uses BFS-based pathfinding to discover routes through intermediary tokens:
   * - 2-hop: sellToken → intermediary → buyToken
   * - 3-hop: sellToken → intermediary1 → intermediary2 → buyToken
   *
   * Common intermediaries: WETH, USDC, USDT, DAI, WBTC
   */
  private async findMultiHopPaths(
    order: ParsedOrder,
    marketsByToken: MarketsByToken
  ): Promise<OrderExecutionPath[]> {
    const MAX_HOPS = 3; // Limit to 3 hops to control gas costs
    const paths: OrderExecutionPath[] = [];

    // Common intermediary tokens (normalized to lowercase)
    const intermediaryTokens = [
      WETH_ADDRESS.toLowerCase(), // WETH
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
      '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
      '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
      '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'  // WBTC
    ];

    const sellToken = order.sellToken.toLowerCase();
    const buyToken = order.buyToken.toLowerCase();

    // Filter out sell/buy tokens from intermediaries
    const validIntermediaries = intermediaryTokens.filter(
      t => t !== sellToken && t !== buyToken
    );

    // BFS structure: [currentToken, pathSoFar, currentAmount]
    interface PathNode {
      token: string;
      markets: EthMarket[];
      amount: BigNumber;
      hopCount: number;
    }

    const queue: PathNode[] = [{
      token: sellToken,
      markets: [],
      amount: order.sellAmount.sub(order.feeAmount),
      hopCount: 0
    }];

    const visited = new Set<string>(); // Track visited tokens to prevent loops

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.hopCount >= MAX_HOPS) {
        continue; // Don't explore beyond max hops
      }

      // Mark as visited
      const visitKey = `${current.token}-${current.hopCount}`;
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);

      // Get markets for current token
      const currentMarkets = marketsByToken[current.token] || [];

      for (const market of currentMarkets) {
        const ethMarket = market as EthMarket;

        // Find which token we would receive from this market
        const outputToken = ethMarket.tokens
          .find(t => t.toLowerCase() !== current.token)
          ?.toLowerCase();

        if (!outputToken) continue;

        // Skip if we've seen this token in current path (prevent loops)
        if (current.markets.some(m => m.tokens.some(t => t.toLowerCase() === outputToken))) {
          continue;
        }

        try {
          // Calculate output amount for this hop
          const reserves = await ethMarket.getReservesByToken();
          if (!Array.isArray(reserves) || reserves.length !== 2) continue;

          const tokenIndexIn = ethMarket.tokens.findIndex(t => t.toLowerCase() === current.token);
          const tokenIndexOut = ethMarket.tokens.findIndex(t => t.toLowerCase() === outputToken);

          if (tokenIndexIn === -1 || tokenIndexOut === -1) continue;

          const reserveIn = reserves[tokenIndexIn];
          const reserveOut = reserves[tokenIndexOut];

          if (reserveIn.isZero() || reserveOut.isZero()) continue;

          // Calculate output using constant product formula
          const amountInWithFee = current.amount.mul(this.UNISWAP_FEE);
          const numerator = amountInWithFee.mul(reserveOut);
          const denominator = reserveIn.mul(this.UNISWAP_FEE_DENOM).add(amountInWithFee);
          const outputAmount = numerator.div(denominator);

          if (outputAmount.isZero()) continue;

          const newPath = [...current.markets, ethMarket];
          const newHopCount = current.hopCount + 1;

          // Check if we reached the target token
          if (outputToken === buyToken) {
            // Complete path found!
            const clearingPrice = outputAmount.mul(this.PRECISION).div(order.sellAmount.sub(order.feeAmount));

            let surplus: BigNumber;
            if (order.kind === 'sell') {
              surplus = outputAmount.sub(order.minBuyAmountAfterFee);
            } else {
              // For buy orders: calculate how much input we actually need
              const maxInput = order.maxSellAmountAfterFee;
              surplus = maxInput.sub(order.sellAmount.sub(order.feeAmount));
            }

            if (surplus.gt(0)) {
              paths.push({
                order,
                route: newPath,
                inputAmount: order.sellAmount.sub(order.feeAmount),
                outputAmount,
                estimatedGas: BigNumber.from(150000 + 100000 * (newHopCount - 1)), // Base + per hop
                clearingPrice,
                surplus
              });

              logger.debug('Found multi-hop path', {
                hops: newHopCount,
                route: newPath.map(m => m.marketAddress).join(' → '),
                outputAmount: formatEther(outputAmount),
                surplus: formatEther(surplus)
              });
            }
          } else if (validIntermediaries.includes(outputToken)) {
            // This is a valid intermediary - continue exploring
            queue.push({
              token: outputToken,
              markets: newPath,
              amount: outputAmount,
              hopCount: newHopCount
            });
          }
        } catch (error) {
          // Skip this market on error
          continue;
        }
      }
    }

    logger.debug('Multi-hop pathfinding complete', {
      pathsFound: paths.length,
      maxHops: MAX_HOPS
    });

    return paths;
  }

  /**
   * Evaluate a specific market for order execution
   */
  private async evaluateMarketForOrder(
    order: ParsedOrder,
    market: EthMarket
  ): Promise<OrderExecutionPath | null> {
    const reserves = await market.getReservesByToken();
    if (!Array.isArray(reserves) || reserves.length !== 2) {
      logger.debug('Invalid reserves format', { marketAddress: market.marketAddress });
      return null;
    }

    // Determine correct reserve order based on token positions
    const tokenIndexIn = market.tokens.findIndex(t => t.toLowerCase() === order.sellToken.toLowerCase());
    const tokenIndexOut = market.tokens.findIndex(t => t.toLowerCase() === order.buyToken.toLowerCase());

    if (tokenIndexIn === -1 || tokenIndexOut === -1) {
      logger.debug('Market does not contain both tokens', {
        marketTokens: market.tokens,
        orderTokens: [order.sellToken, order.buyToken]
      });
      return null; // Market doesn't have both tokens
    }

    const reserveIn = reserves[tokenIndexIn];
    const reserveOut = reserves[tokenIndexOut];

    if (reserveIn.isZero() || reserveOut.isZero()) {
      logger.debug('Invalid reserves (zero)', {
        reserveIn: reserveIn.toString(),
        reserveOut: reserveOut.toString()
      });
      return null; // Invalid reserves
    }

    // Calculate output amount using constant product formula with fee
    const inputAmount = order.sellAmount.sub(order.feeAmount);
    const amountInWithFee = inputAmount.mul(this.UNISWAP_FEE);
    const numerator = amountInWithFee.mul(reserveOut);
    const denominator = reserveIn.mul(this.UNISWAP_FEE_DENOM).add(amountInWithFee);
    const outputAmount = numerator.div(denominator);

    // Calculate clearing price (actual execution price)
    const clearingPrice = outputAmount.mul(this.PRECISION).div(inputAmount);

    // Calculate surplus based on order type
    let surplus: BigNumber;

    if (order.kind === 'sell') {
      // Sell order surplus: output amount - minimum acceptable output
      const minOutput = order.minBuyAmountAfterFee;
      surplus = outputAmount.sub(minOutput);

      logger.debug('Evaluating sell order', {
        inputAmount: formatEther(inputAmount),
        outputAmount: formatEther(outputAmount),
        minOutput: formatEther(minOutput),
        surplus: formatEther(surplus),
        reserveIn: formatEther(reserveIn),
        reserveOut: formatEther(reserveOut)
      });
    } else {
      // Buy order surplus: maximum acceptable input - actual input
      const maxInput = order.maxSellAmountAfterFee;
      // Calculate actual input needed to get desired output
      const requiredInput = reserveIn.mul(order.buyAmount).mul(this.UNISWAP_FEE_DENOM)
        .div(reserveOut.sub(order.buyAmount).mul(this.UNISWAP_FEE));
      surplus = maxInput.sub(requiredInput);
    }

    // Only accept if surplus is positive
    if (surplus.lte(0)) {
      logger.debug('Order not profitable (negative surplus)', {
        surplus: formatEther(surplus),
        orderUid: order.uid
      });
      return null;
    }

    return {
      order,
      route: [market],
      inputAmount,
      outputAmount,
      estimatedGas: BigNumber.from(150000), // Single swap gas estimate
      clearingPrice,
      surplus
    };
  }

  /**
   * Validate and ENFORCE uniform directional clearing prices
   * If prices aren't uniform, adjust to median price (fair to all users)
   *
   * All orders trading the same token pair in the same direction must have the same clearing price
   */
  private validateUniformClearingPrices(
    settlements: Array<CoincidenceOfWants | OrderExecutionPath>
  ): void {
    // Group by trade direction
    const settlementsByDirection = new Map<string, Array<CoincidenceOfWants | OrderExecutionPath>>();

    for (const settlement of settlements) {
      let sellToken: string;
      let buyToken: string;

      if ('matchedToken' in settlement) {
        sellToken = settlement.sellOrder.sellToken;
        buyToken = settlement.sellOrder.buyToken;
      } else {
        sellToken = settlement.order.sellToken;
        buyToken = settlement.order.buyToken;
      }

      const directionKey = `${sellToken}-${buyToken}`;

      if (!settlementsByDirection.has(directionKey)) {
        settlementsByDirection.set(directionKey, []);
      }
      settlementsByDirection.get(directionKey)!.push(settlement);
    }

    // For each direction, enforce uniform pricing
    for (const [direction, directionSettlements] of Array.from(settlementsByDirection.entries())) {
      if (directionSettlements.length <= 1) continue;

      // Calculate median clearing price (most fair)
      const prices = directionSettlements.map(s =>
        'matchedToken' in s ? s.clearingPrice : s.clearingPrice
      );

      prices.sort((a, b) => a.gt(b) ? 1 : -1);
      const medianPrice = prices[Math.floor(prices.length / 2)];

      // Check if uniform
      const allSame = prices.every(p => p.eq(medianPrice));

      if (!allSame) {
        logger.info(`Enforcing uniform price for ${direction}`, {
          priceRange: `${formatEther(prices[0])} - ${formatEther(prices[prices.length - 1])}`,
          enforcedPrice: formatEther(medianPrice)
        });

        // Update all settlements to use median price
        for (const settlement of directionSettlements) {
          if ('matchedToken' in settlement) {
            settlement.clearingPrice = medianPrice;
            // Recalculate surplus with new price
            const cow = settlement;
            cow.buyOrderSurplus = this.recalculateSurplus(cow.buyOrder, medianPrice);
            cow.sellOrderSurplus = this.recalculateSurplus(cow.sellOrder, medianPrice);
            cow.totalSurplus = cow.buyOrderSurplus.add(cow.sellOrderSurplus);
          } else {
            settlement.clearingPrice = medianPrice;
            // Recalculate output amount and surplus
            settlement.surplus = this.recalculateLiquiditySurplus(settlement.order, medianPrice);
          }
        }
      }
    }
  }

  /**
   * Recalculate surplus for an order given a new clearing price
   */
  private recalculateSurplus(order: ParsedOrder, clearingPrice: BigNumber): BigNumber {
    if (order.kind === 'sell') {
      const actualReceive = order.sellAmount.mul(clearingPrice).div(this.PRECISION);
      const minReceive = order.minBuyAmountAfterFee;
      return actualReceive.sub(minReceive);
    } else {
      const maxPay = order.maxSellAmountAfterFee;
      const actualPay = order.buyAmount.mul(this.PRECISION).div(clearingPrice);
      return maxPay.sub(actualPay);
    }
  }

  /**
   * Recalculate surplus for liquidity settlement with new clearing price
   */
  private recalculateLiquiditySurplus(order: ParsedOrder, clearingPrice: BigNumber): BigNumber {
    // Recalculate what user gets/pays at new clearing price
    const inputAmount = order.sellAmount.sub(order.feeAmount);
    const outputAmount = inputAmount.mul(clearingPrice).div(this.PRECISION);

    if (order.kind === 'sell') {
      return outputAmount.sub(order.minBuyAmountAfterFee);
    } else {
      const requiredInput = order.buyAmount.mul(this.PRECISION).div(clearingPrice);
      return order.maxSellAmountAfterFee.sub(requiredInput);
    }
  }
}