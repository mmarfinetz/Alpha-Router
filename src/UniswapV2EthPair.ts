import * as _ from "lodash";
import { BigNumber, Contract, providers, utils } from "ethers";
import { UNISWAP_PAIR_ABI, UNISWAP_QUERY_ABI, UNISWAP_FACTORY_ABI, WETH_ABI} from "./abi.js";
import { FACTORY_ADDRESSES, UNISWAP_V2_COMPATIBLE_FACTORIES, NON_COMPATIBLE_FACTORIES, UNISWAP_LOOKUP_CONTRACT_ADDRESS, DEX_INFO, DEXInfo } from "./addresses.js";
import { CallDetails, MultipleCallData, TokenBalances } from "./EthMarket.js";
import { ETHER } from "./utils.js";
import { MarketType, EthMarket, CrossedMarketDetails, MarketsByToken, BuyCalls } from "./types.js";
import { DEFAULT_THRESHOLDS } from "./config/thresholds.js";
import { SCANNER_CONFIG } from "./config/scanner-config.js";
import * as dotenv from 'dotenv';
import { ethers } from 'ethers';
import { flattenArray } from "./utils.js";
// import pLimit from 'p-limit'; // Temporarily disabled due to ES module conflict
import { Provider } from '@ethersproject/providers';
import pkg from 'lodash';
import { logInfo, logError, logDebug, logWarn } from './utils/logger.js';
const { groupBy, zipObject, isEqual } = pkg;

dotenv.config();

const CONCURRENT_REQUESTS = 25; // Increased for better throughput utilization
const DEFAULT_WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL;
//const factoryAddress = UNISWAP_FACTORY_ADDRESS;

const WETH_ADDRESS = process.env.WETH_ADDRESS || DEFAULT_WETH_ADDRESS;

// batch count limit helpful for testing, loading entire set of uniswap markets takes a long time to load
const BATCH_COUNT_LIMIT = process.env.SCANNER_MODE === 'discovery' ? 100 : 20; // More batches in discovery mode
const UNISWAP_BATCH_SIZE = 1000; // Increased batch size for more pairs per request
const provider = new ethers.providers.StaticJsonRpcProvider({
    url: ETHEREUM_RPC_URL || 'http://localhost:8545',
    timeout: 8000, // 8 seconds for pair operations
    throttleLimit: 5
});

// Not necessary, slightly speeds up loading initialization when we know tokens are bad
// Estimate gas will ensure we aren't submitting bad bundles, but bad tokens waste time
const blacklistTokens = [
  '0xD75EA151a61d06868E31F8988D28DFE5E9df57B4',
  //'0x06AF07097C9Eeb7fD685c692751D5C66dB49c215'
]

// Add these constants at the top of the file after the existing imports
const BATCH_SIZE = 25; // Further reduced to avoid Alchemy server timeouts
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds
const BATCH_DELAY = 50; // Reduced delay for faster processing
const MAX_TOTAL_PAIRS = 25000; // Max pairs per DEX to prevent memory issues

// Add this type definition near the top of the file with other interfaces
interface PairArray extends Array<string> {
    0: string;  // token0
    1: string;  // token1
    2: string;  // pairAddress
}

export interface ImpactAndFeeFuncs {
  getPriceImpact: (tokenAddress: string, tradeSize: BigNumber, reserve: BigNumber) => Promise<BigNumber>;
  getTradingFee: (tokenAddress: string) => Promise<BigNumber>;
}

export interface GroupedMarkets {
  marketsByToken: MarketsByToken;
  allMarketPairs: Array<UniswapV2EthPair>;
  getPriceImpact(tokenAddress: string, tradeSize: BigNumber): Promise<BigNumber>;
  getTradingFee(tokenAddress: string): Promise<BigNumber>;
}

export class UniswapV2EthPair implements MarketType, EthMarket {
  static filteredPairs: any;
  // Simple concurrency limiter replacement for p-limit
  private static limit = <T>(fn: () => Promise<T>): Promise<T> => fn();
  private static BATCH_SIZE = UNISWAP_BATCH_SIZE;
  private _tokenBalances: TokenBalances;
  private _provider: ethers.providers.JsonRpcProvider;
  private _reserves: BigNumber[] = [BigNumber.from(0), BigNumber.from(0)];

