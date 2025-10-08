import { BigNumber } from "@ethersproject/bignumber";
import { providers } from "ethers";
import { formatUnits, formatEther } from "@ethersproject/units";
import logger from '../utils/logger';
import { MarketsByToken } from '../types';
import { EthMarket } from '../EthMarket';
import { AnalyticalArbitrageEngine, ArbitrageOpportunity, AnalyticalEngineConfig } from '../engines/AnalyticalArbitrageEngine';
import { MARKET_FILTERS, MarketFilters, MarketFilterValidator } from '../config/marketFilters';
import { DEX_INFO } from '../addresses';

export interface MarketPrice {
    marketAddress: string;
    market: EthMarket;
    tokenAddress: string;
    price: BigNumber; // Token price in Wei (how much token1 per token0)
    liquidity: BigNumber; // Total liquidity in Wei
    volume24h?: BigNumber; // 24h volume if available
    lastUpdated: number; // Timestamp
}

export interface PriceSpread {
    tokenAddress: string;
    lowestPriceMarket: MarketPrice;
    highestPriceMarket: MarketPrice;
    spreadPercentage: number; // Basis points (100 = 1%)
    potentialProfit: BigNumber;
    optimalTradeSize: BigNumber;
}

export interface ScannerConfig {
    minSpreadBasisPoints: number; // Minimum spread to consider (e.g., 50 = 0.5%)
    maxLatencyMs: number; // Maximum acceptable data age
    batchSize: number; // Number of markets to process in parallel
    minLiquidityWei: BigNumber; // Minimum liquidity requirement
    maxGasPriceGwei: BigNumber; // Maximum gas price for profitability
    marketFilters: MarketFilters; // Market filtering configuration
    enableDetailedLogging: boolean; // Enable detailed opportunity logging
    enableTriangularArbitrage: boolean; // Enable triangular arbitrage detection
}

export class CrossDEXScanner {
    private readonly provider: providers.Provider;
    private readonly config: ScannerConfig;
    private readonly analyticalEngine: AnalyticalArbitrageEngine;
    private priceCache: Map<string, MarketPrice> = new Map();
    private lastScanTime: number = 0;
    private cacheHits: number = 0;
    private cacheMisses: number = 0;
    private scanStats = {
        totalScans: 0,
        opportunitiesFound: 0,
        averageScanTimeMs: 0,
        lastErrorCount: 0,
        totalSpreadsFound: 0,
        averageSpreadBasisPoints: 0,
        totalMarketsScanned: 0,
        filteredByLiquidity: 0,
        filteredBySpread: 0,
        filteredByGas: 0,
        dexStats: new Map<string, { opportunities: number, totalMarkets: number }>()
    };

    constructor(
        provider: providers.Provider,
        config: ScannerConfig,
        analyticalEngineConfig: AnalyticalEngineConfig
    ) {
        this.provider = provider;
        this.config = config;
        this.analyticalEngine = new AnalyticalArbitrageEngine(analyticalEngineConfig);
    }

    /**
     * Scan all markets for cross-DEX arbitrage opportunities
     */
    public async scanForOpportunities(marketsByToken: MarketsByToken): Promise<ArbitrageOpportunity[]> {
        const startTime = Date.now();
        this.scanStats.totalScans++;

        try {
            const totalMarkets = Object.values(marketsByToken).flat().length;
            this.scanStats.totalMarketsScanned = totalMarkets;

            logger.info('Starting cross-DEX scan with aggressive thresholds...', {
                totalTokens: Object.keys(marketsByToken).length,
                totalMarkets,
                minSpreadBps: this.config.minSpreadBasisPoints,
                minProfitETH: formatEther(this.config.marketFilters.MIN_PROFIT_ETH),
                maxGasGwei: this.config.maxGasPriceGwei.toString()
            });

            // Step 1: Update prices for all markets with enhanced filtering
            const allPrices = await this.updateAllMarketPricesWithFiltering(marketsByToken);
            
            // Step 2: Find profitable spreads with lower thresholds
            const spreads = await this.findProfitableSpreadsEnhanced(allPrices);
            
            // Step 3: Calculate opportunities with detailed analysis
            const opportunities = await this.calculateArbitrageOpportunitiesEnhanced(spreads);
            
            // Step 4: Apply final profitability filters
            const profitableOpportunities = this.applyFinalFilters(opportunities);

            // Update comprehensive stats
            this.updateScanStatistics(spreads, profitableOpportunities, Date.now() - startTime);

            // Detailed logging
            this.logScanResults(spreads, profitableOpportunities, Date.now() - startTime);

            return profitableOpportunities;

        } catch (error) {
            this.scanStats.lastErrorCount++;
            logger.error('Error in cross-DEX scan', {
                error: error instanceof Error ? error : new Error(String(error)),
                scanTime: Date.now() - startTime
            });
            return [];
        }
    }

