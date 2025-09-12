/**
 * Enhanced MEV Bot Scanner Example
 * 
 * This example demonstrates how to use the upgraded MEV bot with:
 * - Multiple DEX support (8+ DEXes)
 * - Aggressive opportunity detection
 * - Comprehensive filtering and validation
 * - Detailed performance monitoring
 * - Optimized batch processing
 */

import { providers, BigNumber } from 'ethers';
import { CrossDEXScanner, ScannerConfig } from '../src/scanners/CrossDEXScanner.js';
import { AnalyticalArbitrageEngine, AnalyticalEngineConfig } from '../src/engines/AnalyticalArbitrageEngine.js';
import { UniswapV2EthPair } from '../src/UniswapV2EthPair.js';
import { FACTORY_ADDRESSES } from '../src/addresses.js';
import { MARKET_FILTERS, AGGRESSIVE_MARKET_FILTERS, CONSERVATIVE_MARKET_FILTERS } from '../src/config/marketFilters.js';
import { DEFAULT_THRESHOLDS } from '../src/config/thresholds.js';
import { MulticallService } from '../src/services/MulticallService.js';
import { BatchService } from '../src/services/BatchService.js';
import { ProviderManager, DEFAULT_PROVIDER_CONFIGS } from '../src/services/ProviderManager.js';
import { PerformanceMonitor } from '../src/utils/PerformanceMonitor.js';
import { logInfo, logError, logWarn } from '../src/utils/logger.js';
import * as dotenv from 'dotenv';

dotenv.config();

// Enhanced Configuration for Aggressive Opportunity Detection
const ENHANCED_SCANNER_CONFIG: ScannerConfig = {
    // Very low spread threshold to catch micro-opportunities
    minSpreadBasisPoints: 5, // 0.05%
    
    // Fast data refresh for real-time opportunities
    maxLatencyMs: 15000, // 15 seconds max data age
    
    // Optimized batch processing
    batchSize: 50,
    
    // Aggressive liquidity threshold
    minLiquidityWei: BigNumber.from('50000000000000000'), // 0.05 ETH
    
    // Higher gas price tolerance for faster execution
    maxGasPriceGwei: BigNumber.from('150'), // 150 gwei
    
    // Use aggressive market filters
    marketFilters: AGGRESSIVE_MARKET_FILTERS,
    
    // Enhanced logging for debugging
    enableDetailedLogging: true,
    
    // Future feature: triangular arbitrage
    enableTriangularArbitrage: false,
};

const ENHANCED_ENGINE_CONFIG: AnalyticalEngineConfig = {
    // Very low profit threshold for opportunity discovery
    minProfitWei: AGGRESSIVE_MARKET_FILTERS.MIN_PROFIT_ETH,
    
    // Higher gas price tolerance
    maxGasPriceGwei: BigNumber.from('150'),
    
    // Increased slippage tolerance
    maxSlippagePercent: 8, // 8%
    
    // Larger trades allowed
    maxTradePercentOfLiquidity: 15, // 15%
    
    // Conservative gas estimation
    gasCostPerSwap: AGGRESSIVE_MARKET_FILTERS.BASE_GAS_COST,
};

class EnhancedMEVScanner {
    private provider: providers.JsonRpcProvider;
    private providerManager: ProviderManager;
    private batchService: BatchService;
    private multicallService: MulticallService;
    private scanner: CrossDEXScanner;
    private engine: AnalyticalArbitrageEngine;
    private performanceMonitor: PerformanceMonitor;
    
