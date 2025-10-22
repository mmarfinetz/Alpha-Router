/**
 * HybridGAEngineWithAggregators
 *
 * Enhanced GA Engine that integrates aggregator quotes (UniswapX, 1inch, 0x, Hashflow)
 * with direct DEX pool routes for optimal path finding
 */

import { BigNumber } from "@ethersproject/bignumber";
import { Wallet } from "@ethersproject/wallet";
import { Provider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { MarketsByToken, CrossedMarketDetails, MarketPair } from "../types";
import { logInfo, logError, logDebug, logWarn } from "../utils/logger";
import { GeneticRouterEngine, GAOptimizationResult, Chromosome } from "./GeneticRouterEngine";
import { DualDecompositionOptimizer } from "./DualDecompositionOptimizer";
import { FullBaselineSystem } from "./FullBaselineSystem";
import { MarketThresholds } from "../config/thresholds";
import { CircuitBreaker } from "../utils/CircuitBreaker";
import { GasPriceManager } from "../utils/GasPriceManager";
import { AggregatorManager, AggregatorQuote } from "../markets/aggregators/AggregatorManager";
import { UniswapXMarket } from "../markets/aggregators/UniswapXMarket";

/**
 * Enhanced configuration with aggregator support
 */
export interface EnhancedHybridEngineConfig {
    useGA: boolean;
    gaTimeBudgetMs: number;
    minOrderSizeForGA: BigNumber;
    preferGAForFragmented: boolean;
    deterministicFallback: boolean;
    adaptiveSelection: boolean;

    // Aggregator settings
    useAggregators: boolean;
    aggregatorWeight: number; // 0-1, how much to favor aggregator quotes
    uniswapXPriority: boolean; // Prioritize UniswapX orders
    maxAggregatorLatencyMs: number;
    parallelAggregatorQueries: boolean;
}

/**
 * Route source types
 */
export enum RouteSource {
    DIRECT_DEX = 'DIRECT_DEX',
    UNISWAPX = 'UNISWAPX',
    ONEINCH = 'ONEINCH',
    ZEROX = 'ZEROX',
    HASHFLOW = 'HASHFLOW',
    GA_OPTIMIZED = 'GA_OPTIMIZED'
}

/**
 * Enhanced route with source tracking
 */
export interface EnhancedRoute extends CrossedMarketDetails {
    source: RouteSource;
    aggregatorQuote?: AggregatorQuote;
    uniswapXOrder?: any;
    confidence: number; // 0-100
    gasEstimate: number;
}

/**
 * Hybrid GA Engine with Aggregator Integration
 */
export class HybridGAEngineWithAggregators {
    private wallet: Wallet;
    private provider: Provider;
    private bundleExecutorContract: Contract;
    private thresholds: MarketThresholds;
    private config: EnhancedHybridEngineConfig;

    // Optimization engines
    private gaEngine: GeneticRouterEngine;
    private dualEngine: DualDecompositionOptimizer;
    private baseline: FullBaselineSystem;
    private aggregatorManager: AggregatorManager;
    private uniswapXMarket?: UniswapXMarket;

    // Utilities
    private circuitBreaker: CircuitBreaker;
    private gasPriceManager: GasPriceManager;

    // Performance tracking
    private stats = {
        gaWins: 0,
        aggregatorWins: 0,
        hybridWins: 0,
        totalRuns: 0,
        avgGATime: 0,
        avgAggregatorTime: 0,
        uniswapXFills: 0,
        totalProfit: BigNumber.from(0)
    };

    constructor(
        wallet: Wallet,
        provider: Provider,
        bundleExecutorContract: Contract,
        thresholds: MarketThresholds,
        circuitBreaker: CircuitBreaker,
        gasPriceManager: GasPriceManager,
        aggregatorManager: AggregatorManager,
        config?: Partial<EnhancedHybridEngineConfig>
    ) {
        this.wallet = wallet;
        this.provider = provider;
        this.bundleExecutorContract = bundleExecutorContract;
        this.thresholds = thresholds;
        this.circuitBreaker = circuitBreaker;
        this.gasPriceManager = gasPriceManager;
        this.aggregatorManager = aggregatorManager;

        this.config = {
            useGA: true,
            gaTimeBudgetMs: 2000,
            minOrderSizeForGA: BigNumber.from(10).pow(18).mul(5), // 5 ETH
            preferGAForFragmented: true,
            deterministicFallback: true,
            adaptiveSelection: true,
            useAggregators: true,
            aggregatorWeight: 0.7, // Favor aggregator quotes
            uniswapXPriority: true,
            maxAggregatorLatencyMs: 1000,
            parallelAggregatorQueries: true,
            ...config
        };

        // Initialize engines
        this.dualEngine = new DualDecompositionOptimizer({
            maxIterations: 100,
            maxPathLength: 4,
            maxPaths: 10,
            convergenceThreshold: 0.001,
            learningRate: 0.01
        });

        this.gaEngine = new GeneticRouterEngine({
            populationSize: 100,
            generations: 50,
            mutationRate: 0.15,
            crossoverRate: 0.85,
            eliteRatio: 0.1,
            maxPathLength: 5,
            maxPaths: 20,
            diversityBonus: 0.1,
            timeBudgetMs: this.config.gaTimeBudgetMs
        });

        // Baseline with integrated path discovery + split optimization
        this.baseline = new FullBaselineSystem({
            maxPaths: 8,
            minProfitWei: this.thresholds.minProfitWei ?? BigNumber.from(0)
        });

        // Get UniswapX market if available
        this.uniswapXMarket = this.aggregatorManager.getAggregator('UniswapX') as UniswapXMarket;

        logInfo("HybridGAEngineWithAggregators initialized", {
            aggregators: this.aggregatorManager.getStats().size,
            uniswapXEnabled: !!this.uniswapXMarket
        });
    }

    /**
     * Main evaluation function with aggregator integration
     */
    async evaluateMarkets(
        marketsByToken: MarketsByToken,
        targetAmount?: BigNumber
    ): Promise<EnhancedRoute[]> {
        this.stats.totalRuns++;

        const startTime = Date.now();
        const routes: EnhancedRoute[] = [];

        // 1. Get aggregator quotes in parallel
        let aggregatorRoutes: EnhancedRoute[] = [];
        if (this.config.useAggregators) {
            aggregatorRoutes = await this.getAggregatorRoutes(marketsByToken, targetAmount);
        }

        // 2. Check UniswapX for fillable orders
        let uniswapXRoutes: EnhancedRoute[] = [];
        if (this.config.uniswapXPriority && this.uniswapXMarket) {
            uniswapXRoutes = await this.getUniswapXRoutes(marketsByToken, targetAmount);
        }

        // 3. Run GA optimization for complex routes
        let gaRoutes: EnhancedRoute[] = [];
        if (this.config.useGA && this.shouldUseGA(marketsByToken, targetAmount)) {
            gaRoutes = await this.runGAWithAggregatorHints(
                marketsByToken,
                targetAmount,
                aggregatorRoutes
            );
        }

        // 4. Run deterministic optimization as fallback
        let deterministicRoutes: EnhancedRoute[] = [];
        if (this.config.deterministicFallback) {
            deterministicRoutes = await this.runDeterministicOptimization(marketsByToken, targetAmount);
        }

        // 5. Merge and rank all routes
        routes.push(...uniswapXRoutes, ...aggregatorRoutes, ...gaRoutes, ...deterministicRoutes);

        // 6. Post-process and deduplicate
        const finalRoutes = await this.rankAndSelectRoutes(routes);

        // 7. Track statistics
        this.updateStats(finalRoutes, Date.now() - startTime);

        logInfo("Enhanced market evaluation completed", {
            totalRoutes: finalRoutes.length,
            uniswapXRoutes: uniswapXRoutes.length,
            aggregatorRoutes: aggregatorRoutes.length,
            gaRoutes: gaRoutes.length,
            profit: finalRoutes[0]?.profit?.toString() || '0',
            evaluationTime: Date.now() - startTime
        });

        return finalRoutes;
    }

    /**
     * Get routes from all aggregators
     */
    private async getAggregatorRoutes(
        marketsByToken: MarketsByToken,
        targetAmount?: BigNumber
    ): Promise<EnhancedRoute[]> {
        const routes: EnhancedRoute[] = [];
        const startTime = Date.now();

        // Get token pairs from markets
        const tokenPairs = this.extractTokenPairs(marketsByToken);

        // Query aggregators for each pair
        const promises = tokenPairs.map(async ({ tokenIn, tokenOut }) => {
            const amount = targetAmount || BigNumber.from(10).pow(18); // 1 ETH default

            try {
                const quotes = await Promise.race([
                    this.aggregatorManager.getAllQuotes(tokenIn, tokenOut, amount),
                    new Promise<AggregatorQuote[]>((_, reject) =>
                        setTimeout(() => reject(new Error('Timeout')), this.config.maxAggregatorLatencyMs)
                    )
                ]);

                return quotes.map(quote => this.convertAggregatorQuoteToRoute(quote));
            } catch (error) {
                logDebug("Aggregator quote failed", { tokenIn, tokenOut, error });
                return [];
            }
        });

        const results = await Promise.allSettled(promises);

        for (const result of results) {
            if (result.status === 'fulfilled') {
                routes.push(...result.value);
            }
        }

        logDebug("Aggregator routes fetched", {
            count: routes.length,
            time: Date.now() - startTime
        });

        return routes;
    }

    /**
     * Get UniswapX fillable orders
     */
    private async getUniswapXRoutes(
        marketsByToken: MarketsByToken,
        targetAmount?: BigNumber
    ): Promise<EnhancedRoute[]> {
        if (!this.uniswapXMarket) return [];

        const routes: EnhancedRoute[] = [];
        const tokenPairs = this.extractTokenPairs(marketsByToken);

        for (const { tokenIn, tokenOut } of tokenPairs) {
            const maxInput = targetAmount || BigNumber.from(10).pow(18).mul(100); // 100 ETH max

            const order = await this.uniswapXMarket.findBestOrder(tokenIn, tokenOut, maxInput);

            if (order) {
                // Check if we can profitably fill this order
                const fillCost = await this.estimateFillCost(order, marketsByToken);
                const profit = this.calculateUniswapXProfit(order, fillCost);

                if (profit.gt(0)) {
                    routes.push({
                        profit,
                        volume: order.input.amount,
                        path: [tokenIn, tokenOut],
                        gasEstimate: 200000,
                        source: RouteSource.UNISWAPX,
                        uniswapXOrder: order,
                        confidence: 95, // High confidence for UniswapX orders
                        buyFromMarket: {} as any, // Placeholder
                        sellToMarket: {} as any, // Placeholder
                        tokenAddress: tokenIn
                    });

                    logInfo("Found profitable UniswapX order", {
                        orderHash: order.orderHash,
                        profit: profit.toString(),
                        input: order.input.amount.toString(),
                        output: order.outputs[0].amount.toString()
                    });
                }
            }
        }

        return routes;
    }

    /**
     * Run GA with hints from aggregator quotes
     */
    private async runGAWithAggregatorHints(
        marketsByToken: MarketsByToken,
        targetAmount: BigNumber | undefined,
        aggregatorHints: EnhancedRoute[]
    ): Promise<EnhancedRoute[]> {
        const startTime = Date.now();

        // Seed GA with aggregator routes as initial population hints
        const seedChromosomes = this.convertRoutesToChromosomes(aggregatorHints);

        // Configure GA with hints
        const gaConfig = {
            ...this.gaEngine.config,
            seedPopulation: seedChromosomes,
            timeBudgetMs: Math.max(500, this.config.gaTimeBudgetMs - (Date.now() - startTime))
        };

        // Run GA optimization
        const startToken = Object.keys(marketsByToken)[0];
        const gaResult = await this.gaEngine.optimize(
            marketsByToken,
            startToken,
            targetAmount || BigNumber.from(10).pow(18)
        );

        // Convert GA results to enhanced routes
        const routes: EnhancedRoute[] = [];

        if (gaResult.bestChromosome) {
            routes.push({
                profit: gaResult.bestChromosome.fitness.surplus,
                volume: gaResult.bestChromosome.fitness.volume,
                path: gaResult.bestChromosome.paths[0]?.map(p => p.tokenA) || [],
                gasEstimate: gaResult.bestChromosome.fitness.gasEstimate.toNumber(),
                source: RouteSource.GA_OPTIMIZED,
                confidence: Math.min(100, 50 + gaResult.convergence * 50),
                buyFromMarket: {} as any,
                sellToMarket: {} as any,
                tokenAddress: startToken,
                marketPairs: gaResult.bestChromosome.paths[0]
            });
        }

        // Add top chromosomes as alternative routes
        for (let i = 1; i < Math.min(5, gaResult.population.length); i++) {
            const chromosome = gaResult.population[i];
            if (chromosome.fitness.surplus.gt(0)) {
                routes.push({
                    profit: chromosome.fitness.surplus,
                    volume: chromosome.fitness.volume,
                    path: chromosome.paths[0]?.map(p => p.tokenA) || [],
                    gasEstimate: chromosome.fitness.gasEstimate.toNumber(),
                    source: RouteSource.GA_OPTIMIZED,
                    confidence: Math.min(100, 40 + gaResult.convergence * 40),
                    buyFromMarket: {} as any,
                    sellToMarket: {} as any,
                    tokenAddress: startToken,
                    marketPairs: chromosome.paths[0]
                });
            }
        }

        logDebug("GA optimization with hints completed", {
            routes: routes.length,
            time: Date.now() - startTime,
            hints: aggregatorHints.length
        });

        return routes;
    }

    /**
     * Run deterministic optimization
     */
    private async runDeterministicOptimization(
        marketsByToken: MarketsByToken,
        targetAmount?: BigNumber
    ): Promise<EnhancedRoute[]> {
        const startToken = Object.keys(marketsByToken)[0];
        const volume = targetAmount || BigNumber.from(10).pow(18);
        const details = await this.baseline.optimize(marketsByToken, startToken, volume);

        return details.map(d => ({
            profit: d.profit,
            volume: d.volume,
            path: d.marketPairs.map(mp => mp.tokens[0]).concat(d.marketPairs[d.marketPairs.length - 1]?.tokens[1] || d.tokenAddress),
            gasEstimate: 250000, // baseline estimate; can be refined later
            source: RouteSource.DIRECT_DEX,
            confidence: 80,
            buyFromMarket: d.buyFromMarket,
            sellToMarket: d.sellToMarket,
            tokenAddress: d.tokenAddress,
            marketPairs: d.marketPairs
        } as EnhancedRoute));
    }

    /**
     * Rank and select best routes
     */
    private async rankAndSelectRoutes(routes: EnhancedRoute[]): Promise<EnhancedRoute[]> {
        // Calculate scores for each route
        const scoredRoutes = routes.map(route => {
            const profitScore = route.profit.div(BigNumber.from(10).pow(15)).toNumber(); // In milliETH
            const gasScore = 300000 / Math.max(route.gasEstimate, 100000); // Lower gas is better
            const confidenceScore = route.confidence / 100;
            const sourceScore = this.getSourceScore(route.source);

            const totalScore =
                profitScore * 0.5 +          // 50% weight on profit
                gasScore * 0.2 +              // 20% weight on gas efficiency
                confidenceScore * 0.2 +       // 20% weight on confidence
                sourceScore * 0.1;            // 10% weight on source preference

            return { route, score: totalScore };
        });

        // Sort by score
        scoredRoutes.sort((a, b) => b.score - a.score);

        // Deduplicate by path
        const seen = new Set<string>();
        const uniqueRoutes: EnhancedRoute[] = [];

        for (const { route } of scoredRoutes) {
            const pathKey = route.path.join('-');
            if (!seen.has(pathKey)) {
                seen.add(pathKey);
                uniqueRoutes.push(route);

                if (uniqueRoutes.length >= 10) break; // Keep top 10
            }
        }

        return uniqueRoutes;
    }

    /**
     * Get source preference score
     */
    private getSourceScore(source: RouteSource): number {
        const scores: Record<RouteSource, number> = {
            [RouteSource.UNISWAPX]: 10,      // Highest - direct Uniswap flow
            [RouteSource.GA_OPTIMIZED]: 8,    // Our unique value prop
            [RouteSource.ONEINCH]: 6,
            [RouteSource.ZEROX]: 6,
            [RouteSource.HASHFLOW]: 5,
            [RouteSource.DIRECT_DEX]: 4
        };
        return scores[source] || 0;
    }

    /**
     * Extract token pairs from markets
     */
    private extractTokenPairs(marketsByToken: MarketsByToken): Array<{tokenIn: string, tokenOut: string}> {
        const pairs: Array<{tokenIn: string, tokenOut: string}> = [];
        const tokens = Object.keys(marketsByToken);

        // Get most liquid pairs
        for (let i = 0; i < Math.min(tokens.length, 5); i++) {
            for (let j = i + 1; j < Math.min(tokens.length, 5); j++) {
                pairs.push({
                    tokenIn: tokens[i],
                    tokenOut: tokens[j]
                });
            }
        }

        return pairs;
    }

    /**
     * Convert aggregator quote to route
     */
    private convertAggregatorQuoteToRoute(quote: AggregatorQuote): EnhancedRoute {
        const sourceMap: Record<string, RouteSource> = {
            '1inch': RouteSource.ONEINCH,
            '0x': RouteSource.ZEROX,
            'Hashflow': RouteSource.HASHFLOW,
            'UniswapX': RouteSource.UNISWAPX
        };

        // Simple profit estimation (would be more complex in production)
        const estimatedCost = quote.amountIn.mul(98).div(100); // 2% slippage assumption
        const profit = quote.amountOut.sub(estimatedCost);

        return {
            profit,
            volume: quote.amountIn,
            path: [quote.tokenIn, quote.tokenOut],
            gasEstimate: quote.gasEstimate,
            source: sourceMap[quote.aggregator] || RouteSource.DIRECT_DEX,
            aggregatorQuote: quote,
            confidence: 70, // Medium confidence for aggregator quotes
            buyFromMarket: {} as any,
            sellToMarket: {} as any,
            tokenAddress: quote.tokenIn
        };
    }

    /**
     * Convert routes to GA chromosomes for seeding
     */
    private convertRoutesToChromosomes(routes: EnhancedRoute[]): Chromosome[] {
        // This would convert routes to chromosome format for GA seeding
        // Simplified implementation
        return [];
    }

    /**
     * Estimate cost to fill UniswapX order
     */
    private async estimateFillCost(order: any, marketsByToken: MarketsByToken): Promise<BigNumber> {
        // This would use the GA or aggregators to find best route to fill the order
        // Simplified: assume 1% slippage
        return order.input.amount.mul(101).div(100);
    }

    /**
     * Calculate profit from UniswapX order
     */
    private calculateUniswapXProfit(order: any, fillCost: BigNumber): BigNumber {
        const outputValue = order.outputs[0].amount;
        return outputValue.sub(fillCost);
    }

    /**
     * Check if GA should be used
     */
    private shouldUseGA(marketsByToken: MarketsByToken, targetAmount?: BigNumber): boolean {
        const marketCount = Object.values(marketsByToken).flat().length;
        const orderSize = targetAmount || BigNumber.from(0);

        return this.config.useGA &&
               marketCount >= 5 &&
               orderSize.gte(this.config.minOrderSizeForGA);
    }

    /**
     * Update statistics
     */
    private updateStats(routes: EnhancedRoute[], evaluationTime: number): void {
        if (routes.length === 0) return;

        const bestRoute = routes[0];

        // Track winner
        switch (bestRoute.source) {
            case RouteSource.GA_OPTIMIZED:
                this.stats.gaWins++;
                break;
            case RouteSource.UNISWAPX:
                this.stats.uniswapXFills++;
                this.stats.aggregatorWins++;
                break;
            case RouteSource.ONEINCH:
            case RouteSource.ZEROX:
            case RouteSource.HASHFLOW:
                this.stats.aggregatorWins++;
                break;
            default:
                this.stats.hybridWins++;
        }

        // Update profit tracking
        this.stats.totalProfit = this.stats.totalProfit.add(bestRoute.profit);

        // Update timing stats
        const alpha = 0.1; // Exponential moving average factor
        this.stats.avgGATime = this.stats.avgGATime * (1 - alpha) + evaluationTime * alpha;

        logInfo("Stats updated", {
            totalRuns: this.stats.totalRuns,
            gaWins: this.stats.gaWins,
            aggregatorWins: this.stats.aggregatorWins,
            uniswapXFills: this.stats.uniswapXFills,
            totalProfit: this.stats.totalProfit.toString(),
            winRate: {
                ga: this.stats.gaWins / this.stats.totalRuns,
                aggregator: this.stats.aggregatorWins / this.stats.totalRuns,
                uniswapX: this.stats.uniswapXFills / this.stats.totalRuns
            }
        });
    }

    /**
     * Get current statistics
     */
    getStats() {
        return {
            ...this.stats,
            aggregatorStats: this.aggregatorManager.getStats()
        };
    }
}