    /**
     * Enhanced market price updates with comprehensive filtering
     */
    private async updateAllMarketPricesWithFiltering(marketsByToken: MarketsByToken): Promise<MarketPrice[]> {
        const allMarkets: Array<{ market: EthMarket; tokenAddress: string }> = [];
        
        // Flatten all markets with their token addresses
        for (const [tokenAddress, markets] of Object.entries(marketsByToken)) {
            for (const market of markets) {
                allMarkets.push({ market: market as EthMarket, tokenAddress });
            }
        }

        // Process in batches to avoid overwhelming the provider
        const prices: MarketPrice[] = [];
        const batchSize = this.config.batchSize;
        let filteredByLiquidity = 0;
        
        for (let i = 0; i < allMarkets.length; i += batchSize) {
            const batch = allMarkets.slice(i, i + batchSize);
            const batchPromises = batch.map(async ({ market, tokenAddress }) => {
                const price = await this.updateMarketPriceEnhanced(market, tokenAddress);
                if (!price) {
                    filteredByLiquidity++;
                }
                return price;
            });
            
            const batchResults = await Promise.allSettled(batchPromises);
            const batchPrices = batchResults
                .filter(result => result.status === 'fulfilled' && result.value !== null)
                .map(result => (result as PromiseFulfilledResult<MarketPrice>).value);
            
            prices.push(...batchPrices);
        }

        this.scanStats.filteredByLiquidity = filteredByLiquidity;
        
        if (this.config.enableDetailedLogging) {
            logger.debug(`Market filtering results`, {
                totalMarkets: allMarkets.length,
                passedFilters: prices.length,
                filteredByLiquidity,
                filterRate: `${((filteredByLiquidity / allMarkets.length) * 100).toFixed(1)}%`
            });
        }

        return prices;
    }

    /**
     * Legacy method for compatibility
     */
    private async updateAllMarketPrices(marketsByToken: MarketsByToken): Promise<MarketPrice[]> {
        const allMarkets: Array<{ market: EthMarket; tokenAddress: string }> = [];
        
        // Flatten all markets with their token addresses
        for (const [tokenAddress, markets] of Object.entries(marketsByToken)) {
            for (const market of markets) {
                allMarkets.push({ market: market as EthMarket, tokenAddress });
            }
        }

        // Process in batches to avoid overwhelming the provider
        const prices: MarketPrice[] = [];
        const batchSize = this.config.batchSize;
        
        for (let i = 0; i < allMarkets.length; i += batchSize) {
            const batch = allMarkets.slice(i, i + batchSize);
            const batchPrices = await Promise.all(
                batch.map(({ market, tokenAddress }) => this.updateMarketPrice(market, tokenAddress))
            );
            
            // Filter out failed price updates
            prices.push(...batchPrices.filter((price): price is MarketPrice => price !== null));
        }

        logger.debug(`Updated prices for ${prices.length}/${allMarkets.length} markets`);
        return prices;
    }