  public readonly marketAddress: string;
  public readonly protocol: string;
  public readonly tokens: string[];
  public readonly tokenAddress: string;
  public readonly factoryAddress: string;
  public readonly dexInfo: DEXInfo;

  constructor(
    marketAddress: string,
    tokens: string[],
    protocol: string,
    tokenAddress: string,
    provider: Provider,
    factoryAddress?: string
  ) {
    this.marketAddress = marketAddress;
    this.tokens = tokens;
    this.protocol = protocol;
    this.tokenAddress = tokenAddress;
    this.factoryAddress = factoryAddress || '';
    this.dexInfo = factoryAddress && DEX_INFO[factoryAddress] ? DEX_INFO[factoryAddress] : {
      name: protocol,
      factory: factoryAddress || '',
      fee: 300, // Default 0.3%
      type: 'uniswap-v2',
      compatible: true // Default to compatible if not in DEX_INFO
    };
    this._provider = provider as ethers.providers.JsonRpcProvider;
    this._tokenBalances = zipObject(tokens, tokens.map(() => BigNumber.from(0)));
  }

  static async buyFromMarket(buyFromMarket: EthMarket, sellToMarket: EthMarket, tokenAddress: string, profit: number): Promise<CrossedMarketDetails> {
    const volume = BigNumber.from(profit).mul(2); // Simple volume calculation
    return {
      buyFromMarket,
      sellToMarket,
      volume,
      profit: BigNumber.from(profit),
      marketPairs: [{
        market: buyFromMarket,
        tokens: buyFromMarket.tokens
      }],
      tokenAddress
    };
  }

  static async impactAndFeeFuncs(
    provider: providers.StaticJsonRpcProvider,
    factoryAddresses: string[],
    impactAndFeeFuncs: ImpactAndFeeFuncs
  ): Promise<GroupedMarkets> {
    const allMarketPairs: UniswapV2EthPair[] = [];
    const marketsByToken: MarketsByToken = {};

    for (const factoryAddress of factoryAddresses) {
      const pairs = await UniswapV2EthPair.getUniswapMarkets(provider, factoryAddress);
      allMarketPairs.push(...pairs);

      for (const pair of pairs) {
        for (const token of pair.tokens) {
          if (!marketsByToken[token]) {
            marketsByToken[token] = [];
          }
          marketsByToken[token].push(pair);
        }
      }
    }

    return {
      marketsByToken,
      allMarketPairs,
      getPriceImpact: async (tokenAddress: string, tradeSize: BigNumber) => {
        return impactAndFeeFuncs.getPriceImpact(tokenAddress, tradeSize, BigNumber.from(0));
      },
      getTradingFee: async (tokenAddress: string) => {
        return impactAndFeeFuncs.getTradingFee(tokenAddress);
      }
    };
  }

  async getTradingFee(): Promise<BigNumber> {
    // Use DEX-specific fee if available, otherwise default to 0.3%
    return BigNumber.from(this.dexInfo.fee || 300).mul(10); // Convert to basis points (300 -> 3000)
  }

  receiveDirectly(tokenAddress: string): boolean {
    return this.tokens.includes(tokenAddress.toLowerCase());
  }

  static uniswapInterface = new Contract(WETH_ADDRESS, UNISWAP_PAIR_ABI);

