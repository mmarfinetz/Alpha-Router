/**
 * Simplified Dual Decomposition Optimizer for Academic Publication
 *
 * Basic implementation of graph-based arbitrage detection using
 * Bellman-Ford algorithm for negative cycle detection.
 *
 * Paper: "Hybrid Genetic Algorithm for Optimal User Order Routing in CoW Protocol"
 */

export interface Market {
  marketAddress: string;
  protocol: string;
  tokens: string[];
  feeBps: number;
  reserves?: Record<string, string>;
}

export interface TradingEdge {
  fromToken: string;
  toToken: string;
  market: Market;
  weight: number;       // -log(rate * (1 - fee))
  rate: number;         // Exchange rate
  fee: number;          // Fee fraction
}

export interface ArbitragePath {
  tokens: string[];
  markets: Market[];
  expectedProfit: number;
  weight: number;
}

export interface DualOptimizerConfig {
  maxIterations: number;
  maxPathLength: number;
  minProfitThreshold: number;
}

export class DualDecompositionOptimizer {
  private config: DualOptimizerConfig;
  private graph: Map<string, TradingEdge[]> = new Map();

  constructor(config?: Partial<DualOptimizerConfig>) {
    this.config = {
      maxIterations: 100,
      maxPathLength: 4,
      minProfitThreshold: 0.001,
      ...config
    };
  }

  /**
   * Find profitable paths using graph algorithms
   */
  public findProfitablePaths(
    markets: Market[],
    baseToken: string,
    orderSize: number
  ): ArbitragePath[] {
    // Build graph
    this.buildGraph(markets);

    // Find negative cycles (profitable paths)
    const paths = this.findNegativeCycles(baseToken);

    // Filter by profit threshold
    return paths.filter(p => p.expectedProfit > this.config.minProfitThreshold);
  }

  /**
   * Build directed graph from markets
   */
  private buildGraph(markets: Market[]): void {
    this.graph.clear();

    for (const market of markets) {
      const tokens = market.tokens;

      // For each pair of tokens in the market
      for (let i = 0; i < tokens.length; i++) {
        for (let j = 0; j < tokens.length; j++) {
          if (i === j) continue;

          const fromToken = tokens[i];
          const toToken = tokens[j];

          // Calculate exchange rate (simplified)
          const rate = this.calculateRate(market, fromToken, toToken);
          const fee = market.feeBps / 10000;

          // Weight for shortest path: -log(rate * (1 - fee))
          // Negative cycle means product > 1 (arbitrage opportunity)
          const weight = -Math.log(rate * (1 - fee));

          const edge: TradingEdge = {
            fromToken,
            toToken,
            market,
            weight,
            rate,
            fee
          };

          if (!this.graph.has(fromToken)) {
            this.graph.set(fromToken, []);
          }
          this.graph.get(fromToken)!.push(edge);
        }
      }
    }
  }

  /**
   * Calculate exchange rate between tokens in a market
   */
  private calculateRate(market: Market, fromToken: string, toToken: string): number {
    // Simplified constant product formula
    if (market.reserves) {
      const fromReserve = parseFloat(market.reserves[fromToken] || '1');
      const toReserve = parseFloat(market.reserves[toToken] || '1');

      if (fromReserve > 0 && toReserve > 0) {
        // Basic x*y=k formula
        return toReserve / fromReserve;
      }
    }

    // Default rate if no reserves
    return 0.98 + Math.random() * 0.04; // Slight variation around 1.0
  }