    /**
     * Enhanced market price update with comprehensive validation
     */
    private async updateMarketPriceEnhanced(market: EthMarket, tokenAddress: string): Promise<MarketPrice | null> {
        const cacheKey = `${market.marketAddress}-${tokenAddress}`;
        const now = Date.now();

        // Check cache first
        const cached = this.priceCache.get(cacheKey);
        if (cached && (now - cached.lastUpdated) < this.config.maxLatencyMs) {
            this.cacheHits++;
            return cached;
        }
        this.cacheMisses++;

        try {
            // Get fresh reserves
            const reserves = await market.getReservesByToken();
            if (!Array.isArray(reserves) || reserves.length < 2) {
                return null;
            }

            const [reserve0, reserve1] = reserves;
            
            // Apply comprehensive market filters
            if (!MarketFilterValidator.validateLiquidity([reserve0, reserve1], this.config.marketFilters)) {
                return null;
            }

            // Calculate price (token1/token0 ratio with 18 decimal precision)
            const price = reserve1.mul(BigNumber.from('1000000000000000000')).div(reserve0);
            
            // Calculate total liquidity
            const liquidity = reserve0.add(reserve1);

            // Get DEX information if available
            const marketWithDexInfo = market as any;
            const dexName = marketWithDexInfo.dexInfo?.name || marketWithDexInfo.protocol || 'Unknown';

            const marketPrice: MarketPrice = {
                marketAddress: market.marketAddress,
                market,
                tokenAddress,
                price,
                liquidity,
                lastUpdated: now,
                volume24h: BigNumber.from(0) // Could be enhanced with actual volume data
            };

            // Update cache
            this.priceCache.set(cacheKey, marketPrice);
            
            // Update DEX stats
            if (!this.scanStats.dexStats.has(dexName)) {
                this.scanStats.dexStats.set(dexName, { opportunities: 0, totalMarkets: 0 });
            }
            const dexStat = this.scanStats.dexStats.get(dexName)!;
            dexStat.totalMarkets++;
            
            return marketPrice;

        } catch (error) {
            if (this.config.enableDetailedLogging) {
                logger.warn('Failed to update market price', {
                    marketAddress: market.marketAddress,
                    tokenAddress,
                    error: error instanceof Error ? error : new Error(String(error))
                });
            }
            return null;
        }
    }

    /**
     * Legacy market price update for compatibility
     */
    private async updateMarketPrice(market: EthMarket, tokenAddress: string): Promise<MarketPrice | null> {
        const cacheKey = `${market.marketAddress}-${tokenAddress}`;
        const now = Date.now();

        // Check cache first
        const cached = this.priceCache.get(cacheKey);
        if (cached && (now - cached.lastUpdated) < this.config.maxLatencyMs) {
            this.cacheHits++;
            return cached;
        }
        this.cacheMisses++;

        try {
            // Get fresh reserves
            const reserves = await market.getReservesByToken();
            if (!Array.isArray(reserves) || reserves.length < 2) {
                return null;
            }

            const [reserve0, reserve1] = reserves;
            
            // Validate reserves
            if (reserve0.eq(0) || reserve1.eq(0)) {
                return null;
            }

            // Calculate price (token1/token0 ratio with 18 decimal precision)
            const price = reserve1.mul(BigNumber.from('1000000000000000000')).div(reserve0);
            
            // Calculate total liquidity (simplified as sum of reserves)
            const liquidity = reserve0.add(reserve1);
            
            // Apply minimum liquidity filter
            if (liquidity.lt(this.config.minLiquidityWei)) {
                return null;
            }

            const marketPrice: MarketPrice = {
                marketAddress: market.marketAddress,
                market,
                tokenAddress,
                price,
                liquidity,
                lastUpdated: now
            };

            // Update cache
            this.priceCache.set(cacheKey, marketPrice);
            
            return marketPrice;

        } catch (error) {
            logger.warn('Failed to update market price', {
                marketAddress: market.marketAddress,
                tokenAddress,
                error: error instanceof Error ? error : new Error(String(error))
            });
            return null;
        }
    }

