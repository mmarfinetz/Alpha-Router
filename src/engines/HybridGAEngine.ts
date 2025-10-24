/**
 * Simplified Hybrid GA Engine for Academic Publication
 *
 * Combines genetic algorithm with deterministic optimizer through
 * adaptive selection based on instance characteristics.
 *
 * Paper: "Hybrid Genetic Algorithm for Optimal User Order Routing in CoW Protocol"
 */

import { GeneticRouterEngine, Chromosome, GAConfig } from './GeneticRouterEngine';
import { DualDecompositionOptimizer, Market, ArbitragePath } from './DualDecompositionOptimizer';

export interface HybridConfig {
  useGA: boolean;
  adaptiveSelection: boolean;
  gaTimeBudgetMs: number;
  minOrderSizeForGA: number;
  fragmentationThreshold: number;
}

export interface InstanceProfile {
  orderSize: number;
  fragmentationScore: number;
  marketCount: number;
  tokenCount: number;
  recommendGA: boolean;
}

export interface OptimizationResult {
  method: 'GA' | 'DETERMINISTIC' | 'HYBRID';
  // The actual solver whose route was selected for deployment
  selectedMethod?: 'GA' | 'DETERMINISTIC';
  bestSolution: {
    paths: any[];
    splitRatios: number[];
    expectedSurplus: number;
    gasUnits: number;
  };
  computationTime: number;
  generations?: number;
}

export class HybridGAEngine {
  private gaEngine: GeneticRouterEngine;
  private dualOptimizer: DualDecompositionOptimizer;
  private config: HybridConfig;

  // Performance tracking
  private stats = {
    gaWins: 0,
    deterministicWins: 0,
    totalRuns: 0,
    hybridRuns: 0,
    gaRuns: 0,
    deterministicRuns: 0
  };

  constructor(config?: Partial<HybridConfig>) {
    this.config = {
      useGA: true,
      adaptiveSelection: true,
      gaTimeBudgetMs: 2000,
      minOrderSizeForGA: 5.0, // 5 ETH equivalent
      fragmentationThreshold: 0.5,
      ...config
    };

    // Initialize GA engine
    const gaConfig: GAConfig = {
      populationSize: 64,
      maxGenerations: 100,
      crossoverRate: 0.8,
      mutationRate: 0.2,
      eliteCount: 5,
      maxPaths: 3,
      maxPathLength: 4,
      timeBudgetMs: this.config.gaTimeBudgetMs
    };
    this.gaEngine = new GeneticRouterEngine(gaConfig);

    // Initialize deterministic optimizer
    this.dualOptimizer = new DualDecompositionOptimizer({
      maxIterations: 100,
      maxPathLength: 4,
      minProfitThreshold: 0.001
    });
  }

  /**
   * Main optimization entry point
   */
  public optimize(
    markets: Market[],
    baseToken: string,
    quoteToken: string,
    orderSize: number
  ): OptimizationResult {
    const startTime = Date.now();

    // Profile instance
    const profile = this.profileInstance(markets, orderSize);

    // Decide which method to use
    const useGA = this.shouldUseGA(profile);

    let result: OptimizationResult;

    if (!this.config.useGA || !useGA) {
      // Use deterministic optimizer
      result = this.runDeterministic(markets, baseToken, quoteToken, orderSize);
      result.method = 'DETERMINISTIC';
      result.selectedMethod = 'DETERMINISTIC';
    } else if (this.config.adaptiveSelection) {
      // Run both and select best (hybrid approach)
      result = this.runHybrid(markets, baseToken, quoteToken, orderSize);
      result.method = 'HYBRID';
    } else {
      // Use GA only
      result = this.runGA(markets, baseToken, quoteToken, orderSize);
      result.method = 'GA';
      result.selectedMethod = 'GA';
    }

    result.computationTime = Date.now() - startTime;

    // Update statistics
    this.updateStats(result.method, result.selectedMethod || (result.method as 'GA'|'DETERMINISTIC'));

    return result;
  }

  /**
   * Profile instance characteristics
   */
  private profileInstance(markets: Market[], orderSize: number): InstanceProfile {
    // Count unique tokens
    const tokens = new Set<string>();
    for (const market of markets) {
      market.tokens.forEach(t => tokens.add(t));
    }

    // Calculate fragmentation score
    // Higher score means liquidity is more fragmented across markets
    const avgMarketsPerPair = markets.length / Math.max(1, tokens.size * (tokens.size - 1) / 2);
    const fragmentationScore = Math.min(1, avgMarketsPerPair / 3);

    // Recommend GA for larger orders and fragmented markets
    const recommendGA =
      orderSize >= this.config.minOrderSizeForGA &&
      fragmentationScore >= this.config.fragmentationThreshold;

    return {
      orderSize,
      fragmentationScore,
      marketCount: markets.length,
      tokenCount: tokens.size,
      recommendGA
    };
  }

  /**
   * Decide whether to use GA based on profile
   */
  private shouldUseGA(profile: InstanceProfile): boolean {
    if (!this.config.adaptiveSelection) {
      return true; // Always use GA if adaptive selection is disabled
    }

    return profile.recommendGA;
  }