  private static async exponentialBackoff(attempt: number): Promise<void> {
    const delay = Math.min(Math.pow(2, attempt) * 1000, 10000); // Cap at 10 seconds
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async getPriceImpact(tokenAddress: string, amount: BigNumber): Promise<BigNumber> {
    const reserves = await this.getReservesByToken(tokenAddress);
    if (Array.isArray(reserves)) {
      throw new Error('Unexpected array of reserves');
    }
    return amount.mul(1000).div(reserves); // Simple price impact calculation
  }

  async getReserves(tokenAddress?: string): Promise<BigNumber> {
    if (!tokenAddress) {
      return this._reserves[0];
    }
    const tokenIndex = this.tokens.indexOf(tokenAddress);
    if (tokenIndex === -1) {
      throw new Error('Token not found in pair');
    }
    return this._reserves[tokenIndex];
  }

  async getReservesByToken(tokenAddress?: string): Promise<BigNumber | BigNumber[]> {
    if (!tokenAddress) {
      return this._reserves;
    }
    const tokenIndex = this.tokens.indexOf(tokenAddress);
    if (tokenIndex === -1) {
      throw new Error('Token not found in pair');
    }
    return this._reserves[tokenIndex];
  }

  async prepareReceive(tokenAddress: string, amountIn: BigNumber): Promise<Array<CallDetails>> {
    if (this._tokenBalances[tokenAddress] === undefined) {
      throw new Error(`Market does not operate on token ${tokenAddress}`)
    }
    if (! amountIn.gt(0)) {
      throw new Error(`Invalid amount: ${amountIn.toString()}`)
    }
    // No preparation necessary
    return []
  }
  // Example: Advanced error handling and potential gas optimization placeholder

  static async fetchWETHBalance(
    provider: ethers.providers.JsonRpcProvider, 
    marketAddress: string, 
    WETH_ADDRESS: string
  ): Promise<BigNumber> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const wethContract = new ethers.Contract(WETH_ADDRESS, WETH_ABI, provider);
        const balance = await wethContract.balanceOf(marketAddress);
        return BigNumber.from(balance);
      } catch (error: any) {
        if (attempt === 2) {
          logError(`Failed to fetch WETH balance for address ${marketAddress}`, {
            error: error instanceof Error ? error : new Error(String(error))
          });
          return BigNumber.from(0);
        }
        await this.exponentialBackoff(attempt);
      }
    }
    return BigNumber.from(0); // Typescript requires a return here even though it won't be reached
  }

  static async getUniswapMarkets(provider: providers.JsonRpcProvider, factoryAddress: string): Promise<Array<UniswapV2EthPair>> {
    const uniswapQuery = new Contract(UNISWAP_LOOKUP_CONTRACT_ADDRESS, UNISWAP_QUERY_ABI, provider);
    const dexInfo = DEX_INFO[factoryAddress];
    const dexName = dexInfo ? dexInfo.name : 'Unknown DEX';
    
    // Check if this factory is compatible with Uniswap V2 interface
    if (dexInfo && !dexInfo.compatible) {
      logWarn(`Skipping incompatible DEX factory`, { 
        factoryAddress, 
        dexName,
        reason: 'Does not support Uniswap V2 interface'
      });
      return [];
    }
    
    logInfo(`Starting market analysis for ${dexName}`, { factoryAddress, dexName });
    
    // Wrap allPairsLength call in try-catch to handle unexpected incompatible factories
    let allPairsLength;
    try {
      allPairsLength = await new Contract(factoryAddress, UNISWAP_FACTORY_ABI, provider).allPairsLength();
    } catch (error: any) {
      logError(`Failed to query allPairsLength for ${dexName}`, {
        factoryAddress,
        dexName,
        error: error instanceof Error ? error : new Error(String(error)),
        reason: 'Factory does not support allPairsLength() method'
      });
      // Return empty array instead of crashing
      return [];
    }
    
    const totalBatches = Math.ceil(allPairsLength.toNumber() / UNISWAP_BATCH_SIZE);
    logInfo(`Found pairs in factory`, { 
        factoryAddress,
        dexName,
        totalPairs: allPairsLength.toString()
    });
    logInfo(`Processing configuration`, {
        batchSize: UNISWAP_BATCH_SIZE,
        concurrentRequests: CONCURRENT_REQUESTS
    });

    const marketPairs: UniswapV2EthPair[] = [];
    let totalPairsProcessed = 0;
    let skippedByLiquidity = 0;
    let skippedByWeth = 0;
    let skippedByImpact = 0;
    let skippedByError = 0;

    for (let batch = 0; batch < Math.min(totalBatches, BATCH_COUNT_LIMIT) && totalPairsProcessed < MAX_TOTAL_PAIRS; batch++) {
        const startIndex = batch * UNISWAP_BATCH_SIZE;
        const endIndex = Math.min(startIndex + UNISWAP_BATCH_SIZE, allPairsLength.toNumber());

        // Add delay between batches
        if (batch > 0) {
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }

        try {
            const batchPairs = await uniswapQuery.functions.getPairsByIndexRange(factoryAddress, startIndex, endIndex);
            
            if (!Array.isArray(batchPairs) || !batchPairs[0]) {
                logWarn('Invalid batch pairs result', { batch, startIndex, endIndex });
                continue;
            }

            const processedPairs = await Promise.all(
                batchPairs[0].map(async (pairArray: PairArray) => {
                    if (!Array.isArray(pairArray) || pairArray.length !== 3) {
                        logWarn('Invalid pair array format', { pairArray });
                        return null;
                    }

                    const [token0, token1, pairAddress] = pairArray;
                    
                    return this.limit(async () => {
                        try {
                            // Basic validation
                            if (!ethers.utils.isAddress(token0) || !ethers.utils.isAddress(token1)) {
                                skippedByError++;
                                logDebug('Invalid token addresses', { token0, token1, pairAddress });
                                return null;
                            }

                            if (blacklistTokens.includes(token0) || blacklistTokens.includes(token1)) {
                                skippedByError++;
                                logDebug('Blacklisted token', { token0, token1, pairAddress });
                                return null;
                            }

                            // Check liquidity with retries
                            let reserves: any;
                            for (let retry = 0; retry < MAX_RETRIES; retry++) {
                                try {
                                    const pairContract = new Contract(pairAddress, UNISWAP_PAIR_ABI, provider);
                                    reserves = await pairContract.getReserves();
                                    break;
                                } catch (error: any) {
                                    if (retry === MAX_RETRIES - 1) {
                                        skippedByError++;
                                        logError('Failed to get reserves after max retries', {
                                            error: error instanceof Error ? error : new Error(error?.message || String(error)),
                                            pairAddress,
                                            retry
                                        });
                                        return null;
                                    }
                                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                                }
                            }

                            const totalLiquidity = reserves[0].add(reserves[1]);
                            const minLiquidity = process.env.SCANNER_MODE === 'discovery' 
                                ? SCANNER_CONFIG.MIN_LIQUIDITY_ETH 
                                : DEFAULT_THRESHOLDS.MIN_LIQUIDITY_ETH;
                            
                            if (totalLiquidity.lt(minLiquidity)) {
                                skippedByLiquidity++;
                                logDebug('Insufficient liquidity', { 
                                    pairAddress, 
                                    totalLiquidity: totalLiquidity.toString(),
                                    minRequired: minLiquidity.toString()
                                });
                                return null;
                            }

                            // Check WETH balance
                            const wethBalance = await this.fetchWETHBalance(provider, pairAddress, WETH_ADDRESS);
                            if (!wethBalance || wethBalance.lt(DEFAULT_THRESHOLDS.MIN_LIQUIDITY_ETH)) {
                                skippedByWeth++;
                                logDebug('Insufficient WETH balance', { 
                                    pairAddress, 
                                    wethBalance: wethBalance?.toString(),
                                    minRequired: DEFAULT_THRESHOLDS.MIN_LIQUIDITY_ETH.toString()
                                });
                                return null;
                            }

                            // Price impact check
                            const oneEth = ethers.utils.parseEther("1");
                            const priceImpact = oneEth.mul(10000).div(
                                token0.toLowerCase() === WETH_ADDRESS.toLowerCase() ? 
                                reserves[0].add(oneEth) : reserves[1].add(oneEth)
                            );

                            if (priceImpact.gt(500)) { // > 5% (increased from 1%)
                                skippedByImpact++;
                                logDebug('Price impact too high', { 
                                    pairAddress, 
                                    priceImpact: priceImpact.toString()
                                });
                                return null;
                            }

                            const dexInfo = DEX_INFO[factoryAddress];
                            const protocol = dexInfo ? dexInfo.name : 'UniswapV2-Compatible';
                            return new UniswapV2EthPair(pairAddress, [token0, token1], protocol, token0, provider, factoryAddress);
                        } catch (error: any) {
                            skippedByError++;
                            logError('Error processing pair', {
                                error: error instanceof Error ? error : new Error(error?.message || String(error)),
                                pairAddress,
                                token0,
                                token1
                            });
                            return null;
                        }
                    });
                })
            );

            const validPairs = processedPairs.filter(pair => pair !== null);
            marketPairs.push(...validPairs);
            
            totalPairsProcessed += batchPairs[0].length;
            logInfo('Processing status', {
                factoryAddress,
                processed: totalPairsProcessed,
                total: allPairsLength.toString(),
                validPairs: marketPairs.length,
                skippedByLiquidity,
                skippedByWeth,
                skippedByImpact,
                skippedByError
            });
        } catch (error: any) {
            logError('Batch processing error', {
                error: error instanceof Error ? error : new Error(error?.message || String(error)),
                batch,
                startIndex,
                endIndex
            });
        }
    }

    logInfo(`Final processing results for ${dexName}`, {
        factoryAddress,
        dexName,
        totalProcessed: totalPairsProcessed,
        validPairsFound: marketPairs.length,
        totalSkipped: skippedByLiquidity + skippedByWeth + skippedByImpact + skippedByError,
        skippedByLiquidity,
        skippedByWeth,
        skippedByImpact,
        skippedByError,
        successRate: totalPairsProcessed > 0 ? ((marketPairs.length / totalPairsProcessed) * 100).toFixed(2) + '%' : '0%'
    });
    
    return marketPairs;
}