    /**
     * Enhanced spread finding with lower thresholds and detailed analysis
     */
    private async findProfitableSpreadsEnhanced(prices: MarketPrice[]): Promise<PriceSpread[]> {
        const spreads: PriceSpread[] = [];
        let filteredBySpread = 0;
        
        // Group prices by token
        const pricesByToken = new Map<string, MarketPrice[]>();
        for (const price of prices) {
            if (!pricesByToken.has(price.tokenAddress)) {
                pricesByToken.set(price.tokenAddress, []);
            }
            pricesByToken.get(price.tokenAddress)!.push(price);
        }

        // Find spreads for each token with enhanced analysis
        for (const [tokenAddress, tokenPrices] of pricesByToken) {
            if (tokenPrices.length < 2) {
                filteredBySpread++;
                continue;
            }

            // Sort by price to find min/max efficiently
            tokenPrices.sort((a, b) => a.price.gt(b.price) ? 1 : -1);
            
            // Check multiple spread combinations, not just min/max
            for (let i = 0; i < tokenPrices.length - 1; i++) {
                for (let j = i + 1; j < tokenPrices.length; j++) {
                    const lowestPriceMarket = tokenPrices[i];
                    const highestPriceMarket = tokenPrices[j];
                    
                    // Calculate spread percentage in basis points
                    const priceDiff = highestPriceMarket.price.sub(lowestPriceMarket.price);
                    
                    if (priceDiff.lte(0)) continue;
                    
                    const spreadPercentage = priceDiff.mul(10000).div(lowestPriceMarket.price).toNumber();
                    
                    // Apply very low threshold initially for discovery
                    const minSpread = Math.min(
                        this.config.minSpreadBasisPoints, 
                        this.config.marketFilters.MIN_SPREAD_BASIS_POINTS
                    );
                    
                    if (spreadPercentage >= minSpread) {
                        // Calculate spread in basis points
                        const priceDiff = highestPriceMarket.price.sub(lowestPriceMarket.price);
                        const avgPrice = highestPriceMarket.price.add(lowestPriceMarket.price).div(2);
                        const spreadBps = avgPrice.gt(0) ? priceDiff.mul(10000).div(avgPrice).toNumber() : 0;
                        
                        // Validate spread using market filters
                        if (MarketFilterValidator.validateSpread(spreadBps, this.config.marketFilters)) {
                            const spread = await this.createPriceSpread(
                                tokenAddress,
                                lowestPriceMarket,
                                highestPriceMarket,
                                spreadPercentage
                            );
                            
                            if (spread) {
                                spreads.push(spread);
                            }
                        }
                    } else {
                        filteredBySpread++;
                    }
                }
            }
        }

        this.scanStats.filteredBySpread = filteredBySpread;
        this.scanStats.totalSpreadsFound = spreads.length;

        // Sort by potential profit descending
        spreads.sort((a, b) => b.potentialProfit.gt(a.potentialProfit) ? 1 : -1);

        if (this.config.enableDetailedLogging) {
            const avgSpread = spreads.length > 0 
                ? spreads.reduce((sum, s) => sum + s.spreadPercentage, 0) / spreads.length 
                : 0;
            this.scanStats.averageSpreadBasisPoints = avgSpread;

            logger.debug(`Enhanced spread analysis completed`, {
                totalSpreadsFound: spreads.length,
                averageSpreadBps: avgSpread.toFixed(1),
                filteredBySpread,
                minThresholdBps: this.config.minSpreadBasisPoints,
                topSpreads: spreads.slice(0, 3).map(s => ({
                    token: s.tokenAddress.slice(0, 8) + '...',
                    spreadBps: s.spreadPercentage.toFixed(1),
                    profitETH: formatEther(s.potentialProfit)
                }))
            });
        }

        return spreads;
    }

