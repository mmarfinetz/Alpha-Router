import { BigNumber } from "@ethersproject/bignumber";
import { Wallet } from "@ethersproject/wallet";
import { Provider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { MarketsByToken, CrossedMarketDetails } from "../types";
import { EthMarket, MarketType } from "../EthMarket";
import { logInfo, logError, logDebug, logWarn } from "../utils/logger";
import { StatisticalArbitrageEngine, StatisticalOpportunity } from "./StatisticalArbitrageEngine";
import { CapitalPositioningEngine, MarketPosition } from "./CapitalPositioning";
import { DualDecompositionOptimizer, ArbitragePath } from "./DualDecompositionOptimizer";
import { MarketThresholds } from "../config/thresholds";
import { CircuitBreaker } from "../utils/CircuitBreaker";
import { GasPriceManager } from "../utils/GasPriceManager";

/**
 * Performance metrics for the enhanced engine
 */
export interface EnginePerformanceMetrics {
    totalArbitragesExecuted: number;
    totalProfit: BigNumber;
    successRate: number;
    avgExecutionTime: number;
    multiHopOpportunities: number;
    statisticalPredictions: number;
    prePositionedCapital: BigNumber;
    sharpeRatio: number;
}

/**
 * Enhanced Arbitrage Engine Configuration
 */
export interface EnhancedEngineConfig {
    enableStatisticalArbitrage: boolean;
    enableCapitalPositioning: boolean;
    enableMultiHopOptimization: boolean;
    enableUniswapV3: boolean;
    enableBalancer: boolean;
    enableCurve: boolean;
    enableDODO: boolean;
    enableKyberDMM: boolean;
    statisticalUpdateFrequency: number; // seconds
    positionRebalanceFrequency: number; // seconds
    optimizationFrequency: number; // seconds
}

/**
 * Enhanced Arbitrage Engine
 * Integrates all advanced features: statistical arbitrage, capital positioning, 
 * multi-hop optimization, and support for multiple AMM types
 */
export class EnhancedArbitrageEngine {
    private wallet: Wallet;
    private provider: Provider;
    private bundleExecutorContract: Contract;
    private thresholds: MarketThresholds;
    private config: EnhancedEngineConfig;
    
    // Engines
    private statisticalEngine: StatisticalArbitrageEngine;
    private capitalEngine: CapitalPositioningEngine;
    private optimizationEngine: DualDecompositionOptimizer;
    
    // Utilities
    private circuitBreaker: CircuitBreaker;
    private gasPriceManager: GasPriceManager;
    
    // Performance tracking
    private metrics: EnginePerformanceMetrics = {
        totalArbitragesExecuted: 0,
        totalProfit: BigNumber.from(0),
        successRate: 0,
        avgExecutionTime: 0,
        multiHopOpportunities: 0,
        statisticalPredictions: 0,
        prePositionedCapital: BigNumber.from(0),
        sharpeRatio: 0
    };
    
    // State
    private lastStatisticalUpdate: number = 0;
    private lastPositionRebalance: number = 0;
    private lastOptimization: number = 0;
    private isRunning: boolean = false;

    constructor(
        wallet: Wallet,
        provider: Provider,
        bundleExecutorContract: Contract,
        thresholds: MarketThresholds,
        circuitBreaker: CircuitBreaker,
        gasPriceManager: GasPriceManager,
        config?: Partial<EnhancedEngineConfig>
    ) {
        this.wallet = wallet;
        this.provider = provider;
        this.bundleExecutorContract = bundleExecutorContract;
        this.thresholds = thresholds;
        this.circuitBreaker = circuitBreaker;
        this.gasPriceManager = gasPriceManager;
        
        this.config = {
            enableStatisticalArbitrage: true,
            enableCapitalPositioning: true,
            enableMultiHopOptimization: true,
            enableUniswapV3: true,
            enableBalancer: true,
            enableCurve: true,
            enableDODO: true,
            enableKyberDMM: true,
            statisticalUpdateFrequency: 60,
            positionRebalanceFrequency: 300,
            optimizationFrequency: 120,
            ...config
        };

        // Initialize engines
        this.statisticalEngine = new StatisticalArbitrageEngine(provider, {
            minVolatility: BigNumber.from(50),
            maxVolatility: BigNumber.from(5000),
            minConfidence: 60,
            enablePrePositioning: this.config.enableCapitalPositioning
        });

        this.capitalEngine = new CapitalPositioningEngine(wallet, provider, {
            maxPositionSize: BigNumber.from(10).pow(18).mul(10), // 10 ETH
            maxTotalCapital: BigNumber.from(10).pow(18).mul(100), // 100 ETH
            maxPositions: 5,
            minConfidenceForPosition: 75
        });

        this.optimizationEngine = new DualDecompositionOptimizer({
            maxIterations: 100,
            maxPathLength: 4,
            minProfitThreshold: thresholds.minProfitWei || BigNumber.from(10).pow(16)
        });

        logInfo("Enhanced Arbitrage Engine initialized", {
            statisticalEnabled: this.config.enableStatisticalArbitrage,
            positioningEnabled: this.config.enableCapitalPositioning,
            multiHopEnabled: this.config.enableMultiHopOptimization,
            supportedProtocols: this.getSupportedProtocols()
        });
    }

    /**
     * Main evaluation method - orchestrates all engines
     */
    async evaluateMarkets(marketsByToken: MarketsByToken): Promise<CrossedMarketDetails[]> {
        const startTime = Date.now();
        logInfo("Starting comprehensive market evaluation");

        try {
            // Update all market reserves
            await this.updateAllReserves(marketsByToken);

            const opportunities: CrossedMarketDetails[] = [];

            // 1. Statistical arbitrage - predict opportunities
            if (this.config.enableStatisticalArbitrage) {
                const statisticalOpps = await this.runStatisticalAnalysis(marketsByToken);
                logInfo(`Statistical analysis found ${statisticalOpps.length} predictions`);
                this.metrics.statisticalPredictions = statisticalOpps.length;

                // Handle capital pre-positioning
                if (this.config.enableCapitalPositioning && statisticalOpps.length > 0) {
                    await this.handleCapitalPositioning(statisticalOpps);
                }
            }

            // 2. Multi-hop optimization - find complex arbitrage paths
            if (this.config.enableMultiHopOptimization) {
                const multiHopOpps = await this.runMultiHopOptimization(marketsByToken);
                opportunities.push(...multiHopOpps);
                logInfo(`Multi-hop optimization found ${multiHopOpps.length} opportunities`);
                this.metrics.multiHopOpportunities = multiHopOpps.length;
            }

            // 3. Direct pairwise arbitrage (fallback/supplement)
            const pairwiseOpps = await this.findPairwiseArbitrage(marketsByToken);
            opportunities.push(...pairwiseOpps);
            logInfo(`Pairwise arbitrage found ${pairwiseOpps.length} opportunities`);

            // Deduplicate and sort by profit
            const uniqueOpportunities = this.deduplicateOpportunities(opportunities);
            uniqueOpportunities.sort((a, b) => b.profit.sub(a.profit).toNumber());

            const executionTime = Date.now() - startTime;
            this.metrics.avgExecutionTime = 
                (this.metrics.avgExecutionTime * this.metrics.totalArbitragesExecuted + executionTime) / 
                (this.metrics.totalArbitragesExecuted + 1);

            logInfo("Market evaluation completed", {
                totalOpportunities: uniqueOpportunities.length,
                executionTime,
                topProfit: uniqueOpportunities[0]?.profit.toString() || "0"
            });

            return uniqueOpportunities;

        } catch (error) {
            logError("Error in market evaluation", {
                error: error as Error
            });
            return [];
        }
    }

    /**
     * Update reserves for all markets
     */
    private async updateAllReserves(marketsByToken: MarketsByToken): Promise<void> {
        const updatePromises: Promise<void>[] = [];

        for (const markets of Object.values(marketsByToken)) {
            for (const market of markets) {
                updatePromises.push(
                    market.updateReserves().catch(err => {
                        logWarn("Failed to update reserves", {
                            market: market.marketAddress,
                            error: err
                        });
                    })
                );
            }
        }

        await Promise.all(updatePromises);
    }

    /**
     * Run statistical analysis
     */
    private async runStatisticalAnalysis(
        marketsByToken: MarketsByToken
    ): Promise<StatisticalOpportunity[]> {
        const now = Date.now();
        
        if ((now - this.lastStatisticalUpdate) < (this.config.statisticalUpdateFrequency * 1000)) {
            return [];
        }

        this.lastStatisticalUpdate = now;

        try {
            await this.statisticalEngine.updateMarketStatistics(marketsByToken);
            const predictions = await this.statisticalEngine.predictOpportunities(marketsByToken);
            return predictions;
        } catch (error) {
            logError("Statistical analysis failed", {
                error: error as Error
            });
            return [];
        }
    }

    /**
     * Handle capital pre-positioning
     */
    private async handleCapitalPositioning(
        opportunities: StatisticalOpportunity[]
    ): Promise<void> {
        const now = Date.now();
        
        // Rebalance existing positions
        if ((now - this.lastPositionRebalance) >= (this.config.positionRebalanceFrequency * 1000)) {
            await this.capitalEngine.rebalancePositions();
            this.lastPositionRebalance = now;
        }

        // Create new positions
        const newPositions = await this.capitalEngine.evaluatePositioningOpportunities(opportunities);
        
        if (newPositions.length > 0) {
            logInfo("Created new capital positions", {
                count: newPositions.length,
                totalCapital: newPositions.reduce((sum, p) => sum.add(p.amount), BigNumber.from(0)).toString()
            });
        }

        // Update metrics
        const allocation = this.capitalEngine.getCapitalAllocation();
        this.metrics.prePositionedCapital = allocation.deployed;
    }

    /**
     * Run multi-hop optimization
     */
    private async runMultiHopOptimization(
        marketsByToken: MarketsByToken
    ): Promise<CrossedMarketDetails[]> {
        const now = Date.now();
        
        if ((now - this.lastOptimization) < (this.config.optimizationFrequency * 1000)) {
            return [];
        }

        this.lastOptimization = now;

        try {
            const result = await this.optimizationEngine.optimize(marketsByToken);
            
            logInfo("Multi-hop optimization completed", {
                pathsFound: result.optimalPaths.length,
                totalProfit: result.totalExpectedProfit.toString(),
                computationTime: result.computationTime
            });

            return this.optimizationEngine.convertPathsToCrossedMarkets(result.optimalPaths);

        } catch (error) {
            logError("Multi-hop optimization failed", {
                error: error as Error
            });
            return [];
        }
    }

    /**
     * Find pairwise arbitrage opportunities (simple 2-hop)
     */
    private async findPairwiseArbitrage(
        marketsByToken: MarketsByToken
    ): Promise<CrossedMarketDetails[]> {
        const opportunities: CrossedMarketDetails[] = [];

        for (const [tokenAddress, markets] of Object.entries(marketsByToken)) {
            // Compare all pairs of markets
            for (let i = 0; i < markets.length; i++) {
                for (let j = i + 1; j < markets.length; j++) {
                    try {
                        const opp = await this.evaluatePairwiseOpportunity(
                            tokenAddress,
                            markets[i],
                            markets[j]
                        );
                        
                        if (opp && opp.profit.gte(this.thresholds.minProfitWei || BigNumber.from(0))) {
                            opportunities.push(opp);
                        }
                    } catch (error) {
                        // Continue with other pairs
                    }
                }
            }
        }

        return opportunities;
    }

    /**
     * Evaluate a single pairwise opportunity
     */
    private async evaluatePairwiseOpportunity(
        tokenAddress: string,
        market1: MarketType,
        market2: MarketType
    ): Promise<CrossedMarketDetails | null> {
        try {
            // Simple price comparison
            const testAmount = BigNumber.from(10).pow(18); // 1 unit
            
            // Get prices on both markets
            const [reserve1, reserve2] = await Promise.all([
                market1.getReservesByToken(tokenAddress),
                market2.getReservesByToken(tokenAddress)
            ]);

            if (!reserve1 || !reserve2) return null;

            const reserve1Bn = Array.isArray(reserve1) ? reserve1[0] : reserve1;
            const reserve2Bn = Array.isArray(reserve2) ? reserve2[0] : reserve2;

            if (reserve1Bn.isZero() || reserve2Bn.isZero()) return null;

            // Simple profit estimation
            const price1 = await market1.getTokensOut(tokenAddress, market1.tokens[1], testAmount);
            const price2 = await market2.getTokensOut(tokenAddress, market2.tokens[1], testAmount);

            let buyMarket: MarketType, sellMarket: MarketType, profit: BigNumber;

            if (price1.gt(price2)) {
                buyMarket = market2;
                sellMarket = market1;
                profit = price1.sub(price2);
            } else if (price2.gt(price1)) {
                buyMarket = market1;
                sellMarket = market2;
                profit = price2.sub(price1);
            } else {
                return null;
            }

            if (profit.lte(0)) return null;

            // Calculate optimal volume (simplified)
            const minLiquidity = reserve1Bn.lt(reserve2Bn) ? reserve1Bn : reserve2Bn;
            const volume = minLiquidity.div(100); // Use 1% of liquidity

            return {
                profit,
                volume,
                tokenAddress,
                buyFromMarket: buyMarket as any,
                sellToMarket: sellMarket as any,
                marketPairs: []
            };

        } catch (error) {
            return null;
        }
    }

    /**
     * Deduplicate opportunities (same markets involved)
     */
    private deduplicateOpportunities(opportunities: CrossedMarketDetails[]): CrossedMarketDetails[] {
        const seen = new Set<string>();
        const unique: CrossedMarketDetails[] = [];

        for (const opp of opportunities) {
            // Create unique key from involved markets
            const markets = opp.marketPairs && opp.marketPairs.length > 0
                ? opp.marketPairs.map(p => p.market.marketAddress).sort().join('-')
                : `${opp.buyFromMarket.marketAddress}-${opp.sellToMarket.marketAddress}`;

            if (!seen.has(markets)) {
                seen.add(markets);
                unique.push(opp);
            }
        }

        return unique;
    }

    /**
     * Get list of supported protocols
     */
    private getSupportedProtocols(): string[] {
        const protocols = ["UniswapV2", "Sushiswap"];
        
        if (this.config.enableUniswapV3) protocols.push("UniswapV3");
        if (this.config.enableBalancer) protocols.push("BalancerV2");
        if (this.config.enableCurve) protocols.push("Curve");
        if (this.config.enableDODO) protocols.push("DODOV2");
        if (this.config.enableKyberDMM) protocols.push("KyberDMM");
        
        return protocols;
    }

    /**
     * Get current performance metrics
     */
    getPerformanceMetrics(): EnginePerformanceMetrics {
        // Update with capital positioning stats
        const capitalPerformance = this.capitalEngine.getStrategyPerformance();
        
        return {
            ...this.metrics,
            sharpeRatio: capitalPerformance.sharpeRatio
        };
    }

    /**
     * Get statistical engine instance
     */
    getStatisticalEngine(): StatisticalArbitrageEngine {
        return this.statisticalEngine;
    }

    /**
     * Get capital positioning engine instance
     */
    getCapitalEngine(): CapitalPositioningEngine {
        return this.capitalEngine;
    }

    /**
     * Get optimization engine instance
     */
    getOptimizationEngine(): DualDecompositionOptimizer {
        return this.optimizationEngine;
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig: Partial<EnhancedEngineConfig>): void {
        this.config = { ...this.config, ...newConfig };
        logInfo("Enhanced engine configuration updated", newConfig);
    }

    /**
     * Get configuration
     */
    getConfig(): EnhancedEngineConfig {
        return { ...this.config };
    }

    /**
     * Record successful arbitrage execution
     */
    recordExecution(profit: BigNumber, success: boolean): void {
        this.metrics.totalArbitragesExecuted++;
        
        if (success) {
            this.metrics.totalProfit = this.metrics.totalProfit.add(profit);
        }
        
        this.metrics.successRate = 
            (this.metrics.successRate * (this.metrics.totalArbitragesExecuted - 1) + (success ? 100 : 0)) / 
            this.metrics.totalArbitragesExecuted;
    }

    /**
     * Start engine (for background tasks)
     */
    start(): void {
        this.isRunning = true;
        logInfo("Enhanced Arbitrage Engine started");
    }

    /**
     * Stop engine
     */
    stop(): void {
        this.isRunning = false;
        logInfo("Enhanced Arbitrage Engine stopped");
    }

    /**
     * Reset all engines
     */
    reset(): void {
        this.statisticalEngine.reset();
        this.capitalEngine.reset();
        this.optimizationEngine.reset();
        
        this.metrics = {
            totalArbitragesExecuted: 0,
            totalProfit: BigNumber.from(0),
            successRate: 0,
            avgExecutionTime: 0,
            multiHopOpportunities: 0,
            statisticalPredictions: 0,
            prePositionedCapital: BigNumber.from(0),
            sharpeRatio: 0
        };
        
        logInfo("Enhanced engine reset");
    }
}

