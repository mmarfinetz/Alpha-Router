import { BigNumber } from "@ethersproject/bignumber";
import { Provider } from "@ethersproject/providers";
import { EthMarket, MarketType } from "../EthMarket";
import { MarketsByToken } from "../types";
import { logInfo, logError, logDebug, logWarn } from "../utils/logger";

/**
 * Market statistics for volatility analysis
 */
interface MarketStatistics {
    marketAddress: string;
    tokenPair: [string, string];
    volatility24h: BigNumber; // In basis points
    volume24h: BigNumber;
    priceHistory: Array<{ timestamp: number; price: BigNumber }>;
    lastUpdate: number;
    trend: 'bullish' | 'bearish' | 'neutral';
    momentum: BigNumber; // Rate of price change
    meanReversion: number; // 0-100 score indicating mean reversion likelihood
}

/**
 * Opportunity prediction based on statistical analysis
 */
export interface StatisticalOpportunity {
    market: MarketType;
    relatedMarkets: MarketType[];
    expectedProfitBps: number; // Expected profit in basis points
    confidence: number; // 0-100 confidence score
    timeHorizon: number; // Expected time to opportunity in seconds
    reason: string;
    volatility: BigNumber;
    shouldPrePosition: boolean;
}

/**
 * Configuration for statistical arbitrage
 */
export interface StatisticalArbitrageConfig {
    minVolatility: BigNumber; // Minimum volatility to consider (in basis points)
    maxVolatility: BigNumber; // Maximum volatility (too high = too risky)
    minConfidence: number; // Minimum confidence score (0-100)
    lookbackPeriod: number; // How far back to look for price history (in seconds)
    updateFrequency: number; // How often to update statistics (in seconds)
    enablePrePositioning: boolean; // Whether to pre-position capital
    prePositionThreshold: number; // Confidence threshold for pre-positioning
    meanReversionThreshold: number; // Threshold for mean reversion trades
}

/**
 * Statistical Arbitrage Engine
 * Monitors pool volatility, predicts LVR opportunities, and suggests capital pre-positioning
 */
export class StatisticalArbitrageEngine {
    private config: StatisticalArbitrageConfig;
    private provider: Provider;
    private marketStats: Map<string, MarketStatistics> = new Map();
    private lastUpdate: number = 0;
    private isUpdating: boolean = false;

    constructor(provider: Provider, config?: Partial<StatisticalArbitrageConfig>) {
        this.provider = provider;
        this.config = {
            minVolatility: BigNumber.from(50), // 0.5%
            maxVolatility: BigNumber.from(5000), // 50%
            minConfidence: 60,
            lookbackPeriod: 86400, // 24 hours
            updateFrequency: 60, // 1 minute
            enablePrePositioning: true,
            prePositionThreshold: 75,
            meanReversionThreshold: 70,
            ...config
        };

        logInfo("Statistical Arbitrage Engine initialized", {
            minVolatility: this.config.minVolatility.toString(),
            maxVolatility: this.config.maxVolatility.toString(),
            minConfidence: this.config.minConfidence
        });
    }

    /**
     * Update market statistics for all markets
     */
    async updateMarketStatistics(marketsByToken: MarketsByToken): Promise<void> {
        const now = Date.now();
        
        // Throttle updates
        if (this.isUpdating || (now - this.lastUpdate) < (this.config.updateFrequency * 1000)) {
            return;
        }

        this.isUpdating = true;
        
        try {
            const updatePromises: Promise<void>[] = [];

            for (const [tokenAddress, markets] of Object.entries(marketsByToken)) {
                for (const market of markets) {
                    updatePromises.push(this.updateSingleMarketStatistics(market));
                }
            }

            await Promise.all(updatePromises);
            this.lastUpdate = now;

            logDebug("Updated market statistics", {
                marketCount: this.marketStats.size
            });

        } catch (error) {
            logError("Failed to update market statistics", {
                error: error as Error
            });
        } finally {
            this.isUpdating = false;
        }
    }

