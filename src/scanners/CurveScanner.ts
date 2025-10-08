import { BigNumber } from "@ethersproject/bignumber";
import { Provider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { ProtocolScanner, PoolInfo, ScannerConfig } from "./ProtocolScanner";
import { CurvePool } from "../markets/CurvePool";
import { MarketType } from "../EthMarket";
import { PROTOCOL_REGISTRIES } from "../addresses";
import { logInfo, logError, logDebug, logWarn } from "../utils/logger";

const CURVE_REGISTRY_ABI = [
    "function pool_count() view returns (uint256)",
    "function pool_list(uint256 index) view returns (address)",
    "function get_pool_from_lp_token(address lp_token) view returns (address)",
    "function get_n_coins(address pool) view returns (uint256[2])",
    "function get_coins(address pool) view returns (address[8])",
    "function get_decimals(address pool) view returns (uint256[8])",
    "function get_balances(address pool) view returns (uint256[8])",
    "function get_underlying_balances(address pool) view returns (uint256[8])",
    "function get_rates(address pool) view returns (uint256[8])",
    "function get_pool_name(address pool) view returns (string)",
    "function get_lp_token(address pool) view returns (address)",
    "function is_meta(address pool) view returns (bool)"
];

interface CurvePoolInfo extends PoolInfo {
    name?: string;
    lpToken?: string;
    isMeta?: boolean;
    underlyingCoins?: string[];
    decimals?: number[];
}

export class CurveScanner extends ProtocolScanner {
    private registryContract: Contract;
    private readonly knownPools: Map<string, CurvePoolInfo> = new Map();
    
    // Well-known Curve pools for priority scanning
    private readonly PRIORITY_POOLS = [
        '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7', // 3pool (DAI/USDC/USDT)
        '0xD51a44d3FaE010294C616388b506AcdA1bfAAE46', // TriCrypto2
        '0xDeBF20617708857ebe4F679508E7b7863a8A8EeE', // aave pool
        '0xA5407eAE9Ba41422680e2e00537571bcC53efBfD', // sUSD pool
        '0x4CA9b3063Ec5866A4B82E437059D2C43d1be596F', // hBTC pool
        '0x93054188d876f558f4a66B2EF1d97d16eDf0895B', // ren pool
        '0x7fC77b5c7614E1533320Ea6DDc2Eb61fa00A9714', // sBTC pool
        '0xA2B47E3D5c44877cca798226B7B8118F9BFb7A56', // compound pool
        '0x52EA46506B9CC5Ef470C5bf89f17Dc28bB35D85C', // usdt pool
        '0x45F783CCE6B7FF23B2ab2D70e416cdb7D6055f51', // y pool
        '0x79a8C46DeA5aDa233ABaFFD40F3A0A2B1e5A4F27', // busd pool
        '0xA96A65c051bF88B4095Ee1f2451C2A9d43F53Ae2', // ankreth pool
        '0xF9440930043eb3997fc70e1339dBb11F341de7A8', // reth pool
        '0x9D0464996170c6B9e75eED71c68B99dDEDf279e8', // cvxeth pool
        '0xEd279fDD11cA84bEef15AF5D39BB4d4bEE23F0cA', // lusd pool
        '0x4e0915C88bC70750D68C481540F081fEFaF22273', // frax pool
        '0xd632f22692FaC7611d2AA1C0D552930D43CAEd3B', // fraxusdc pool
        '0x5a6A4D54456819380173272A5E8E9B9904BdF41B', // mim pool
    ];

    constructor(
        provider: Provider,
        config: Partial<ScannerConfig> = {}
    ) {
        super(provider, "Curve", config);
        this.registryAddress = PROTOCOL_REGISTRIES.CURVE.REGISTRY;
        this.registryContract = new Contract(
            this.registryAddress,
            CURVE_REGISTRY_ABI,
            provider
        );
    }

    async scanPools(): Promise<PoolInfo[]> {
        const pools: CurvePoolInfo[] = [];
        
        try {
            logInfo("Scanning Curve pools...");
            
            // First, scan priority pools
            const priorityPools = await this.scanPriorityPools();
            pools.push(...priorityPools);
            
            // Then scan registry pools if we need more
            if (pools.length < this.config.maxPools) {
                const registryPools = await this.scanRegistryPools(
                    this.config.maxPools - pools.length
                );
                pools.push(...registryPools);
            }
            
            // Also scan crypto registry for non-stablecoin pools
            if (pools.length < this.config.maxPools) {
                const cryptoPools = await this.scanCryptoRegistry(
                    this.config.maxPools - pools.length
                );
                pools.push(...cryptoPools);
            }
            
            logInfo(`Found ${pools.length} Curve pools`);
            
            return pools;
            
        } catch (error) {
            logError("Failed to scan Curve pools");
            return pools;
        }
    }

    private async scanPriorityPools(): Promise<CurvePoolInfo[]> {
        const pools: CurvePoolInfo[] = [];
        
        for (const poolAddress of this.PRIORITY_POOLS) {
            try {
                const poolInfo = await this.getPoolInfo(poolAddress);
                if (poolInfo && this.validatePool(poolInfo)) {
                    pools.push(poolInfo);
                    this.knownPools.set(poolAddress, poolInfo);
                }
            } catch (error) {
                logWarn(`Failed to get info for priority pool ${poolAddress}`);
            }
        }
        
        logDebug(`Scanned ${pools.length} priority Curve pools`);
        return pools;
    }

    private async scanRegistryPools(limit: number): Promise<CurvePoolInfo[]> {
        const pools: CurvePoolInfo[] = [];
        
        try {
            const poolCount = await this.registryContract.pool_count();
            const maxToScan = Math.min(poolCount.toNumber(), limit);
            
            logDebug(`Scanning ${maxToScan} pools from Curve registry`);
            
            // Batch pool info requests
            const batchSize = 10;
            for (let i = 0; i < maxToScan && pools.length < limit; i += batchSize) {
                const batch = [];
                for (let j = i; j < Math.min(i + batchSize, maxToScan); j++) {
                    batch.push(this.registryContract.pool_list(j));
                }
                
                const poolAddresses = await Promise.all(batch);
                
                for (const poolAddress of poolAddresses) {
                    if (this.knownPools.has(poolAddress)) {
                        pools.push(this.knownPools.get(poolAddress)!);
                        continue;
                    }
                    
                    try {
                        const poolInfo = await this.getPoolInfo(poolAddress);
                        if (poolInfo && this.validatePool(poolInfo)) {
                            pools.push(poolInfo);
                            this.knownPools.set(poolAddress, poolInfo);
                        }
                    } catch (error) {
                        // Skip failed pools
                    }
                    
                    if (pools.length >= limit) break;
                }
            }
            
        } catch (error) {
            logError("Failed to scan Curve registry");
        }
        
        return pools;
    }

    private async scanCryptoRegistry(limit: number): Promise<CurvePoolInfo[]> {
        const pools: CurvePoolInfo[] = [];

        try {
            // Curve Crypto Registry contract
            const cryptoRegistryAddress = PROTOCOL_REGISTRIES.CURVE.CRYPTO_REGISTRY;
            const cryptoRegistry = new Contract(
                cryptoRegistryAddress,
                CURVE_REGISTRY_ABI,
                this.provider
            );

            // Get pool count from crypto registry
            const poolCount = await cryptoRegistry.pool_count();
            const maxToScan = Math.min(poolCount.toNumber(), limit);

            logDebug(`Scanning ${maxToScan} pools from Curve crypto registry`);

            // Batch pool info requests
            const batchSize = 10;
            for (let i = 0; i < maxToScan && pools.length < limit; i += batchSize) {
                const batch = [];
                for (let j = i; j < Math.min(i + batchSize, maxToScan); j++) {
                    batch.push(cryptoRegistry.pool_list(j));
                }

                const poolAddresses = await Promise.all(batch);

                for (const poolAddress of poolAddresses) {
                    if (this.knownPools.has(poolAddress)) {
                        pools.push(this.knownPools.get(poolAddress)!);
                        continue;
                    }

                    try {
                        const poolInfo = await this.getPoolInfo(poolAddress);
                        if (poolInfo && this.validatePool(poolInfo)) {
                            // Mark as crypto pool (volatile assets)
                            poolInfo.poolType = 'crypto';
                            pools.push(poolInfo);
                            this.knownPools.set(poolAddress, poolInfo);
                        }
                    } catch (error) {
                        // Skip failed pools
                        logWarn(`Failed to get crypto pool info for ${poolAddress}`);
                    }

                    if (pools.length >= limit) break;
                }
            }

            logInfo(`Scanned ${pools.length} Curve crypto pools`);

        } catch (error) {
            logError("Failed to scan Curve crypto registry", {
                error: error as Error
            });
        }

        return pools;
    }

    private async getPoolInfo(poolAddress: string): Promise<CurvePoolInfo | null> {
        try {
            const [
                nCoins,
                coins,
                decimals,
                balances,
                lpToken,
                name
            ] = await Promise.all([
                this.registryContract.get_n_coins(poolAddress),
                this.registryContract.get_coins(poolAddress),
                this.registryContract.get_decimals(poolAddress),
                this.registryContract.get_balances(poolAddress),
                this.registryContract.get_lp_token(poolAddress),
                this.registryContract.get_pool_name(poolAddress).catch(() => "Unknown")
            ]);
            
            const numCoins = nCoins[0].toNumber();
            const validCoins: string[] = [];
            const validDecimals: number[] = [];
            const reserves: BigNumber[] = [];
            
            for (let i = 0; i < numCoins; i++) {
                if (coins[i] !== '0x0000000000000000000000000000000000000000') {
                    validCoins.push(coins[i]);
                    validDecimals.push(decimals[i].toNumber());
                    reserves.push(balances[i]);
                }
            }
            
            // Check for meta pool
            let isMeta = false;
            try {
                isMeta = await this.registryContract.is_meta(poolAddress);
            } catch {
                // Not all registries support this method
            }
            
            return {
                address: poolAddress,
                tokens: validCoins,
                reserves,
                name,
                lpToken,
                isMeta,
                decimals: validDecimals,
                poolType: 'stable',
                fee: BigNumber.from("4000000") // Default 0.04% fee
            };
            
        } catch (error) {
            logWarn(`Failed to get pool info for ${poolAddress}`);
            return null;
        }
    }

    async createMarket(poolInfo: PoolInfo): Promise<MarketType | null> {
        try {
            const curvePool = new CurvePool(
                poolInfo.address,
                poolInfo.tokens,
                this.provider,
                this.registryAddress
            );
            
            // Initialize the pool
            await curvePool.updateReserves();
            
            return curvePool;
            
        } catch (error) {
            logError(`Failed to create Curve market for ${poolInfo.address}`);
            return null;
        }
    }

    /**
     * Get pool by LP token address
     */
    async getPoolByLPToken(lpToken: string): Promise<string | null> {
        try {
            const poolAddress = await this.registryContract.get_pool_from_lp_token(lpToken);
            if (poolAddress === '0x0000000000000000000000000000000000000000') {
                return null;
            }
            return poolAddress;
        } catch {
            return null;
        }
    }

    /**
     * Check if a pool is a metapool
     */
    async isMetaPool(poolAddress: string): Promise<boolean> {
        try {
            return await this.registryContract.is_meta(poolAddress);
        } catch {
            return false;
        }
    }
}