import { BigNumber } from "@ethersproject/bignumber";
import { Provider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { EthMarket, MarketType } from "../EthMarket";
import { logInfo, logError, logDebug, logWarn } from "../utils/logger";
import { WETH_ADDRESS } from "../addresses";

export interface PoolInfo {
    address: string;
    tokens: string[];
    reserves?: BigNumber[];
    fee?: BigNumber;
    poolType?: string;
    metadata?: any;
}

export interface ScannerConfig {
    minLiquidityUSD: BigNumber;
    maxPools: number;
    batchSize: number;
    includeTokens?: string[];  // Whitelist of tokens to include
    excludeTokens?: string[];  // Blacklist of tokens to exclude
    cacheEnabled: boolean;
    cacheDuration: number;  // In seconds
}

export interface ScanResult {
    protocol: string;
    pools: PoolInfo[];
    markets: MarketType[];
    scanTime: number;
    errors: string[];
}

export abstract class ProtocolScanner {
    protected provider: Provider;
    protected config: ScannerConfig;
    protected protocol: string;
    protected cache: Map<string, { data: PoolInfo[], timestamp: number }> = new Map();
    protected registryAddress?: string;
    
    // Common token addresses for filtering
    protected readonly COMMON_TOKENS = [
        WETH_ADDRESS,
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
        '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
        '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
        '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
        '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI
    ];
    
    constructor(
        provider: Provider,
        protocol: string,
        config: Partial<ScannerConfig> = {}
    ) {
        this.provider = provider;
        this.protocol = protocol;
        this.config = {
            minLiquidityUSD: BigNumber.from("100000000000000000000"), // $100 minimum
            maxPools: 1000,
            batchSize: 50,
            cacheEnabled: true,
            cacheDuration: 300, // 5 minutes
            ...config
        };
    }

    /**
     * Abstract method to scan for pools - must be implemented by each protocol
     */
    abstract scanPools(): Promise<PoolInfo[]>;

    /**
     * Abstract method to create market instance from pool info
     */
    abstract createMarket(poolInfo: PoolInfo): Promise<MarketType | null>;

    /**
     * Main scan method that orchestrates the scanning process
     */
    async scan(): Promise<ScanResult> {
        const startTime = Date.now();
        const errors: string[] = [];
        let pools: PoolInfo[] = [];
        let markets: MarketType[] = [];

        try {
            logInfo(`Starting ${this.protocol} scanner...`);

            // Check cache first
            if (this.config.cacheEnabled) {
                const cached = this.getCachedPools();
                if (cached) {
                    logDebug(`Using cached pools for ${this.protocol}`);
                    pools = cached;
                } else {
                    pools = await this.scanPools();
                    this.setCachedPools(pools);
                }
            } else {
                pools = await this.scanPools();
            }

            // Filter pools
            pools = await this.filterPools(pools);

            // Create market instances
            markets = await this.createMarkets(pools);

            const scanTime = Date.now() - startTime;
            
            logInfo(`${this.protocol} scan completed`);

            return {
                protocol: this.protocol,
                pools,
                markets,
                scanTime,
                errors
            };

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            errors.push(errorMsg);
            logError(`${this.protocol} scanner failed`);
            
            return {
                protocol: this.protocol,
                pools: [],
                markets: [],
                scanTime: Date.now() - startTime,
                errors
            };
        }
    }

    /**
     * Filter pools based on configuration
     */
    protected async filterPools(pools: PoolInfo[]): Promise<PoolInfo[]> {
        let filtered = pools;

        // Filter by token whitelist/blacklist
        if (this.config.includeTokens && this.config.includeTokens.length > 0) {
            filtered = filtered.filter(pool => 
                pool.tokens.some(token => 
                    this.config.includeTokens!.includes(token.toLowerCase())
                )
            );
        }

        if (this.config.excludeTokens && this.config.excludeTokens.length > 0) {
            filtered = filtered.filter(pool => 
                !pool.tokens.some(token => 
                    this.config.excludeTokens!.includes(token.toLowerCase())
                )
            );
        }

        // Filter by liquidity if reserves are available
        if (this.config.minLiquidityUSD.gt(0)) {
            filtered = filtered.filter(pool => {
                if (!pool.reserves || pool.reserves.length === 0) return true; // Can't filter without data
                
                const totalLiquidity = pool.reserves.reduce(
                    (sum, reserve) => sum.add(reserve),
                    BigNumber.from(0)
                );
                
                return totalLiquidity.gte(this.config.minLiquidityUSD);
            });
        }

        // Limit to maxPools
        if (filtered.length > this.config.maxPools) {
            // Sort by liquidity if available and take top pools
            if (filtered[0]?.reserves) {
                filtered.sort((a, b) => {
                    const liquidityA = a.reserves!.reduce((sum, r) => sum.add(r), BigNumber.from(0));
                    const liquidityB = b.reserves!.reduce((sum, r) => sum.add(r), BigNumber.from(0));
                    return liquidityB.gt(liquidityA) ? 1 : -1;
                });
            }
            filtered = filtered.slice(0, this.config.maxPools);
        }

        logDebug(`Filtered ${this.protocol} pools`);

        return filtered;
    }

    /**
     * Create market instances from pool info
     */
    protected async createMarkets(pools: PoolInfo[]): Promise<MarketType[]> {
        const markets: MarketType[] = [];
        const batchSize = this.config.batchSize;

        for (let i = 0; i < pools.length; i += batchSize) {
            const batch = pools.slice(i, i + batchSize);
            const batchPromises = batch.map(pool => this.createMarket(pool));
            
            try {
                const batchResults = await Promise.all(batchPromises);
                const validMarkets = batchResults.filter(m => m !== null) as MarketType[];
                markets.push(...validMarkets);
            } catch (error) {
                logWarn(`Failed to create markets for batch ${i / batchSize}`);
            }
        }

        return markets;
    }

    /**
     * Get cached pools if available and not expired
     */
    protected getCachedPools(): PoolInfo[] | null {
        const cached = this.cache.get(this.protocol);
        if (!cached) return null;

        const now = Date.now() / 1000;
        if (now - cached.timestamp > this.config.cacheDuration) {
            this.cache.delete(this.protocol);
            return null;
        }

        return cached.data;
    }

    /**
     * Cache pool data
     */
    protected setCachedPools(pools: PoolInfo[]): void {
        this.cache.set(this.protocol, {
            data: pools,
            timestamp: Date.now() / 1000
        });
    }

    /**
     * Batch RPC calls for efficiency
     */
    protected async batchCall<T>(
        calls: Array<() => Promise<T>>,
        batchSize: number = 10
    ): Promise<T[]> {
        const results: T[] = [];
        
        for (let i = 0; i < calls.length; i += batchSize) {
            const batch = calls.slice(i, i + batchSize);
            const batchResults = await Promise.allSettled(batch.map(call => call()));
            
            for (const result of batchResults) {
                if (result.status === 'fulfilled') {
                    results.push(result.value);
                } else {
                    logWarn(`Batch call failed`);
                }
            }
        }
        
        return results;
    }

    /**
     * Check if a token is in the common tokens list
     */
    protected isCommonToken(tokenAddress: string): boolean {
        return this.COMMON_TOKENS.includes(tokenAddress.toLowerCase());
    }

    /**
     * Validate pool data
     */
    protected validatePool(pool: PoolInfo): boolean {
        // Basic validation
        if (!pool.address || pool.address === '0x0000000000000000000000000000000000000000') {
            return false;
        }

        if (!pool.tokens || pool.tokens.length < 2) {
            return false;
        }

        // Check for zero addresses in tokens
        for (const token of pool.tokens) {
            if (!token || token === '0x0000000000000000000000000000000000000000') {
                return false;
            }
        }

        return true;
    }

    /**
     * Get scanner statistics
     */
    getStatistics(): {
        protocol: string;
        cacheSize: number;
        cacheEnabled: boolean;
        config: ScannerConfig;
    } {
        return {
            protocol: this.protocol,
            cacheSize: this.cache.size,
            cacheEnabled: this.config.cacheEnabled,
            config: this.config
        };
    }

    /**
     * Clear cache
     */
    clearCache(): void {
        this.cache.clear();
        logDebug(`Cache cleared for ${this.protocol} scanner`);
    }

    /**
     * Update configuration
     */
    updateConfig(config: Partial<ScannerConfig>): void {
        this.config = { ...this.config, ...config };
        logDebug(`Configuration updated for ${this.protocol} scanner`, this.config);
    }
}