    constructor() {
        // Initialize provider management
        this.providerManager = new ProviderManager(DEFAULT_PROVIDER_CONFIGS);
        
        // Primary provider for contract interactions
        this.provider = new providers.StaticJsonRpcProvider({
            url: process.env.ETHEREUM_RPC_URL || '',
            timeout: 8000,
            throttleLimit: 10
        });

        // Initialize services
        this.batchService = new BatchService(this.providerManager);
        this.multicallService = new MulticallService(this.provider);
        this.performanceMonitor = new PerformanceMonitor();
        
        // Initialize analytical engine
        this.engine = new AnalyticalArbitrageEngine(ENHANCED_ENGINE_CONFIG);
        
        // Initialize enhanced scanner
        this.scanner = new CrossDEXScanner(
            this.provider,
            ENHANCED_SCANNER_CONFIG,
            ENHANCED_ENGINE_CONFIG
        );

        logInfo('Enhanced MEV Scanner initialized', {
            dexCount: FACTORY_ADDRESSES.length,
            minSpreadBps: ENHANCED_SCANNER_CONFIG.minSpreadBasisPoints,
            minProfitETH: ENHANCED_ENGINE_CONFIG.minProfitWei.toString(),
            maxSlippage: `${ENHANCED_ENGINE_CONFIG.maxSlippagePercent}%`
        });
    }

    /**
     * Scan for arbitrage opportunities across all supported DEXes
     */
    async scanForOpportunities() {
        const scanStartTime = Date.now();
        let scanSuccess = false;

        try {
            logInfo('🔍 Starting enhanced multi-DEX arbitrage scan...', {
                supportedDEXes: FACTORY_ADDRESSES.length,
                scanMode: 'aggressive',
                timestamp: new Date().toISOString()
            });

            // Step 1: Load markets from all DEX factories
            const marketData = await this.loadAllMarkets();
            
            // Step 2: Use the enhanced scanner to find opportunities
            const opportunities = await this.scanner.scanForOpportunities(marketData.marketsByToken);
            
            // Step 3: Use analytical engine for additional validation
            const validatedOpportunities = await this.engine.findProfitableArbitrage(marketData.marketsByToken);
            
            // Step 4: Report results
            await this.reportResults(opportunities, validatedOpportunities, marketData);
            
            scanSuccess = true;
            return { opportunities, validatedOpportunities };

        } catch (error) {
            logError('Enhanced scan failed', {
                error: error instanceof Error ? error : new Error(String(error)),
                scanTimeMs: Date.now() - scanStartTime
            });
            throw error;
        } finally {
            // Record performance metrics
            this.performanceMonitor.recordRequest(scanStartTime, scanSuccess);
        }
    }

    /**
     * Load markets from all supported DEX factories
     */
    private async loadAllMarkets() {
        const startTime = Date.now();
        
        logInfo('📊 Loading markets from all DEX factories...', {
            factoryCount: FACTORY_ADDRESSES.length
        });

        try {
            // Load markets in parallel for better performance
            const marketLoadPromises = FACTORY_ADDRESSES.map(async (factoryAddress) => {
                const startTime = Date.now();
                try {
                    const markets = await UniswapV2EthPair.getUniswapMarkets(this.provider, factoryAddress);
                    logInfo(`✅ Loaded markets from factory`, {
                        factory: factoryAddress,
                        marketCount: markets.length,
                        loadTimeMs: Date.now() - startTime
                    });
                    return markets;
                } catch (error) {
                    logError(`❌ Failed to load markets from factory`, {
                        factory: factoryAddress,
                        error: error instanceof Error ? error : new Error(String(error))
                    });
                    return [];
                }
            });

            const allMarketArrays = await Promise.all(marketLoadPromises);
            const allMarkets = allMarketArrays.flat();

            // Preload reserves using batch service
            const pairAddresses = allMarkets.map(market => market.marketAddress);
            await this.batchService.preloadReserves(pairAddresses.slice(0, 200)); // Preload top 200

            // Group markets by token using enhanced grouping
            const { marketsByToken } = await UniswapV2EthPair.getUniswapMarketsByToken(
                this.provider,
                FACTORY_ADDRESSES,
                {
                    getPriceImpact: async (tokenAddress: string, tradeSize: BigNumber, reserve: BigNumber) => {
                        return tradeSize.mul(10000).div(reserve); // Simple price impact calculation
                    },
                    getTradingFee: async (tokenAddress: string) => {
                        return BigNumber.from(300); // 0.3% default
                    }
                }
            );

            const totalTokens = Object.keys(marketsByToken).length;
            const totalMarkets = allMarkets.length;
            const avgMarketsPerToken = totalMarkets / totalTokens;

            logInfo('🎯 Market loading completed', {
                totalMarkets,
                totalTokens,
                avgMarketsPerToken: avgMarketsPerToken.toFixed(2),
                loadTimeMs: Date.now() - startTime,
                topTokens: Object.keys(marketsByToken)
                    .sort((a, b) => marketsByToken[b].length - marketsByToken[a].length)
                    .slice(0, 5)
                    .map(token => ({
                        token: token.slice(0, 8) + '...',
                        markets: marketsByToken[token].length
                    }))
            });

            return {
                marketsByToken,
                allMarkets,
                totalTokens,
                totalMarkets
            };

        } catch (error) {
            logError('Failed to load markets', {
                error: error instanceof Error ? error : new Error(String(error)),
                loadTimeMs: Date.now() - startTime
            });
            throw error;
        }
    }