    /**
     * Legacy method for compatibility
     */
    private async findProfitableSpreads(prices: MarketPrice[]): Promise<PriceSpread[]> {
        const spreads: PriceSpread[] = [];
        
        // Group prices by token
        const pricesByToken = new Map<string, MarketPrice[]>();
        for (const price of prices) {
            if (!pricesByToken.has(price.tokenAddress)) {
                pricesByToken.set(price.tokenAddress, []);
            }
            pricesByToken.get(price.tokenAddress)!.push(price);
        }

        // Find spreads for each token
        for (const [tokenAddress, tokenPrices] of pricesByToken) {
            if (tokenPrices.length < 2) continue;

            // Sort by price to find min/max efficiently
            tokenPrices.sort((a, b) => a.price.gt(b.price) ? 1 : -1);
            
            const lowestPriceMarket = tokenPrices[0];
            const highestPriceMarket = tokenPrices[tokenPrices.length - 1];
            
            // Calculate spread percentage in basis points
            const priceDiff = highestPriceMarket.price.sub(lowestPriceMarket.price);
            const spreadPercentage = priceDiff.mul(10000).div(lowestPriceMarket.price).toNumber();
            
            // Check if spread meets minimum threshold
            if (spreadPercentage >= this.config.minSpreadBasisPoints) {
                // Estimate potential profit (simplified)
                const maxLiquidityTrade = lowestPriceMarket.liquidity.div(10); // Max 10% of liquidity
                const potentialProfit = maxLiquidityTrade.mul(priceDiff).div(lowestPriceMarket.price);
                
                // Calculate optimal trade size (simplified)
                const optimalTradeSize = await this.calculateOptimalTradeSize(
                    lowestPriceMarket,
                    highestPriceMarket
                );

                spreads.push({
                    tokenAddress,
                    lowestPriceMarket,
                    highestPriceMarket,
                    spreadPercentage,
                    potentialProfit,
                    optimalTradeSize
                });
            }
        }

        // Sort by potential profit descending
        spreads.sort((a, b) => b.potentialProfit.gt(a.potentialProfit) ? 1 : -1);

        logger.debug(`Found ${spreads.length} profitable spreads`, {
            minSpread: this.config.minSpreadBasisPoints,
            avgSpread: spreads.length > 0 
                ? spreads.reduce((sum, s) => sum + s.spreadPercentage, 0) / spreads.length 
                : 0
        });

        return spreads;
    }

    /**
     * Calculate optimal trade size for a price spread using analytical methods
     */
    private async calculateOptimalTradeSize(
        buyMarket: MarketPrice,
        sellMarket: MarketPrice
    ): Promise<BigNumber> {
        try {
            // Use the analytical engine to calculate optimal trade size
            const opportunity = await this.analyticalEngine.calculateOptimalTrade(
                buyMarket.market,
                sellMarket.market,
                buyMarket.tokenAddress
            );

            return opportunity?.optimalInputAmount || BigNumber.from(0);
        } catch (error) {
            logger.warn('Failed to calculate optimal trade size', {
                buyMarket: buyMarket.marketAddress,
                sellMarket: sellMarket.marketAddress,
                error: error instanceof Error ? error : new Error(String(error))
            });
            
            // Fallback: use percentage of smaller liquidity pool
            const minLiquidity = buyMarket.liquidity.lt(sellMarket.liquidity) 
                ? buyMarket.liquidity 
                : sellMarket.liquidity;
            
            return minLiquidity.div(20); // 5% of smaller pool
        }
    }

    /**
     * Calculate detailed arbitrage opportunities from price spreads
     */
    private async calculateArbitrageOpportunities(spreads: PriceSpread[]): Promise<ArbitrageOpportunity[]> {
        const opportunities: ArbitrageOpportunity[] = [];

        for (const spread of spreads) {
            try {
                const opportunity = await this.analyticalEngine.calculateOptimalTrade(
                    spread.lowestPriceMarket.market,
                    spread.highestPriceMarket.market,
                    spread.tokenAddress
                );

                if (opportunity) {
                    opportunities.push(opportunity);
                }
            } catch (error) {
                logger.warn('Failed to calculate arbitrage opportunity', {
                    tokenAddress: spread.tokenAddress,
                    buyMarket: spread.lowestPriceMarket.marketAddress,
                    sellMarket: spread.highestPriceMarket.marketAddress,
                    error: error instanceof Error ? error : new Error(String(error))
                });
            }
        }

        return opportunities;
    }

    /**
     * Get real-time scanner statistics
     */
    public getScannerStats() {
        return {
            ...this.scanStats,
            cacheSize: this.priceCache.size,
            lastScanTime: this.lastScanTime,
            cacheHitRate: this.calculateCacheHitRate()
        };
    }