    /**
     * Update statistics for a single market
     */
    private async updateSingleMarketStatistics(market: MarketType): Promise<void> {
        try {
            const marketAddress = market.marketAddress;
            const existingStats = this.marketStats.get(marketAddress);

            // Get current price and reserves
            const reserves = await market.getReservesByToken();
            if (!Array.isArray(reserves) || reserves.length < 2) {
                return;
            }

            const currentPrice = reserves[1].mul(BigNumber.from(10).pow(18)).div(reserves[0]);
            const currentTime = Date.now();

            // Initialize or update price history
            let priceHistory: Array<{ timestamp: number; price: BigNumber }> = [];
            if (existingStats) {
                priceHistory = [...existingStats.priceHistory];
            }

            priceHistory.push({ timestamp: currentTime, price: currentPrice });

            // Keep only data within lookback period
            const cutoffTime = currentTime - (this.config.lookbackPeriod * 1000);
            priceHistory = priceHistory.filter(p => p.timestamp >= cutoffTime);

            // Calculate volatility
            const volatility = this.calculateVolatility(priceHistory);

            // Calculate volume (use liquidity as proxy if volume not available)
            const volume24h = await market.getLiquidity();

            // Determine trend and momentum
            const { trend, momentum } = this.analyzeTrend(priceHistory);

            // Calculate mean reversion score
            const meanReversion = this.calculateMeanReversionScore(priceHistory);

            const stats: MarketStatistics = {
                marketAddress,
                tokenPair: [market.tokens[0], market.tokens[1]],
                volatility24h: volatility,
                volume24h,
                priceHistory,
                lastUpdate: currentTime,
                trend,
                momentum,
                meanReversion
            };

            this.marketStats.set(marketAddress, stats);

        } catch (error) {
            logError("Failed to update single market statistics", {
                market: market.marketAddress,
                error: error as Error
            });
        }
    }

    /**
     * Calculate price volatility from historical data
     */
    private calculateVolatility(priceHistory: Array<{ timestamp: number; price: BigNumber }>): BigNumber {
        if (priceHistory.length < 2) {
            return BigNumber.from(500); // Default 5%
        }

        // Calculate returns
        const returns: BigNumber[] = [];
        for (let i = 1; i < priceHistory.length; i++) {
            const prevPrice = priceHistory[i - 1].price;
            const currentPrice = priceHistory[i].price;
            
            if (prevPrice.isZero()) continue;
            
            // Calculate return in basis points
            const returnBps = currentPrice.sub(prevPrice).mul(10000).div(prevPrice).abs();
            returns.push(returnBps);
        }

        if (returns.length === 0) {
            return BigNumber.from(500);
        }

        // Calculate mean
        const sum = returns.reduce((acc, r) => acc.add(r), BigNumber.from(0));
        const mean = sum.div(returns.length);

        // Calculate variance
        const squaredDiffs = returns.map(r => {
            const diff = r.sub(mean);
            return diff.mul(diff).div(10000); // Normalize
        });

        const variance = squaredDiffs.reduce((acc, sd) => acc.add(sd), BigNumber.from(0)).div(returns.length);
        
        // Standard deviation (volatility)
        const volatility = this.sqrt(variance);

        return volatility;
    }

    /**
     * Analyze price trend and momentum
     */
    private analyzeTrend(priceHistory: Array<{ timestamp: number; price: BigNumber }>): { 
        trend: 'bullish' | 'bearish' | 'neutral'; 
        momentum: BigNumber 
    } {
        if (priceHistory.length < 3) {
            return { trend: 'neutral', momentum: BigNumber.from(0) };
        }

        // Use recent prices
        const recentCount = Math.min(10, priceHistory.length);
        const recentPrices = priceHistory.slice(-recentCount);

        // Calculate moving average
        const maShort = this.calculateMovingAverage(recentPrices.slice(-3));
        const maLong = this.calculateMovingAverage(recentPrices);

        // Determine trend
        let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
        if (maShort.gt(maLong.mul(1010).div(1000))) { // 1% threshold
            trend = 'bullish';
        } else if (maShort.lt(maLong.mul(990).div(1000))) {
            trend = 'bearish';
        }

        // Calculate momentum (rate of change)
        const firstPrice = recentPrices[0].price;
        const lastPrice = recentPrices[recentPrices.length - 1].price;
        
        if (firstPrice.isZero()) {
            return { trend, momentum: BigNumber.from(0) };
        }

        const momentum = lastPrice.sub(firstPrice).mul(10000).div(firstPrice);

        return { trend, momentum };
    }