    /**
     * Report scan results with detailed analytics
     */
    private async reportResults(
        scannerOpportunities: any[],
        engineOpportunities: any[],
        marketData: any
    ) {
        const scannerStats = this.scanner.getScannerStats();
        const providerHealth = this.providerManager.getHealthStatus();
        const cacheStats = this.batchService.getCacheStats();
        const performanceMetrics = this.performanceMonitor.getMetrics();

        // Combined results analysis
        const allOpportunities = new Set([
            ...scannerOpportunities.map(op => `${op.buyMarket.marketAddress}-${op.sellMarket.marketAddress}`),
            ...engineOpportunities.map(op => `${op.buyMarket.marketAddress}-${op.sellMarket.marketAddress}`)
        ]);

        const report = {
            // Opportunity Results
            opportunities: {
                scanner: scannerOpportunities.length,
                engine: engineOpportunities.length,
                unique: allOpportunities.size,
                overlap: scannerOpportunities.length + engineOpportunities.length - allOpportunities.size
            },
            
            // Market Statistics
            markets: {
                totalTokens: marketData.totalTokens,
                totalMarkets: marketData.totalMarkets,
                avgMarketsPerToken: (marketData.totalMarkets / marketData.totalTokens).toFixed(2)
            },
            
            // Scanner Performance
            scanning: {
                ...scannerStats,
                successRate: performanceMetrics.successCount / Math.max(performanceMetrics.requestCount, 1) * 100
            },
            
            // Infrastructure Health
            infrastructure: {
                providerHealth,
                cacheHitRate: `${((cacheStats.size / Math.max(marketData.totalMarkets, 1)) * 100).toFixed(1)}%`,
                performanceMetrics: {
                    avgResponseTime: `${performanceMetrics.averageResponseTime.toFixed(0)}ms`,
                    p95ResponseTime: `${performanceMetrics.p95ResponseTime.toFixed(0)}ms`,
                    successRate: `${(performanceMetrics.successCount / Math.max(performanceMetrics.requestCount, 1) * 100).toFixed(1)}%`
                }
            }
        };

        if (scannerOpportunities.length > 0 || engineOpportunities.length > 0) {
            logInfo('🎉 OPPORTUNITIES FOUND!', report);
            
            // Log top opportunities
            const topOpportunities = [...scannerOpportunities, ...engineOpportunities]
                .sort((a, b) => b.netProfit?.gt(a.netProfit) ? 1 : -1)
                .slice(0, 3);

            logInfo('💰 Top Opportunities:', {
                opportunities: topOpportunities.map((op, index) => ({
                    rank: index + 1,
                    netProfit: op.netProfit?.toString() || 'N/A',
                    buyDEX: (op.buyMarket as any)?.dexInfo?.name || 'Unknown',
                    sellDEX: (op.sellMarket as any)?.dexInfo?.name || 'Unknown',
                    profitBps: op.profitPercentage?.toString() || 'N/A'
                }))
            });
        } else {
            logWarn('❌ No opportunities found', report);
            
            // Provide actionable suggestions
            const suggestions = [];
            if (scannerStats.filteredByLiquidity > marketData.totalMarkets * 0.5) {
                suggestions.push('Consider lowering MIN_LIQUIDITY_USD threshold');
            }
            if (scannerStats.filteredBySpread > scannerStats.totalSpreadsFound * 0.8) {
                suggestions.push('Consider lowering MIN_SPREAD_BASIS_POINTS');
            }
            if (performanceMetrics.successCount / performanceMetrics.requestCount < 0.9) {
                suggestions.push('Provider issues detected - consider switching RPC providers');
            }
            
            if (suggestions.length > 0) {
                logInfo('💡 Optimization Suggestions', { suggestions });
            }
        }
    }