    /**
     * Calculate cache hit rate for monitoring
     *
     * Returns the percentage of cache hits vs total cache accesses.
     * Higher rates indicate good cache utilization and reduced RPC calls.
     */
    private calculateCacheHitRate(): number {
        const totalAccesses = this.cacheHits + this.cacheMisses;

        if (totalAccesses === 0) {
            return 0; // No cache accesses yet
        }

        return this.cacheHits / totalAccesses;
    }

    /**
     * Clear stale cache entries
     */
    public clearStaleCache(): void {
        const now = Date.now();
        const staleKeys: string[] = [];

        for (const [key, price] of this.priceCache) {
            if ((now - price.lastUpdated) > this.config.maxLatencyMs * 2) {
                staleKeys.push(key);
            }
        }

        for (const key of staleKeys) {
            this.priceCache.delete(key);
        }

        if (staleKeys.length > 0) {
            logger.debug(`Cleared ${staleKeys.length} stale cache entries`);
        }
    }

    /**
     * Create a detailed price spread object
     */
    private async createPriceSpread(
        tokenAddress: string,
        lowestPriceMarket: MarketPrice,
        highestPriceMarket: MarketPrice,
        spreadPercentage: number
    ): Promise<PriceSpread | null> {
        try {
            // Estimate potential profit (simplified)
            const maxLiquidityTrade = lowestPriceMarket.liquidity.div(
                BigNumber.from(this.config.marketFilters.MAX_TRADE_PERCENT_OF_LIQUIDITY || 10)
            );
            
            const priceDiff = highestPriceMarket.price.sub(lowestPriceMarket.price);
            const potentialProfit = maxLiquidityTrade.mul(priceDiff).div(lowestPriceMarket.price);
            
            // Calculate optimal trade size
            const optimalTradeSize = await this.calculateOptimalTradeSize(
                lowestPriceMarket,
                highestPriceMarket
            );

            return {
                tokenAddress,
                lowestPriceMarket,
                highestPriceMarket,
                spreadPercentage,
                potentialProfit,
                optimalTradeSize
            };
        } catch (error) {
            logger.warn('Failed to create price spread', {
                tokenAddress,
                error: error instanceof Error ? error : new Error(String(error))
            });
            return null;
        }
    }

    /**
     * Enhanced arbitrage opportunity calculation
     */
    private async calculateArbitrageOpportunitiesEnhanced(spreads: PriceSpread[]): Promise<ArbitrageOpportunity[]> {
        const opportunities: ArbitrageOpportunity[] = [];

        for (const spread of spreads) {
            try {
                const opportunity = await this.analyticalEngine.calculateOptimalTrade(
                    spread.lowestPriceMarket.market,
                    spread.highestPriceMarket.market,
                    spread.tokenAddress
                );

                if (opportunity) {
                    // Update DEX stats
                    const buyDex = (spread.lowestPriceMarket.market as any).dexInfo?.name || 'Unknown';
                    const sellDex = (spread.highestPriceMarket.market as any).dexInfo?.name || 'Unknown';
                    
                    const buyDexStats = this.scanStats.dexStats.get(buyDex);
                    if (buyDexStats) buyDexStats.opportunities++;
                    
                    opportunities.push(opportunity);
                }
            } catch (error) {
                if (this.config.enableDetailedLogging) {
                    logger.warn('Failed to calculate enhanced arbitrage opportunity', {
                        tokenAddress: spread.tokenAddress,
                        buyMarket: spread.lowestPriceMarket.marketAddress,
                        sellMarket: spread.highestPriceMarket.marketAddress,
                        error: error instanceof Error ? error : new Error(String(error))
                    });
                }
            }
        }

        return opportunities;
    }