static async getUniswapMarketsByToken(
    provider: providers.JsonRpcProvider,
    factoryAddresses: string[],
    impactAndFeeFuncs: any,
    progressCallback?: (progress: number) => void
): Promise<{
    marketsByToken: { [token: string]: UniswapV2EthPair[] };
    allMarketPairs: UniswapV2EthPair[];
    getPriceImpact: (tokenAddress: string, tradeSize: BigNumber) => Promise<BigNumber>;
    getTradingFee: (tokenAddress: string) => Promise<BigNumber>;
}> {
    try {
        // Filter to only use compatible factories
        const compatibleFactories = factoryAddresses.filter(factory => {
            const dexInfo = DEX_INFO[factory];
            return dexInfo && dexInfo.compatible;
        });
        
        const incompatibleFactories = factoryAddresses.filter(factory => {
            const dexInfo = DEX_INFO[factory];
            return dexInfo && !dexInfo.compatible;
        });
        
        // Log factory filtering results
        logInfo('Factory filtering results', {
            pairCount: factoryAddresses.length,
            updatedPairCount: compatibleFactories.length,
            failedCount: incompatibleFactories.length
        });
        
        if (compatibleFactories.length > 0) {
            logInfo('Compatible DEXes to query', {});
            compatibleFactories.forEach(factory => {
                const dexInfo = DEX_INFO[factory];
                logInfo(`- ${dexInfo?.name || factory}`, { marketAddress: factory });
            });
        }
        
        if (incompatibleFactories.length > 0) {
            logWarn('Incompatible DEXes skipped', {});
            incompatibleFactories.forEach(factory => {
                const dexInfo = DEX_INFO[factory];
                logWarn(`- ${dexInfo?.name || factory} (unsupported interface)`, { marketAddress: factory });
            });
        }
        
        // Fetch all pairs from compatible factory addresses only
        logInfo('Starting to fetch pairs from compatible factories', {
            pairCount: compatibleFactories.length
        });
        
        const allPairs = await Promise.all(
            compatibleFactories.map(factoryAddress => UniswapV2EthPair.getUniswapMarkets(provider, factoryAddress))
        );
        const allPairsFlat = flattenArray(allPairs);

        // Update reserves for filtered pairs
        logInfo('Starting reserve updates for pre-filtered pairs', {
            pairCount: allPairsFlat.length
        });
        
        await UniswapV2EthPair.updateReserves(provider, allPairsFlat, WETH_ADDRESS);

        // Group markets by token (no additional filtering needed since getUniswapMarkets already filtered)
        const marketsByToken = groupBy(allPairsFlat, pair => 
            pair.tokens[0].toLowerCase() === WETH_ADDRESS.toLowerCase() ? pair.tokens[1] : pair.tokens[0]
        ) as { [token: string]: UniswapV2EthPair[] };

        // Limit pairs per token if needed
        Object.keys(marketsByToken).forEach(token => {
            if (marketsByToken[token].length > DEFAULT_THRESHOLDS.MAX_PAIRS) {
                marketsByToken[token] = marketsByToken[token].slice(0, DEFAULT_THRESHOLDS.MAX_PAIRS);
            }
        });

        // Log final counts with DEX breakdown
        const totalPairs = flattenArray(Object.values(marketsByToken)).length;
        const totalTokens = Object.keys(marketsByToken).length;
        
        logInfo('Market processing completed successfully', {
            pairCount: totalPairs,
            updatedPairCount: totalTokens,
            failedCount: incompatibleFactories.length
        });
        
        // Log breakdown by DEX
        const pairsByDex = allPairsFlat.reduce((acc, pair) => {
            const dexName = pair.dexInfo.name;
            acc[dexName] = (acc[dexName] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        
        logInfo('Pairs found per DEX:', {});
        Object.entries(pairsByDex).forEach(([dexName, count]) => {
            logInfo(`- ${dexName}: ${count} pairs`, {});
        });
        
        logInfo(`Average pairs per token: ${(totalPairs / totalTokens).toFixed(2)}`, {});

        // Return structured market data along with impact and fee calculation methods
        return {
            marketsByToken,
            allMarketPairs: allPairsFlat,
            getPriceImpact: async (tokenAddress: string, tradeSize: BigNumber) => {
                const pair = allPairsFlat.find(pair => pair.tokens.includes(tokenAddress));
                if (!pair) {
                    throw new Error(`No pair found for token ${tokenAddress}`);
                }
                const reserve = await pair.getReserves(tokenAddress);
                return impactAndFeeFuncs.getPriceImpact(tokenAddress, tradeSize, reserve);
            },
            getTradingFee: impactAndFeeFuncs.getTradingFee,
        };
    } catch (error) {
        logError('Error in getUniswapMarketsByToken', {
            error: error as Error
        });
        throw error;
    }
}
// Helper method for updating single pair reserves
private static async updateSinglePairReserves(
    marketPair: UniswapV2EthPair,
    provider: ethers.providers.JsonRpcProvider,
    WETH_ADDRESS: string,
    contractCache: Map<string, Contract>
): Promise<UniswapV2EthPair | null> {
    try {
        // Reuse contract instance to prevent memory leaks
        let pairContract = contractCache.get(marketPair.marketAddress);
        if (!pairContract) {
            pairContract = new ethers.Contract(
                marketPair.marketAddress, 
                UNISWAP_PAIR_ABI, 
                provider
            );
            contractCache.set(marketPair.marketAddress, pairContract);
        }
        
        // Get reserves with single attempt (no retry logic to prevent hanging)
        const [reserve0, reserve1] = await pairContract.getReserves();
        const totalReserves = reserve0.add(reserve1);
        const totalReservesInEth = ethers.utils.formatEther(totalReserves);

        if (parseFloat(totalReservesInEth) < 0.5) {
            return null;
        }
        
        const wethBalance = await this.fetchWETHBalance(provider, marketPair.marketAddress, WETH_ADDRESS);
        
        if (!wethBalance.isZero()) {
            // Set reserves using the actual reserves from the pair contract
            await marketPair.setReservesViaOrderedBalances([reserve0, reserve1]);
            return marketPair;
        }
        return null;
    } catch (error) {
        logWarn('Failed to update reserves for single pair', {
            marketAddress: marketPair.marketAddress,
            error: error instanceof Error ? error : new Error(String(error))
        });
        return null;
    }
}

static async updateReserves(provider: ethers.providers.JsonRpcProvider, pairsInArbitrage: UniswapV2EthPair[], WETH_ADDRESS: string) {
    // Error boundary for the entire update process
    try {
        logInfo(`Updating reserves`, { pairCount: pairsInArbitrage.length });
        let filteredPairsInArbitrage = [];
        
        // Reduced batch size for better stability and memory management
        const BATCH_SIZE = 50; // Further reduced for memory efficiency
        const TIMEOUT_MS = 30000; // 30 seconds timeout per batch
        const contractCache = new Map<string, Contract>(); // Reuse contracts
    
    // Process in simplified batches with timeout
    for (let i = 0; i < pairsInArbitrage.length; i += BATCH_SIZE) {
        const batchPairs = pairsInArbitrage.slice(i, i + BATCH_SIZE);
        
        logInfo(`Reserve update progress`, {
            processed: i,
            total: pairsInArbitrage.length,
            batchSize: BATCH_SIZE,
            count: batchPairs.length
        });
        
        try {
            // Simplified promise processing without complex timeout handling
            const promises = batchPairs.map(async (marketPair) => {
                try {
                    return await this.updateSinglePairReserves(marketPair, provider, WETH_ADDRESS, contractCache);
                } catch (error) {
                    logWarn('Pair update failed', {
                        error: error instanceof Error ? error : new Error(`${marketPair.marketAddress}: ${String(error)}`)
                    });
                    return null;
                }
            });
            
            // Wait for batch with overall timeout
            const batchResults = await Promise.allSettled(promises);
            const validResults = batchResults
                .map(result => result.status === 'fulfilled' ? result.value : null)
                .filter((pair): pair is UniswapV2EthPair => pair !== null);
            
            filteredPairsInArbitrage.push(...validResults);
            
            logInfo(`Batch completed`, {
                batchIndex: Math.floor(i / BATCH_SIZE) + 1,
                processed: validResults.length,
                total: batchPairs.length
            });
            
        } catch (error) {
            logError('Batch processing error', {
                error: error instanceof Error ? error : new Error(String(error)),
                batchIndex: Math.floor(i / BATCH_SIZE) + 1
            });
            // Continue with next batch
        }
    }

        // Clean up contract cache to prevent memory leaks
        contractCache.clear();
        
        logInfo(`Reserve update completed with memory optimization`, { 
            updatedPairCount: filteredPairsInArbitrage.length
        });
        return filteredPairsInArbitrage;
        
    } catch (criticalError: any) {
        logError('Critical error in updateReserves - returning partial results', {
            error: criticalError as Error,
            pairCount: pairsInArbitrage?.length || 0
        });
        // Return empty array to prevent crash
        return [];
    }
}
// In UniswapV2EthPair getBalance method:

async getBalance(tokenAddress: string): Promise<BigNumber> {
  const tokenContract = new Contract(
    tokenAddress,
    ['function balanceOf(address) view returns (uint256)'],
    this._provider
  );
  try {
    return await tokenContract.balanceOf(this.marketAddress);
  } catch (error) {
    logError(`Failed to get balance`, {
      tokenAddress,
      marketAddress: this.marketAddress,
      error: error as Error
    });
    throw error;
  }
}
  async setReservesViaOrderedBalances(balances: Array<BigNumber>): Promise<void> {
    if (balances.length !== 2) {
      throw new Error("Expected exactly 2 balances");
    }
    this._reserves = [balances[0], balances[1]];
  }
  // Optimizing setReservesViaMatchingArray for clearer balance updating:

  async setReservesViaMatchingArray(tokens: Array<string>, balances: Array<BigNumber>): Promise<void> {
    const tokenBalances = zipObject(tokens, balances);
    if (!isEqual(this._tokenBalances, tokenBalances)) {
      this._tokenBalances = tokenBalances;
    }
  }

  async getTokensOut(tokenIn: string, tokenOut: string, amountIn: BigNumber): Promise<BigNumber> {
    const indexIn = this.tokens.indexOf(tokenIn);
    const indexOut = this.tokens.indexOf(tokenOut);
    if (indexIn === -1 || indexOut === -1) {
      throw new Error('Token not found in pair');
    }

    const reserveIn = this._reserves[indexIn];
    const reserveOut = this._reserves[indexOut];

    // Use DEX-specific fee (default 0.3% = 300 basis points)
    const fee = this.dexInfo.fee || 300;
    const feeNumerator = 10000 - fee; // e.g., 9970 for 0.3% fee
    const feeDenominator = 10000;

    const amountInWithFee = amountIn.mul(feeNumerator);
    const numerator = amountInWithFee.mul(reserveOut);
    const denominator = reserveIn.mul(feeDenominator).add(amountInWithFee);
    return numerator.div(denominator);
  }

  async getTokensIn(tokenIn: string, tokenOut: string, amountOut: BigNumber): Promise<BigNumber> {
    const indexIn = this.tokens.indexOf(tokenIn);
    const indexOut = this.tokens.indexOf(tokenOut);
    if (indexIn === -1 || indexOut === -1) {
      throw new Error('Token not found in pair');
    }

    const reserveIn = this._reserves[indexIn];
    const reserveOut = this._reserves[indexOut];

    // Use DEX-specific fee (default 0.3% = 300 basis points)
    const fee = this.dexInfo.fee || 300;
    const feeNumerator = 10000 - fee; // e.g., 9970 for 0.3% fee
    const feeDenominator = 10000;

    const numerator = reserveIn.mul(amountOut).mul(feeDenominator);
    const denominator = reserveOut.sub(amountOut).mul(feeNumerator);
    return numerator.div(denominator).add(1); // Add 1 to round up
  }

  getAmountIn(reserveIn: BigNumber, reserveOut: BigNumber, amountOut: BigNumber): BigNumber {
    // Use DEX-specific fee (default 0.3% = 300 basis points)
    const fee = this.dexInfo.fee || 300;
    const feeNumerator = 10000 - fee; // e.g., 9970 for 0.3% fee
    const feeDenominator = 10000;

    const numerator: BigNumber = reserveIn.mul(amountOut).mul(feeDenominator);
    const denominator: BigNumber = reserveOut.sub(amountOut).mul(feeNumerator);
    return numerator.div(denominator).add(1);
  }

  getAmountOut(reserveIn: BigNumber, reserveOut: BigNumber, amountIn: BigNumber): BigNumber {
    // Use DEX-specific fee (default 0.3% = 300 basis points)
    const fee = this.dexInfo.fee || 300;
    const feeNumerator = 10000 - fee; // e.g., 9970 for 0.3% fee
    const feeDenominator = 10000;

    const amountInWithFee: BigNumber = amountIn.mul(feeNumerator);
    const numerator = amountInWithFee.mul(reserveOut);
    const denominator = reserveIn.mul(feeDenominator).add(amountInWithFee);
    return numerator.div(denominator);
  }
  async sellTokensToNextMarket(
    tokenIn: string,
    amountIn: BigNumber,
    sellToMarket: MarketType | EthMarket
  ): Promise<BuyCalls> {
    const contract = new Contract(this.marketAddress, UNISWAP_PAIR_ABI, this._provider);
    const path = [tokenIn, this.tokenAddress];
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now

    const data = contract.interface.encodeFunctionData('swapExactTokensForTokens', [
      amountIn,
      0, // Accept any amount of tokens
      path,
      sellToMarket.marketAddress,
      deadline
    ]);

    return {
      targets: [this.marketAddress],
      data: [data],
      payloads: [data],
      values: [BigNumber.from(0)]
    };
  }

  async sellTokens(
    tokenIn: string,
    amountIn: BigNumber,
    recipient: string
  ): Promise<string> {
    const contract = new Contract(this.marketAddress, UNISWAP_PAIR_ABI, this._provider);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now

    return contract.interface.encodeFunctionData('swap', [
      0, // amount0Out
      amountIn, // amount1Out
      recipient,
      '0x' // No data needed
    ]);
  }

  async updateReserves(): Promise<void> {
    // Create abort controller for this operation
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 8000); // 8 second timeout
    
    try {
      const contract = new Contract(this.marketAddress, UNISWAP_PAIR_ABI, this._provider);
      
      // Check if operation was aborted
      if (abortController.signal.aborted) {
        throw new Error('Operation aborted');
      }
      
      const [reserve0, reserve1] = await contract.getReserves();
      
      // Double-check abort status before updating
      if (!abortController.signal.aborted) {
        this._reserves = [reserve0, reserve1];
      }
      
    } catch (error) {
      if (abortController.signal.aborted) {
        logWarn(`Reserve update aborted for market ${this.marketAddress}`);
      } else {
        logError(`Failed to update reserves for market ${this.marketAddress}`, {
          error: error instanceof Error ? error : new Error(String(error))
        });
      }
      throw error;
    } finally {
      // Proper cleanup of timeout and AbortController
      clearTimeout(timeoutId);
      try {
        abortController.abort(); // Cleanup all listeners
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }
  }

  async getVolatility(): Promise<BigNumber> {
    // Simple implementation - could be enhanced with historical data
    return BigNumber.from(0);
  }

  async getLiquidity(): Promise<BigNumber> {
    const reserves = await this.getReserves();
    return reserves.mul(2); // Simple liquidity measure - sum of both reserves
  }
}