    /**
     * Calculate mean reversion score (0-100)
     * Higher score = more likely to revert to mean
     */
    private calculateMeanReversionScore(priceHistory: Array<{ timestamp: number; price: BigNumber }>): number {
        if (priceHistory.length < 10) {
            return 50; // Neutral score
        }

        const prices = priceHistory.map(p => p.price);
        const mean = this.calculateMovingAverage(priceHistory);
        const currentPrice = prices[prices.length - 1];

        // Calculate deviation from mean
        const deviation = currentPrice.sub(mean).abs();
        const percentDeviation = deviation.mul(100).div(mean).toNumber();

        // Higher deviation = higher mean reversion likelihood
        // But cap at 100
        const score = Math.min(100, percentDeviation * 5);

        return score;
    }

    /**
     * Calculate moving average
     */
    private calculateMovingAverage(priceHistory: Array<{ timestamp: number; price: BigNumber }>): BigNumber {
        if (priceHistory.length === 0) {
            return BigNumber.from(0);
        }

        const sum = priceHistory.reduce((acc, p) => acc.add(p.price), BigNumber.from(0));
        return sum.div(priceHistory.length);
    }

    /**
     * Predict upcoming arbitrage opportunities based on statistical analysis
     */
    async predictOpportunities(marketsByToken: MarketsByToken): Promise<StatisticalOpportunity[]> {
        await this.updateMarketStatistics(marketsByToken);

        const opportunities: StatisticalOpportunity[] = [];

        for (const [tokenAddress, markets] of Object.entries(marketsByToken)) {
            // Look for markets with high volatility (potential for price divergence)
            const volatileMarkets = markets.filter(market => {
                const stats = this.marketStats.get(market.marketAddress);
                if (!stats) return false;

                return stats.volatility24h.gte(this.config.minVolatility) &&
                       stats.volatility24h.lte(this.config.maxVolatility);
            });

            // Analyze each volatile market
            for (const market of volatileMarkets) {
                const stats = this.marketStats.get(market.marketAddress);
                if (!stats) continue;

                // Find related markets for arbitrage
                const relatedMarkets = markets.filter(m => m.marketAddress !== market.marketAddress);
                if (relatedMarkets.length === 0) continue;

                // Predict opportunity based on various factors
                const prediction = this.predictSingleOpportunity(market, relatedMarkets, stats);
                
                if (prediction && prediction.confidence >= this.config.minConfidence) {
                    opportunities.push(prediction);
                }
            }
        }

        // Sort by expected profit and confidence
        opportunities.sort((a, b) => {
            const scoreA = a.expectedProfitBps * a.confidence;
            const scoreB = b.expectedProfitBps * b.confidence;
            return scoreB - scoreA;
        });

        logInfo("Predicted statistical arbitrage opportunities", {
            count: opportunities.length,
            topConfidence: opportunities[0]?.confidence || 0
        });

        return opportunities;
    }

    /**
     * Predict opportunity for a single market
     */
    private predictSingleOpportunity(
        market: MarketType,
        relatedMarkets: MarketType[],
        stats: MarketStatistics
    ): StatisticalOpportunity | null {
        let confidence = 50; // Base confidence
        let expectedProfitBps = 0;
        let reason = "General volatility-based prediction";
        let timeHorizon = 300; // 5 minutes default

        // Factor 1: High volatility increases probability of price divergence
        if (stats.volatility24h.gt(BigNumber.from(1000))) { // > 10%
            confidence += 15;
            expectedProfitBps += 50; // 0.5%
            reason = "High volatility detected";
            timeHorizon = 180; // 3 minutes
        }

        // Factor 2: Strong trend suggests momentum continuation
        if (stats.momentum.abs().gt(BigNumber.from(500))) { // > 5% momentum
            confidence += 10;
            expectedProfitBps += 30;
            if (stats.trend === 'bullish') {
                reason += ", bullish momentum";
            } else if (stats.trend === 'bearish') {
                reason += ", bearish momentum";
            }
        }

        // Factor 3: Mean reversion opportunity
        if (stats.meanReversion >= this.config.meanReversionThreshold) {
            confidence += 20;
            expectedProfitBps += 40;
            reason += ", mean reversion opportunity";
            timeHorizon = 600; // 10 minutes for mean reversion
        }

        // Factor 4: Volume (liquidity) check
        if (stats.volume24h.lt(BigNumber.from(10).pow(18))) { // Low liquidity
            confidence -= 10;
            expectedProfitBps -= 10;
        }

        // Factor 5: Recent price history consistency
        if (stats.priceHistory.length >= 10) {
            confidence += 5;
        }

        // Determine if we should pre-position
        const shouldPrePosition = this.config.enablePrePositioning && 
                                  confidence >= this.config.prePositionThreshold;

        // Don't return if confidence is too low
        if (confidence < this.config.minConfidence) {
            return null;
        }

        return {
            market,
            relatedMarkets,
            expectedProfitBps,
            confidence,
            timeHorizon,
            reason,
            volatility: stats.volatility24h,
            shouldPrePosition
        };
    }