    /**
     * Apply final profitability filters with detailed reasoning
     */
    private applyFinalFilters(opportunities: ArbitrageOpportunity[]): ArbitrageOpportunity[] {
        let filteredByGas = 0;
        let filteredByProfit = 0;

        const filtered = opportunities.filter(opp => {
            // Gas cost validation
            if (!MarketFilterValidator.validateGasPrice(
                this.config.maxGasPriceGwei,
                this.config.marketFilters
            )) {
                filteredByGas++;
                return false;
            }

            // Net profit validation
            if (opp.netProfit.lt(this.config.marketFilters.MIN_PROFIT_ETH)) {
                filteredByProfit++;
                return false;
            }

            return true;
        });

        this.scanStats.filteredByGas = filteredByGas;
        
        if (this.config.enableDetailedLogging && (filteredByGas > 0 || filteredByProfit > 0)) {
            logger.debug('Final filtering results', {
                totalOpportunities: opportunities.length,
                passedFinalFilters: filtered.length,
                filteredByGas,
                filteredByProfit
            });
        }

        return filtered;
    }

    /**
     * Update comprehensive scan statistics
     */
    private updateScanStatistics(
        spreads: PriceSpread[],
        opportunities: ArbitrageOpportunity[],
        scanTimeMs: number
    ): void {
        this.scanStats.opportunitiesFound += opportunities.length;
        this.scanStats.averageScanTimeMs = 
            (this.scanStats.averageScanTimeMs + scanTimeMs) / 2;
        this.lastScanTime = Date.now();
    }

    /**
     * Log detailed scan results
     */
    private logScanResults(
        spreads: PriceSpread[],
        opportunities: ArbitrageOpportunity[],
        scanTimeMs: number
    ): void {
        const summary = {
            spreadsFound: spreads.length,
            opportunitiesFound: opportunities.length,
            scanTimeMs,
            marketsScanned: this.scanStats.totalMarketsScanned,
            filteredByLiquidity: this.scanStats.filteredByLiquidity,
            filteredBySpread: this.scanStats.filteredBySpread,
            filteredByGas: this.scanStats.filteredByGas
        };

        if (opportunities.length > 0) {
            const totalProfit = opportunities.reduce((sum, opp) => sum.add(opp.netProfit), BigNumber.from(0));
            const avgProfit = totalProfit.div(opportunities.length);
            
            logger.info('✅ Cross-DEX opportunities found!', {
                ...summary,
                avgProfitETH: formatEther(avgProfit),
                totalProfitETH: formatEther(totalProfit),
                topOpportunity: {
                    profitETH: formatEther(opportunities[0].netProfit),
                    profitBps: opportunities[0].profitPercentage.toString()
                }
            });

            // Log DEX performance
            if (this.scanStats.dexStats.size > 0) {
                const dexPerformance: any = {};
                for (const [dexName, stats] of this.scanStats.dexStats) {
                    dexPerformance[dexName] = {
                        markets: stats.totalMarkets,
                        opportunities: stats.opportunities,
                        successRate: stats.totalMarkets > 0 
                            ? `${((stats.opportunities / stats.totalMarkets) * 100).toFixed(1)}%` 
                            : '0%'
                    };
                }
                
                logger.info('📊 DEX Performance Summary', dexPerformance);
            }
        } else {
            logger.info('❌ No profitable opportunities found', summary);
            
            // Provide insights on why no opportunities were found
            const insights = [];
            if (this.scanStats.filteredByLiquidity > this.scanStats.totalMarketsScanned * 0.5) {
                insights.push('High liquidity filtering - consider lowering MIN_LIQUIDITY requirements');
            }
            if (this.scanStats.filteredBySpread > spreads.length * 0.8) {
                insights.push('Spread requirements too high - consider lowering MIN_SPREAD_BASIS_POINTS');
            }
            if (this.scanStats.filteredByGas > 0) {
                insights.push('Gas costs eliminating opportunities - check gas price settings');
            }
            
            if (insights.length > 0) {
                logger.info('💡 Optimization suggestions:', { insights });
            }
        }
    }

    /**
     * Force refresh all prices (bypass cache)
     */
    public async forceRefreshPrices(marketsByToken: MarketsByToken): Promise<void> {
        this.priceCache.clear();
        // Reset cache statistics when forcing refresh
        this.cacheHits = 0;
        this.cacheMisses = 0;
        await this.updateAllMarketPrices(marketsByToken);
    }
}