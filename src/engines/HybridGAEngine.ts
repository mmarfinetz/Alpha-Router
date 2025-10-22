import { BigNumber } from "@ethersproject/bignumber";
import { Wallet } from "@ethersproject/wallet";
import { Provider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { MarketsByToken, CrossedMarketDetails } from "../types";
import { logInfo, logError, logDebug } from "../utils/logger";
import { GeneticRouterEngine, GAOptimizationResult, Chromosome } from "./GeneticRouterEngine";
import { DualDecompositionOptimizer } from "./DualDecompositionOptimizer";
import { FullBaselineSystem } from "./FullBaselineSystem";
import { MarketThresholds } from "../config/thresholds";
import { CircuitBreaker } from "../utils/CircuitBreaker";
import { GasPriceManager } from "../utils/GasPriceManager";

/**
 * Configuration for Hybrid GA Engine
 */
export interface HybridEngineConfig {
    useGA: boolean; // Enable/disable GA layer
    gaTimeBudgetMs: number;
    minOrderSizeForGA: BigNumber; // Only use GA for larger orders
    preferGAForFragmented: boolean; // Use GA when liquidity is fragmented
    deterministicFallback: boolean; // Always compute deterministic solution
    adaptiveSelection: boolean; // Intelligently choose GA vs deterministic
}

/**
 * Instance characteristics for adaptive algorithm selection
 */
interface InstanceProfile {
    orderSize: BigNumber;
    fragmentationScore: number; // 0-100
    marketDepth: BigNumber;
    volatility: number;
    tokenCount: number;
    marketCount: number;
    recommendGA: boolean;
}

/**
 * Hybrid Genetic Algorithm Engine
 * 
 * Combines GA exploration with deterministic exploitation:
 * 1. GA explores path-sets + split-flow opportunities
 * 2. Dual decomposition provides deterministic baseline
 * 3. Adaptive policy selects best approach per instance
 * 4. Post-processor ensures executability & compliance
 */
export class HybridGAEngine {
    private wallet: Wallet;
    private provider: Provider;
    private bundleExecutorContract: Contract;
    private thresholds: MarketThresholds;
    private config: HybridEngineConfig;
    
    // Optimization engines
    private gaEngine: GeneticRouterEngine;
    private dualEngine: DualDecompositionOptimizer;
    private baseline: FullBaselineSystem;
    
    // Utilities
    private circuitBreaker: CircuitBreaker;
    private gasPriceManager: GasPriceManager;
    
    // Performance tracking
    private stats = {
        gaWins: 0,
        dualWins: 0,
        totalRuns: 0,
        avgGATime: 0,
        avgDualTime: 0
    };

    constructor(
        wallet: Wallet,
        provider: Provider,
        bundleExecutorContract: Contract,
        thresholds: MarketThresholds,
        circuitBreaker: CircuitBreaker,
        gasPriceManager: GasPriceManager,
        config?: Partial<HybridEngineConfig>
    ) {
        this.wallet = wallet;
        this.provider = provider;
        this.bundleExecutorContract = bundleExecutorContract;
        this.thresholds = thresholds;
        this.circuitBreaker = circuitBreaker;
        this.gasPriceManager = gasPriceManager;
        
        this.config = {
            useGA: true,
            gaTimeBudgetMs: 2000, // 2 seconds
            minOrderSizeForGA: BigNumber.from(10).pow(18).mul(5), // 5 ETH minimum
            preferGAForFragmented: true,
            deterministicFallback: true,
            adaptiveSelection: true,
            ...config
        };

        // Initialize engines
        this.dualEngine = new DualDecompositionOptimizer({
            maxIterations: 100,
            maxPathLength: 4,
            minProfitThreshold: thresholds.minProfitWei || BigNumber.from(10).pow(16)
        });

        this.gaEngine = new GeneticRouterEngine(this.dualEngine, {
            populationSize: 64,
            maxGenerations: 100,
            timeBudgetMs: this.config.gaTimeBudgetMs,
            maxPathLength: 4,
            maxSplitPaths: 3,
            minProfitThreshold: thresholds.minProfitWei || BigNumber.from(10).pow(16)
        });

        // Self-contained baseline for deterministic fallback (path discovery + split optimization)
        this.baseline = new FullBaselineSystem({
            maxPaths: 8,
            minProfitWei: thresholds.minProfitWei || BigNumber.from(0)
        });

        logInfo("Hybrid GA Engine initialized", {
            gaEnabled: this.config.useGA,
            adaptiveSelection: this.config.adaptiveSelection,
            timeBudget: this.config.gaTimeBudgetMs
        } as any);
    }

    /**
     * Main evaluation method - intelligently routes to GA or deterministic
     */
    async evaluateMarkets(
        marketsByToken: MarketsByToken,
        orderSize?: BigNumber
    ): Promise<CrossedMarketDetails[]> {
        this.stats.totalRuns++;
        
        // Profile the instance
        const profile = this.profileInstance(marketsByToken, orderSize);
        
        logInfo("Evaluating markets with hybrid engine", {
            recommendGA: profile.recommendGA,
            fragmentationScore: profile.fragmentationScore,
            orderSize: orderSize?.toString(),
            totalMarkets: profile.marketCount
        } as any);

        const opportunities: CrossedMarketDetails[] = [];
        let gaResult: GAOptimizationResult | null = null;
        let dualResult: any = null;
        let baselineDetails: CrossedMarketDetails[] | null = null;

        // Run GA if recommended and enabled
        if (this.config.useGA && profile.recommendGA && !this.circuitBreaker.isTripped()) {
            try {
                gaResult = await this.runGA(marketsByToken, orderSize || BigNumber.from(10).pow(18));
                
                if (gaResult.bestChromosome.feasible) {
                    const gaOpportunity = this.gaEngine.convertToCrossedMarket(
                        gaResult.bestChromosome,
                        Object.keys(marketsByToken)[0]
                    );
                    opportunities.push(gaOpportunity);
                    
                    logInfo("GA found opportunity", {
                        profit: gaOpportunity.profit,
                        paths: gaResult.bestChromosome.paths.length,
                        generations: gaResult.generations
                    } as any);
                }
                
                this.stats.avgGATime = 
                    (this.stats.avgGATime * (this.stats.totalRuns - 1) + gaResult.convergenceTime) / 
                    this.stats.totalRuns;
                    
            } catch (error) {
                logError("GA execution failed", { error: error as Error });
                this.circuitBreaker.recordFailure();
            }
        }

        // Always run deterministic baseline (or as fallback)
        if (this.config.deterministicFallback || !gaResult) {
            try {
                const dualStart = Date.now();
                const startToken = Object.keys(marketsByToken)[0];
                const totalVolume = orderSize || BigNumber.from(10).pow(18);
                baselineDetails = await this.baseline.optimize(marketsByToken, startToken, totalVolume);
                const dualTime = Date.now() - dualStart;

                opportunities.push(...baselineDetails);

                logInfo("Baseline (deterministic) found opportunities", {
                    count: baselineDetails.length,
                    profit: baselineDetails[0]?.profit || BigNumber.from(0),
                    time: dualTime
                } as any);

                this.stats.avgDualTime =
                    (this.stats.avgDualTime * (this.stats.totalRuns - 1) + dualTime) /
                    this.stats.totalRuns;
                    
            } catch (error) {
                logError("Dual decomposition failed", { error: error as Error });
            }
        }

        // Deduplicate and post-process
        const uniqueOpportunities = await this.postProcess(opportunities);
        
        // Track winner
        if (uniqueOpportunities.length > 0 && gaResult && (dualResult || baselineDetails)) {
            const gaProfit = gaResult.bestChromosome.fitness.surplus;
            const dualProfit = baselineDetails?.[0]?.profit || BigNumber.from(0);
            
            if (gaProfit.gt(dualProfit)) {
                this.stats.gaWins++;
            } else {
                this.stats.dualWins++;
            }
        }

        // Sort by profit
        uniqueOpportunities.sort((a, b) => b.profit.sub(a.profit).toNumber());

        logInfo("Hybrid evaluation completed", {
            count: uniqueOpportunities.length,
            profit: uniqueOpportunities[0]?.profit || BigNumber.from(0),
            gaWinRate: this.stats.gaWins / Math.max(1, this.stats.gaWins + this.stats.dualWins)
        } as any);

        return uniqueOpportunities;
    }

    /**
     * Profile instance to determine if GA is beneficial
     */
    private profileInstance(
        marketsByToken: MarketsByToken,
        orderSize?: BigNumber
    ): InstanceProfile {
        const tokenCount = Object.keys(marketsByToken).length;
        const marketCount = Object.values(marketsByToken).flat().length;
        
        // Calculate fragmentation score
        const marketCounts = Object.values(marketsByToken).map(m => m.length);
        const avgMarketsPerToken = marketCounts.reduce((a, b) => a + b, 0) / marketCounts.length;
        const fragmentationScore = Math.min(100, avgMarketsPerToken * 20); // Higher = more fragmented
        
        // Estimate market depth (simplified)
        const marketDepth = BigNumber.from(10).pow(18).mul(marketCount * 10); // Rough estimate
        
        // Volatility proxy (would be better with historical data)
        const volatility = Math.random() * 100; // Placeholder
        
        // Determine if GA is recommended
        const recommendGA = this.shouldUseGA(
            orderSize || BigNumber.from(0),
            fragmentationScore,
            marketDepth,
            marketCount
        );
        
        return {
            orderSize: orderSize || BigNumber.from(0),
            fragmentationScore,
            marketDepth,
            volatility,
            tokenCount,
            marketCount,
            recommendGA
        };
    }

    /**
     * Adaptive algorithm selection policy
     */
    private shouldUseGA(
        orderSize: BigNumber,
        fragmentationScore: number,
        marketDepth: BigNumber,
        marketCount: number
    ): boolean {
        if (!this.config.adaptiveSelection) {
            return this.config.useGA;
        }

        // Decision criteria:
        // 1. Order size large enough
        if (orderSize.lt(this.config.minOrderSizeForGA)) {
            logDebug("Skipping GA: order too small", { orderSize: orderSize.toString() } as any);
            return false;
        }

        // 2. Fragmentation high (multiple paths available)
        if (this.config.preferGAForFragmented && fragmentationScore < 30) {
            logDebug("Skipping GA: low fragmentation", { fragmentationScore } as any);
            return false;
        }

        // 3. Enough markets for multi-hop
        if (marketCount < 5) {
            logDebug("Skipping GA: insufficient markets", { marketCount } as any);
            return false;
        }

        // 4. Circuit breaker not tripped
        if (this.circuitBreaker.isTripped()) {
            logDebug("Skipping GA: circuit breaker tripped");
            return false;
        }

        return true;
    }

    /**
     * Run GA optimization
     */
    private async runGA(
        marketsByToken: MarketsByToken,
        orderSize: BigNumber
    ): Promise<GAOptimizationResult> {
        // Pick a start token (usually WETH)
        const startToken = Object.keys(marketsByToken)[0];
        
        return await this.gaEngine.optimize(marketsByToken, startToken, orderSize);
    }

    /**
     * Post-process opportunities
     * Ensures executability, compliance, and deduplication
     */
    private async postProcess(
        opportunities: CrossedMarketDetails[]
    ): Promise<CrossedMarketDetails[]> {
        const processed: CrossedMarketDetails[] = [];
        const seen = new Set<string>();

        for (const opp of opportunities) {
            try {
                // Create unique key
                const markets = opp.marketPairs && opp.marketPairs.length > 0
                    ? opp.marketPairs.map(p => p.market.marketAddress).sort().join('-')
                    : `${opp.buyFromMarket.marketAddress}-${opp.sellToMarket.marketAddress}`;

                if (seen.has(markets)) {
                    continue;
                }

                // Validate executability
                if (!await this.validateExecutability(opp)) {
                    logDebug("Opportunity failed executability check", {
                        markets
                    } as any);
                    continue;
                }

                // Check gas profitability
                const gasCheck = await this.checkGasProfitability(opp);
                if (!gasCheck.profitable) {
                    logDebug("Opportunity not gas-profitable", {
                        profit: opp.profit,
                        gasCost: gasCheck.gasCost
                    } as any);
                    continue;
                }

                seen.add(markets);
                processed.push(opp);

            } catch (error) {
                logError("Post-processing error", {
                    error: error as Error
                });
            }
        }

        return processed;
    }

    /**
     * Validate executability
     */
    private async validateExecutability(
        opportunity: CrossedMarketDetails
    ): Promise<boolean> {
        try {
            // Check reserves are sufficient
            const buyReserve = await opportunity.buyFromMarket.getReservesByToken(
                opportunity.tokenAddress
            );
            const sellReserve = await opportunity.sellToMarket.getReservesByToken(
                opportunity.tokenAddress
            );

            if (!buyReserve || !sellReserve) {
                return false;
            }

            const buyBN = Array.isArray(buyReserve) ? buyReserve[0] : buyReserve;
            const sellBN = Array.isArray(sellReserve) ? sellReserve[0] : sellReserve;

            // Volume must be < reserves
            if (opportunity.volume.gte(buyBN) || opportunity.volume.gte(sellBN)) {
                return false;
            }

            // Price impact check
            const priceImpact = await opportunity.buyFromMarket.getPriceImpact(
                opportunity.tokenAddress,
                opportunity.volume
            );

            // Max 5% price impact
            if (priceImpact.gt(500)) {
                return false;
            }

            return true;

        } catch (error) {
            return false;
        }
    }

    /**
     * Check gas profitability
     */
    private async checkGasProfitability(
        opportunity: CrossedMarketDetails
    ): Promise<{ profitable: boolean; gasCost: BigNumber }> {
        try {
            // Estimate gas
            const numSwaps = opportunity.marketPairs?.length || 2;
            const gasPerSwap = BigNumber.from(150000); // Conservative
            const totalGas = gasPerSwap.mul(numSwaps);

            // Get current gas price
            const { maxFeePerGas } = await this.gasPriceManager.getOptimalGasFees(opportunity.profit);
            const gasCost = totalGas.mul(maxFeePerGas);

            // Check if profit > gas cost + minimum threshold
            const minProfit = gasCost.mul(2).add(this.thresholds.minProfitWei || BigNumber.from(0));
            const profitable = opportunity.profit.gte(minProfit);

            return { profitable, gasCost };

        } catch (error) {
            return { profitable: false, gasCost: BigNumber.from(0) };
        }
    }

    /**
     * Get performance statistics
     */
    getStats(): typeof this.stats {
        return { ...this.stats };
    }

    /**
     * Get GA engine
     */
    getGAEngine(): GeneticRouterEngine {
        return this.gaEngine;
    }

    /**
     * Get dual engine
     */
    getDualEngine(): DualDecompositionOptimizer {
        return this.dualEngine;
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig: Partial<HybridEngineConfig>): void {
        this.config = { ...this.config, ...newConfig };
        
        // Update GA time budget if changed
        if (newConfig.gaTimeBudgetMs) {
            this.gaEngine.updateConfig({ 
                timeBudgetMs: newConfig.gaTimeBudgetMs 
            });
        }
        
        logInfo("Hybrid GA engine configuration updated", {
            updated: Object.keys(newConfig).join(',')
        } as any);
    }

    /**
     * Get configuration
     */
    getConfig(): HybridEngineConfig {
        return { ...this.config };
    }

    /**
     * Reset state
     */
    reset(): void {
        this.gaEngine.reset();
        this.dualEngine.reset();
        
        this.stats = {
            gaWins: 0,
            dualWins: 0,
            totalRuns: 0,
            avgGATime: 0,
            avgDualTime: 0
        };
        
        logInfo("Hybrid GA engine reset");
    }
}