    /**
     * Get current statistics for a market
     */
    getMarketStatistics(marketAddress: string): MarketStatistics | undefined {
        return this.marketStats.get(marketAddress);
    }

    /**
     * Get all markets sorted by volatility
     */
    getMarketsByVolatility(): MarketStatistics[] {
        return Array.from(this.marketStats.values()).sort((a, b) => 
            b.volatility24h.sub(a.volatility24h).toNumber()
        );
    }

    /**
     * Get markets with mean reversion opportunities
     */
    getMeanReversionOpportunities(): MarketStatistics[] {
        return Array.from(this.marketStats.values())
            .filter(stats => stats.meanReversion >= this.config.meanReversionThreshold)
            .sort((a, b) => b.meanReversion - a.meanReversion);
    }

    /**
     * Calculate correlation between two markets
     * Used to identify pairs for statistical arbitrage
     */
    calculateCorrelation(market1Address: string, market2Address: string): number {
        const stats1 = this.marketStats.get(market1Address);
        const stats2 = this.marketStats.get(market2Address);

        if (!stats1 || !stats2) {
            return 0;
        }

        // Find overlapping time periods
        const prices1 = stats1.priceHistory;
        const prices2 = stats2.priceHistory;

        if (prices1.length < 5 || prices2.length < 5) {
            return 0;
        }

        // Calculate correlation coefficient (simplified)
        const returns1 = this.calculateReturns(prices1);
        const returns2 = this.calculateReturns(prices2);

        const minLength = Math.min(returns1.length, returns2.length);
        if (minLength < 3) return 0;

        // Use most recent overlapping returns
        const r1 = returns1.slice(-minLength);
        const r2 = returns2.slice(-minLength);

        // Calculate means
        const mean1 = r1.reduce((sum, r) => sum + r, 0) / minLength;
        const mean2 = r2.reduce((sum, r) => sum + r, 0) / minLength;

        // Calculate correlation
        let numerator = 0;
        let sumSq1 = 0;
        let sumSq2 = 0;

        for (let i = 0; i < minLength; i++) {
            const diff1 = r1[i] - mean1;
            const diff2 = r2[i] - mean2;
            numerator += diff1 * diff2;
            sumSq1 += diff1 * diff1;
            sumSq2 += diff2 * diff2;
        }

        const denominator = Math.sqrt(sumSq1 * sumSq2);
        if (denominator === 0) return 0;

        return numerator / denominator;
    }

    /**
     * Calculate returns from price history
     */
    private calculateReturns(priceHistory: Array<{ timestamp: number; price: BigNumber }>): number[] {
        const returns: number[] = [];
        
        for (let i = 1; i < priceHistory.length; i++) {
            const prevPrice = priceHistory[i - 1].price;
            const currentPrice = priceHistory[i].price;
            
            if (prevPrice.isZero()) continue;
            
            const returnVal = currentPrice.sub(prevPrice).mul(10000).div(prevPrice).toNumber() / 10000;
            returns.push(returnVal);
        }

        return returns;
    }

    /**
     * Square root helper
     */
    private sqrt(value: BigNumber): BigNumber {
        if (value.isZero()) return value;
        
        let z = value.add(BigNumber.from(1)).div(2);
        let y = value;
        
        for (let i = 0; i < 50; i++) {
            if (z.gte(y)) break;
            y = z;
            z = value.div(z).add(z).div(2);
        }
        
        return y;
    }

    /**
     * Reset all statistics (useful for testing or restart)
     */
    reset(): void {
        this.marketStats.clear();
        this.lastUpdate = 0;
        logInfo("Statistical engine reset");
    }

    /**
     * Get configuration
     */
    getConfig(): StatisticalArbitrageConfig {
        return { ...this.config };
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig: Partial<StatisticalArbitrageConfig>): void {
        this.config = { ...this.config, ...newConfig };
        logInfo("Statistical engine configuration updated", newConfig);
    }
}