    /**
     * Run continuous scanning with intelligent intervals
     */
    async runContinuousScanning(intervalMs: number = 30000) {
        logInfo('🔄 Starting continuous scanning mode', {
            intervalMs,
            intervalMinutes: (intervalMs / 60000).toFixed(1)
        });

        let scanCount = 0;
        const startTime = Date.now();

        while (true) {
            try {
                scanCount++;
                logInfo(`📊 Scan #${scanCount} starting...`);
                
                await this.scanForOpportunities();
                
                // Adaptive interval based on performance
                const metrics = this.performanceMonitor.getMetrics();
                const adaptedInterval = metrics.averageResponseTime > 10000 
                    ? intervalMs * 1.5  // Slow down if response times are high
                    : intervalMs;
                
                logInfo(`⏸️  Waiting ${(adaptedInterval / 1000).toFixed(1)}s until next scan...`);
                await this.delay(adaptedInterval);
                
            } catch (error) {
                logError('Scan iteration failed', {
                    scanCount,
                    error: error instanceof Error ? error : new Error(String(error)),
                    uptime: Math.round((Date.now() - startTime) / 1000)
                });
                
                // Exponential backoff on errors
                const backoffDelay = Math.min(intervalMs * 2, 300000); // Max 5 minutes
                logWarn(`⏸️  Error backoff: waiting ${(backoffDelay / 1000).toFixed(1)}s...`);
                await this.delay(backoffDelay);
            }
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get system health status
     */
    getHealthStatus() {
        return {
            scanner: this.scanner.getScannerStats(),
            providers: this.providerManager.getHealthStatus(),
            cache: this.batchService.getCacheStats(),
            performance: this.performanceMonitor.getMetrics()
        };
    }

    /**
     * Cleanup resources
     */
    async shutdown() {
        logInfo('Shutting down enhanced scanner...');
        this.performanceMonitor.stop();
        this.batchService.clearCache();
        logInfo('✅ Shutdown complete');
    }
}

// Example usage
async function runEnhancedScanner() {
    const scanner = new EnhancedMEVScanner();
    
    try {
        // Single scan
        logInfo('🚀 Running single enhanced scan...');
        await scanner.scanForOpportunities();
        
        // Health check
        const health = scanner.getHealthStatus();
        logInfo('🏥 System health check', health);
        
        // Uncomment for continuous scanning
        // await scanner.runContinuousScanning(30000); // 30 seconds
        
    } catch (error) {
        logError('Enhanced scanner failed', {
            error: error instanceof Error ? error : new Error(String(error))
        });
    } finally {
        await scanner.shutdown();
    }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runEnhancedScanner().catch(console.error);
}

export { EnhancedMEVScanner, ENHANCED_SCANNER_CONFIG, ENHANCED_ENGINE_CONFIG };