  /**
   * Run deterministic optimizer
   */
  private runDeterministic(
    markets: Market[],
    baseToken: string,
    quoteToken: string,
    orderSize: number
  ): OptimizationResult {
    // Find profitable paths
    const paths = this.dualOptimizer.findProfitablePaths(markets, baseToken, orderSize);

    if (paths.length === 0) {
      return {
        method: 'DETERMINISTIC',
        selectedMethod: 'DETERMINISTIC',
        bestSolution: {
          paths: [],
          splitRatios: [],
          expectedSurplus: 0,
          gasUnits: 21000
        },
        computationTime: 0
      };
    }

    // Select best path (simplified - just take most profitable)
    const bestPath = paths[0];

    // Convert to standard format
    const solution = {
      paths: [this.convertPath(bestPath)],
      splitRatios: [1.0], // Single path, 100% allocation
      expectedSurplus: bestPath.expectedProfit * orderSize,
      gasUnits: 21000 + (bestPath.markets.length * 150000)
    };

    return {
      method: 'DETERMINISTIC',
      selectedMethod: 'DETERMINISTIC',
      bestSolution: solution,
      computationTime: 0
    };
  }

  /**
   * Run genetic algorithm
   */
  private runGA(
    markets: Market[],
    baseToken: string,
    quoteToken: string,
    orderSize: number
  ): OptimizationResult {
    // Run GA optimization
    const gaResult = this.gaEngine.optimize(baseToken, quoteToken, orderSize, markets);

    // Convert to standard format
    const solution = {
      paths: gaResult.best.paths,
      splitRatios: gaResult.best.splitRatios,
      expectedSurplus: gaResult.best.fitness.surplus,
      gasUnits: gaResult.best.fitness.gasUnits
    };

    return {
      method: 'GA',
      selectedMethod: 'GA',
      bestSolution: solution,
      computationTime: 0,
      generations: gaResult.generations
    };
  }

  /**
   * Run hybrid approach (both methods)
   */
  private runHybrid(
    markets: Market[],
    baseToken: string,
    quoteToken: string,
    orderSize: number
  ): OptimizationResult {
    // Run deterministic first (warm start)
    const deterministicResult = this.runDeterministic(markets, baseToken, quoteToken, orderSize);

    // Run GA with warm start from deterministic
    const gaResult = this.runGA(markets, baseToken, quoteToken, orderSize);

    // Select best based on net surplus (surplus - gas cost)
    const gasPrice = 30; // Gwei
    const ethPrice = 3000; // USD

    const detNetSurplus = deterministicResult.bestSolution.expectedSurplus -
      (deterministicResult.bestSolution.gasUnits * gasPrice * 1e-9);

    const gaNetSurplus = gaResult.bestSolution.expectedSurplus -
      (gaResult.bestSolution.gasUnits * gasPrice * 1e-9);

    if (gaNetSurplus > detNetSurplus) {
      return gaResult; // winner: GA
    } else {
      return deterministicResult; // winner: deterministic
    }
  }

  /**
   * Convert ArbitragePath to standard format
   */
  private convertPath(path: ArbitragePath): any {
    const hops = [];
    for (let i = 0; i < path.tokens.length - 1; i++) {
      hops.push({
        fromToken: path.tokens[i],
        toToken: path.tokens[i + 1],
        poolAddress: path.markets[i].marketAddress,
        protocol: path.markets[i].protocol
      });
    }
    return hops;
  }

  /**
   * Update performance statistics
   */
  private updateStats(mode: 'GA' | 'DETERMINISTIC' | 'HYBRID', winner: 'GA' | 'DETERMINISTIC'): void {
    this.stats.totalRuns++;

    // Track which orchestration mode was used
    if (mode === 'HYBRID') this.stats.hybridRuns++;
    else if (mode === 'GA') this.stats.gaRuns++;
    else if (mode === 'DETERMINISTIC') this.stats.deterministicRuns++;

    // Track who actually won
    if (winner === 'GA') this.stats.gaWins++;
    else this.stats.deterministicWins++;
  }

  /**
   * Get performance statistics
   */
  public getStats(): any {
    return {
      ...this.stats,
      gaWinRate: this.stats.totalRuns > 0 ? this.stats.gaWins / this.stats.totalRuns : 0,
      deterministicWinRate: this.stats.totalRuns > 0 ? this.stats.deterministicWins / this.stats.totalRuns : 0,
      modeBreakdown: {
        hybrid: this.stats.hybridRuns,
        gaOnly: this.stats.gaRuns,
        deterministicOnly: this.stats.deterministicRuns,
      }
    };
  }

  /**
   * Fallback guarantee: ensure we never underperform baseline
   */
  public ensureFallbackGuarantee(
    gaResult: OptimizationResult,
    deterministicResult: OptimizationResult
  ): OptimizationResult {
    // Always return solution with higher net surplus
    const gaNetSurplus = gaResult.bestSolution.expectedSurplus -
      (gaResult.bestSolution.gasUnits * 30 * 1e-9);

    const detNetSurplus = deterministicResult.bestSolution.expectedSurplus -
      (deterministicResult.bestSolution.gasUnits * 30 * 1e-9);

    return gaNetSurplus >= detNetSurplus ? gaResult : deterministicResult;
  }
}