  /**
   * Find negative cycles using modified Bellman-Ford algorithm
   */
  private findNegativeCycles(startToken: string): ArbitragePath[] {
    const paths: ArbitragePath[] = [];
    const tokens = Array.from(this.graph.keys());

    // Distance and predecessor tracking
    const distance: Map<string, number> = new Map();
    const predecessor: Map<string, TradingEdge | null> = new Map();

    // Initialize distances
    for (const token of tokens) {
      distance.set(token, token === startToken ? 0 : Infinity);
      predecessor.set(token, null);
    }

    // Relax edges V-1 times
    for (let i = 0; i < tokens.length - 1; i++) {
      let updated = false;

      for (const [fromToken, edges] of this.graph.entries()) {
        const fromDist = distance.get(fromToken)!;
        if (fromDist === Infinity) continue;

        for (const edge of edges) {
          const toDist = distance.get(edge.toToken)!;
          const newDist = fromDist + edge.weight;

          if (newDist < toDist) {
            distance.set(edge.toToken, newDist);
            predecessor.set(edge.toToken, edge);
            updated = true;
          }
        }
      }

      if (!updated) break; // Early termination
    }

    // Check for negative cycles
    for (const [fromToken, edges] of this.graph.entries()) {
      const fromDist = distance.get(fromToken)!;
      if (fromDist === Infinity) continue;

      for (const edge of edges) {
        const toDist = distance.get(edge.toToken)!;
        const newDist = fromDist + edge.weight;

        if (newDist < toDist) {
          // Found negative cycle
          const cycle = this.extractCycle(edge, predecessor);
          if (cycle && cycle.tokens[0] === startToken) {
            paths.push(cycle);
          }
        }
      }
    }

    // Also find simple profitable paths (not cycles)
    const simplePaths = this.findSimplePaths(startToken, distance, predecessor);
    paths.push(...simplePaths);

    return paths;
  }

  /**
   * Extract cycle from predecessor map
   */
  private extractCycle(
    startEdge: TradingEdge,
    predecessor: Map<string, TradingEdge | null>
  ): ArbitragePath | null {
    const visited = new Set<string>();
    const path: TradingEdge[] = [];
    let current: TradingEdge | null = startEdge;

    // Trace back to find cycle
    while (current && !visited.has(current.fromToken)) {
      visited.add(current.fromToken);
      path.push(current);
      current = predecessor.get(current.fromToken) || null;

      if (path.length > this.config.maxPathLength) {
        return null; // Path too long
      }
    }

    if (path.length === 0) return null;

    // Build arbitrage path
    const tokens: string[] = [];
    const markets: Market[] = [];
    let totalWeight = 0;

    for (const edge of path.reverse()) {
      if (tokens.length === 0 || tokens[tokens.length - 1] === edge.fromToken) {
        if (tokens.length === 0) {
          tokens.push(edge.fromToken);
        }
        tokens.push(edge.toToken);
        markets.push(edge.market);
        totalWeight += edge.weight;
      }
    }

    // Calculate expected profit
    const expectedProfit = Math.exp(-totalWeight) - 1;

    return {
      tokens,
      markets,
      expectedProfit,
      weight: totalWeight
    };
  }

  /**
   * Find simple profitable paths (not necessarily cycles)
   */
  private findSimplePaths(
    startToken: string,
    distance: Map<string, number>,
    predecessor: Map<string, TradingEdge | null>
  ): ArbitragePath[] {
    const paths: ArbitragePath[] = [];

    // Check each token as potential end point
    for (const [endToken, dist] of distance.entries()) {
      if (endToken === startToken || dist === Infinity) continue;

      // Trace path from end to start
      const path: TradingEdge[] = [];
      let current = endToken;
      let edge = predecessor.get(current);

      while (edge && path.length < this.config.maxPathLength) {
        path.push(edge);
        current = edge.fromToken;
        edge = predecessor.get(current);

        if (current === startToken) break;
      }

      if (current === startToken && path.length > 0) {
        // Valid path found
        const tokens = [startToken];
        const markets: Market[] = [];
        let totalWeight = 0;

        for (const e of path.reverse()) {
          tokens.push(e.toToken);
          markets.push(e.market);
          totalWeight += e.weight;
        }

        const expectedProfit = 1 - Math.exp(totalWeight);

        if (expectedProfit > this.config.minProfitThreshold) {
          paths.push({
            tokens,
            markets,
            expectedProfit,
            weight: totalWeight
          });
        }
      }
    }

    return paths;
  }

  /**
   * Get warm-start seeds for GA
   */
  public getWarmStartSeeds(
    markets: Market[],
    baseToken: string,
    count: number = 5
  ): ArbitragePath[] {
    const paths = this.findProfitablePaths(markets, baseToken, 1.0);

    // Sort by profit and return top N
    paths.sort((a, b) => b.expectedProfit - a.expectedProfit);

    return paths.slice(0, count);
  }
}