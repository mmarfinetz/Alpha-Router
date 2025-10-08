import { Provider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { EthMarket, MarketType } from "../EthMarket";
import { UniswapV2EthPair } from "../UniswapV2EthPair";
import { UniswapV3Pool } from "../markets/UniswapV3Pool";
import { BalancerV2Pool, BalancerPoolType } from "../markets/BalancerV2Pool";
import { CurvePool } from "../markets/CurvePool";
import { DODOV2Pool } from "../markets/DODOV2Pool";
import { KyberDMMPool } from "../markets/KyberDMMPool";
import { logInfo, logError, logDebug } from "../utils/logger";

/**
 * Supported protocol types
 */
export enum ProtocolType {
    UNISWAP_V2 = "UniswapV2",
    UNISWAP_V3 = "UniswapV3",
    SUSHISWAP = "Sushiswap",
    BALANCER_V2 = "BalancerV2",
    CURVE = "Curve",
    DODO_V2 = "DODOV2",
    KYBER_DMM = "KyberDMM"
}

/**
 * Market creation parameters
 */
export interface MarketCreationParams {
    protocol: ProtocolType;
    address: string;
    tokens: string[];
    provider: Provider;
    
    // Optional protocol-specific parameters
    fee?: number; // For Uniswap V3
    poolId?: string; // For Balancer
    poolType?: BalancerPoolType; // For Balancer
    registryAddress?: string; // For Curve
}

/**
 * Market Factory
 * Creates market instances for different AMM protocols
 */
export class MarketFactory {
    private static instance: MarketFactory;
    private provider: Provider;

    private constructor(provider: Provider) {
        this.provider = provider;
    }

    /**
     * Get singleton instance
     */
    static getInstance(provider: Provider): MarketFactory {
        if (!MarketFactory.instance) {
            MarketFactory.instance = new MarketFactory(provider);
        }
        return MarketFactory.instance;
    }

    /**
     * Create a market instance based on protocol type
     */
    async createMarket(params: MarketCreationParams): Promise<MarketType | null> {
        try {
            switch (params.protocol) {
                case ProtocolType.UNISWAP_V2:
                case ProtocolType.SUSHISWAP:
                    return await this.createUniswapV2Market(params);

                case ProtocolType.UNISWAP_V3:
                    return await this.createUniswapV3Market(params);

                case ProtocolType.BALANCER_V2:
                    return await this.createBalancerMarket(params);

                case ProtocolType.CURVE:
                    return await this.createCurveMarket(params);

                case ProtocolType.DODO_V2:
                    return await this.createDODOMarket(params);

                case ProtocolType.KYBER_DMM:
                    return await this.createKyberDMMMarket(params);

                default:
                    logError("Unsupported protocol type", {
                        protocol: params.protocol
                    });
                    return null;
            }
        } catch (error) {
            logError("Failed to create market", {
                protocol: params.protocol,
                address: params.address,
                error: error as Error
            });
            return null;
        }
    }

    /**
     * Create Uniswap V2 or Sushiswap market
     */
    private async createUniswapV2Market(params: MarketCreationParams): Promise<MarketType> {
        if (params.tokens.length !== 2) {
            throw new Error("Uniswap V2 requires exactly 2 tokens");
        }

        const market = new UniswapV2EthPair(
            params.address,
            params.tokens,
            params.protocol,
            params.tokens[0],
            params.provider  // Missing provider parameter
        );

        // Initialize reserves
        await market.updateReserves();

        logDebug("Created Uniswap V2/Sushiswap market", {
            protocol: params.protocol,
            address: params.address,
            tokens: params.tokens
        });

        return market as any;
    }

    /**
     * Create Uniswap V3 market
     */
    private async createUniswapV3Market(params: MarketCreationParams): Promise<MarketType> {
        if (params.tokens.length !== 2) {
            throw new Error("Uniswap V3 requires exactly 2 tokens");
        }

        if (!params.fee) {
            throw new Error("Uniswap V3 requires fee tier");
        }

        const market = new UniswapV3Pool(
            params.address,
            params.tokens[0],
            params.tokens[1],
            params.provider,
            params.fee
        );

        // Initialize pool info
        await (market as any).updateReserves();

        logDebug("Created Uniswap V3 market", {
            address: params.address,
            tokens: params.tokens,
            fee: params.fee
        });

        return market as any;
    }

    /**
     * Create Balancer V2 market
     */
    private async createBalancerMarket(params: MarketCreationParams): Promise<MarketType> {
        if (!params.poolId) {
            throw new Error("Balancer V2 requires pool ID");
        }

        const poolType = params.poolType || BalancerPoolType.WEIGHTED;

        const market = new BalancerV2Pool(
            params.address,
            params.poolId,
            params.tokens,
            params.provider,
            poolType
        );

        // Initialize pool info
        await (market as any).updateReserves();

        logDebug("Created Balancer V2 market", {
            address: params.address,
            tokens: params.tokens,
            poolType
        });

        return market as any;
    }

    /**
     * Create Curve market
     */
    private async createCurveMarket(params: MarketCreationParams): Promise<MarketType> {
        const market = new CurvePool(
            params.address,
            params.tokens,
            params.provider,
            params.registryAddress
        );

        // Initialize pool info
        await (market as any).updateReserves();

        logDebug("Created Curve market", {
            address: params.address,
            tokens: params.tokens
        });

        return market as any;
    }

    /**
     * Create DODO V2 market
     */
    private async createDODOMarket(params: MarketCreationParams): Promise<MarketType> {
        if (params.tokens.length !== 2) {
            throw new Error("DODO V2 requires exactly 2 tokens (base and quote)");
        }

        const market = new DODOV2Pool(
            params.address,
            params.tokens[0], // base token
            params.tokens[1], // quote token
            params.provider
        );

        // Initialize pool info
        await (market as any).updateReserves();

        logDebug("Created DODO V2 market", {
            address: params.address,
            tokens: params.tokens
        });

        return market as any;
    }

    /**
     * Create Kyber DMM market
     */
    private async createKyberDMMMarket(params: MarketCreationParams): Promise<MarketType> {
        if (params.tokens.length !== 2) {
            throw new Error("Kyber DMM requires exactly 2 tokens");
        }

        const market = new KyberDMMPool(
            params.address,
            params.tokens,
            params.provider
        );

        // Initialize pool info
        await (market as any).updateReserves();

        logDebug("Created Kyber DMM market", {
            address: params.address,
            tokens: params.tokens
        });

        return market as any;
    }

    /**
     * Create markets for multiple protocols
     */
    async createMarketsForToken(
        tokenAddress: string,
        protocols: ProtocolType[],
        factoryAddresses: Map<ProtocolType, string>
    ): Promise<MarketType[]> {
        const markets: MarketType[] = [];

        for (const protocol of protocols) {
            const factoryAddress = factoryAddresses.get(protocol);
            if (!factoryAddress) {
                logDebug("No factory address for protocol", { protocol });
                continue;
            }

            try {
                // Discover markets for this protocol
                const discoveredMarkets = await this.discoverMarketsForProtocol(
                    tokenAddress,
                    protocol,
                    factoryAddress
                );

                markets.push(...discoveredMarkets);

            } catch (error) {
                logError("Failed to discover markets for protocol", {
                    protocol,
                    error: error as Error
                });
            }
        }

        logInfo("Created markets for token", {
            token: tokenAddress,
            totalMarkets: markets.length,
            byProtocol: this.groupMarketsByProtocol(markets)
        });

        return markets;
    }

    /**
     * Discover markets for a specific protocol
     */
    private async discoverMarketsForProtocol(
        tokenAddress: string,
        protocol: ProtocolType,
        factoryAddress: string
    ): Promise<MarketType[]> {
        const markets: MarketType[] = [];

        try {
            switch (protocol) {
                case ProtocolType.UNISWAP_V2:
                case ProtocolType.SUSHISWAP:
                    return await this.discoverUniswapV2Pairs(tokenAddress, factoryAddress);

                case ProtocolType.UNISWAP_V3:
                    return await this.discoverUniswapV3Pools(tokenAddress, factoryAddress);

                case ProtocolType.BALANCER_V2:
                    return await this.discoverBalancerPools(tokenAddress);

                case ProtocolType.CURVE:
                    return await this.discoverCurvePools(tokenAddress);

                case ProtocolType.DODO_V2:
                    return await this.discoverDODOPools(tokenAddress);

                case ProtocolType.KYBER_DMM:
                    return await this.discoverKyberPools(tokenAddress);

                default:
                    logDebug("Unknown protocol type", { protocol });
                    return [];
            }
        } catch (error) {
            logError("Failed to discover markets for protocol", {
                protocol,
                tokenAddress,
                error: error as Error
            });
            return [];
        }
    }

    /**
     * Discover Uniswap V2 style pairs (Uniswap, Sushiswap, etc.)
     */
    private async discoverUniswapV2Pairs(tokenAddress: string, factoryAddress: string): Promise<MarketType[]> {
        // Use existing UniswapV2EthPair discovery
        const { getUniswapMarketsByToken } = require('../UniswapV2EthPair');
        return await getUniswapMarketsByToken(tokenAddress, [factoryAddress], this.provider);
    }

    /**
     * Discover Uniswap V3 pools for all fee tiers
     */
    private async discoverUniswapV3Pools(tokenAddress: string, factoryAddress: string): Promise<MarketType[]> {
        const markets: MarketType[] = [];
        const feeTiers = [500, 3000, 10000]; // 0.05%, 0.3%, 1%
        const factoryContract = new Contract(
            factoryAddress,
            ["function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)"],
            this.provider
        );

        // Common quote tokens to pair with
        const quoteTokens = [
            "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
            "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
            "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT
            "0x6B175474E89094C44Da98b954EedeAC495271d0F"  // DAI
        ];

        for (const quoteToken of quoteTokens) {
            if (quoteToken.toLowerCase() === tokenAddress.toLowerCase()) continue;

            for (const fee of feeTiers) {
                try {
                    const poolAddress = await factoryContract.getPool(tokenAddress, quoteToken, fee);
                    if (poolAddress && poolAddress !== "0x0000000000000000000000000000000000000000") {
                        const market = await this.createUniswapV3Market({
                            protocol: ProtocolType.UNISWAP_V3,
                            address: poolAddress,
                            tokens: [tokenAddress, quoteToken],
                            provider: this.provider,
                            fee
                        });
                        if (market) markets.push(market);
                    }
                } catch (error) {
                    // Pool doesn't exist or error querying
                    continue;
                }
            }
        }

        return markets;
    }

    /**
     * Discover Balancer V2 pools containing token
     */
    private async discoverBalancerPools(tokenAddress: string): Promise<MarketType[]> {
        // Use ProtocolScanner for Balancer
        const { ProtocolScanner } = require('../scanners/ProtocolScanner');
        const scanner = new ProtocolScanner(this.provider, "Balancer", {});

        try {
            const pools = await scanner.scanPools();
            const relevantPools = pools.filter((pool: any) =>
                pool.tokens.some((t: string) => t.toLowerCase() === tokenAddress.toLowerCase())
            );

            const markets: MarketType[] = [];
            for (const pool of relevantPools) {
                const market = await scanner.createMarket(pool);
                if (market) markets.push(market);
            }
            return markets;
        } catch (error) {
            logError("Failed to discover Balancer pools", { error: error as Error });
            return [];
        }
    }

    /**
     * Discover Curve pools containing token
     */
    private async discoverCurvePools(tokenAddress: string): Promise<MarketType[]> {
        // Use CurveScanner
        const { CurveScanner } = require('../scanners/CurveScanner');
        const scanner = new CurveScanner(this.provider, {});

        try {
            const pools = await scanner.scanPools();
            const relevantPools = pools.filter((pool: any) =>
                pool.tokens.some((t: string) => t.toLowerCase() === tokenAddress.toLowerCase())
            );

            const markets: MarketType[] = [];
            for (const pool of relevantPools) {
                const market = await scanner.createMarket(pool);
                if (market) markets.push(market);
            }
            return markets;
        } catch (error) {
            logError("Failed to discover Curve pools", { error: error as Error });
            return [];
        }
    }

    /**
     * Discover DODO V2 pools containing token
     */
    private async discoverDODOPools(tokenAddress: string): Promise<MarketType[]> {
        // DODO uses a registry - query it directly
        const { PROTOCOL_REGISTRIES } = require('../addresses');
        const registryAddress = PROTOCOL_REGISTRIES.DODO.REGISTRY;

        const registryContract = new Contract(
            registryAddress,
            [
                "function getDODOPool(address baseToken, address quoteToken) view returns (address[] memory)",
                "function getDODOPoolBidirection(address token0, address token1) view returns (address[] memory, address[] memory)"
            ],
            this.provider
        );

        const markets: MarketType[] = [];
        const quoteTokens = [
            "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
            "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
            "0x6B3595068778DD592e39A122f4f5a5cF09C90fE2"  // SUSHI
        ];

        for (const quoteToken of quoteTokens) {
            if (quoteToken.toLowerCase() === tokenAddress.toLowerCase()) continue;

            try {
                const [basePools, quotePools] = await registryContract.getDODOPoolBidirection(tokenAddress, quoteToken);

                for (const poolAddress of [...basePools, ...quotePools]) {
                    if (poolAddress !== "0x0000000000000000000000000000000000000000") {
                        const market = await this.createDODOMarket({
                            protocol: ProtocolType.DODO_V2,
                            address: poolAddress,
                            tokens: [tokenAddress, quoteToken],
                            provider: this.provider
                        });
                        if (market) markets.push(market);
                    }
                }
            } catch (error) {
                continue;
            }
        }

        return markets;
    }

    /**
     * Discover Kyber DMM pools containing token
     */
    private async discoverKyberPools(tokenAddress: string): Promise<MarketType[]> {
        const { KYBER_DMM_FACTORY_ADDRESS } = require('../addresses');
        const factoryContract = new Contract(
            KYBER_DMM_FACTORY_ADDRESS,
            [
                "function getPools(address token0, address token1) view returns (address[] memory)",
                "function allPools(uint256 index) view returns (address)"
            ],
            this.provider
        );

        const markets: MarketType[] = [];
        const quoteTokens = [
            "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
            "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
            "0xdAC17F958D2ee523a2206206994597C13D831ec7"  // USDT
        ];

        for (const quoteToken of quoteTokens) {
            if (quoteToken.toLowerCase() === tokenAddress.toLowerCase()) continue;

            try {
                const pools = await factoryContract.getPools(tokenAddress, quoteToken);

                for (const poolAddress of pools) {
                    if (poolAddress !== "0x0000000000000000000000000000000000000000") {
                        const market = await this.createKyberDMMMarket({
                            protocol: ProtocolType.KYBER_DMM,
                            address: poolAddress,
                            tokens: [tokenAddress, quoteToken],
                            provider: this.provider
                        });
                        if (market) markets.push(market);
                    }
                }
            } catch (error) {
                continue;
            }
        }

        return markets;
    }

    /**
     * Group markets by protocol for logging
     */
    private groupMarketsByProtocol(markets: MarketType[]): Record<string, number> {
        const grouped: Record<string, number> = {};

        for (const market of markets) {
            const protocol = market.protocol;
            grouped[protocol] = (grouped[protocol] || 0) + 1;
        }

        return grouped;
    }

    /**
     * Detect protocol type from market address
     */
    async detectProtocol(marketAddress: string): Promise<ProtocolType | null> {
        // Try to detect protocol by calling different interfaces
        // This is a heuristic approach - in production, maintain a registry

        try {
            // Try Uniswap V2 interface
            const v2Contract = new Contract(
                marketAddress,
                ["function factory() view returns (address)"],
                this.provider
            );
            await v2Contract.factory();
            return ProtocolType.UNISWAP_V2;
        } catch {
            // Not V2
        }

        try {
            // Try Uniswap V3 interface
            const v3Contract = new Contract(
                marketAddress,
                ["function slot0() view returns (uint160, int24, uint16, uint16, uint16, uint8, bool)"],
                this.provider
            );
            await v3Contract.slot0();
            return ProtocolType.UNISWAP_V3;
        } catch {
            // Not V3
        }

        // Add more protocol detection logic here

        return null;
    }

    /**
     * Validate market instance
     */
    async validateMarket(market: MarketType): Promise<boolean> {
        try {
            // Try to get reserves
            const reserves = await market.getReservesByToken();
            
            // Try to get trading fee
            const fee = await market.getTradingFee();
            
            // Basic validation
            if (Array.isArray(reserves)) {
                return reserves.length > 0 && reserves.every(r => !r.isNegative());
            }
            
            return !reserves.isNegative() && !fee.isNegative();

        } catch (error) {
            logError("Market validation failed", {
                address: market.marketAddress,
                error: error as Error
            });
            return false;
        }
    }
}

/**
 * Convenience function to create a market
 */
export async function createMarket(
    protocol: ProtocolType,
    address: string,
    tokens: string[],
    provider: Provider,
    options?: {
        fee?: number;
        poolId?: string;
        poolType?: BalancerPoolType;
        registryAddress?: string;
    }
): Promise<MarketType | null> {
    const factory = MarketFactory.getInstance(provider);
    
    return factory.createMarket({
        protocol,
        address,
        tokens,
        provider,
        ...options
    });
}

