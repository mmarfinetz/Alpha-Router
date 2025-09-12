import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { Contract, providers, Wallet } from "ethers";
import { ProviderManager, DEFAULT_PROVIDER_CONFIGS } from "./services/ProviderManager.js";
import { BatchService } from "./services/BatchService.js";
import { BUNDLE_EXECUTOR_ABI } from "./abi.js";
import { UniswapV2EthPair } from "./UniswapV2EthPair.js";
import { FACTORY_ADDRESSES } from "./addresses.js";
import { WETH_ADDRESS } from "./addresses.js";
import { Arbitrage } from "./Arbitrage.js";
import { getDefaultRelaySigningKey } from "./utils.js";
import { EnhancedWebSocketManager } from './websocketmanager.js';
import { DEFAULT_THRESHOLDS } from './config/thresholds.js';
import { DEFAULT_CONFIG } from './config/config.js';
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { flattenArray } from "./utils.js";
import { MarketsByToken } from './types.js';
import { CircuitBreaker } from './utils/CircuitBreaker.js';
import { GasPriceManager } from './utils/GasPriceManager.js';
import { logInfo, logError, logDebug, logWarn, logConstraints } from './utils/logger.js';
dotenv.config();

console.log("Starting WebSocket version of MEV bot...");

// Environment variables and configuration
const ETHEREUM_WS_URL = (process.env.ALCHEMY_WEBSOCKET_URL || process.env.ETHEREUM_WS_URL) as string;

if (!ETHEREUM_WS_URL || typeof ETHEREUM_WS_URL !== 'string' || !ETHEREUM_WS_URL.startsWith('wss://')) {
    logError("Error: Invalid or missing WebSocket URL. Please set ALCHEMY_WEBSOCKET_URL or ETHEREUM_WS_URL in your environment variables. URL must start with 'wss://'.");
    process.exit(1);
}

// Fallback RPC URL if ETHEREUM_RPC_URL is not provided
let ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL;
if (!ETHEREUM_RPC_URL) {
    ETHEREUM_RPC_URL = ETHEREUM_WS_URL.replace('wss://', 'https://');
    logInfo('Derived RPC URL from WebSocket URL', { url: ETHEREUM_RPC_URL });
}

logInfo('WebSocket configuration', { 
    wsUrl: ETHEREUM_WS_URL,
    rpcUrl: ETHEREUM_RPC_URL 
});

const PRIVATE_KEY = process.env.PRIVATE_KEY || getDefaultRelaySigningKey();
const BUNDLE_EXECUTOR_ADDRESS = process.env.BUNDLE_EXECUTOR_ADDRESS || "";
const FLASHBOTS_RELAY_SIGNING_KEY = process.env.FLASHBOTS_RELAY_SIGNING_KEY || getDefaultRelaySigningKey();
const MINER_REWARD_PERCENTAGE = parseInt(process.env.MINER_REWARD_PERCENTAGE || "90");

// Circuit breaker configuration
const circuitBreakerConfig = {
    maxFailures: 3,
    resetTimeoutMs: 60000, // 1 minute
    cooldownPeriodMs: 300000 // 5 minutes
};

if (PRIVATE_KEY === "") {
    console.error("Error: Must provide PRIVATE_KEY environment variable");
    process.exit(1);
}

if (BUNDLE_EXECUTOR_ADDRESS === "") {
    console.error("Error: Must provide BUNDLE_EXECUTOR_ADDRESS environment variable");
    process.exit(1);
}

// Add global unhandled exception handlers
process.on('uncaughtException', (error) => {
  logError(`Uncaught Exception: ${error.message}`, { 
    error: error instanceof Error ? error : new Error(String(error)),
  });
  // Don't exit the process, let it continue
});

process.on('unhandledRejection', (reason, promise) => {
  logError(`Unhandled Rejection at: ${promise}, reason: ${reason}`, {
  });
  // Don't exit the process, let it continue
});

// Add graceful shutdown handling
process.on('SIGINT', async () => {
    logInfo('Received SIGINT - starting graceful shutdown...');
    // Will be set up in main function
});

process.on('SIGTERM', async () => {
    logInfo('Received SIGTERM - starting graceful shutdown...');
    // Will be set up in main function
});

// Add memory monitoring
const logMemoryUsage = () => {
  const used = process.memoryUsage();
  const memUsage = {
    rss: `${Math.round(used.rss / 1024 / 1024)} MB`,
    heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)} MB`,
    heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)} MB`,
    external: `${Math.round(used.external / 1024 / 1024)} MB`,
  };
  logInfo('Memory usage', { });
};

// Log memory usage every 5 minutes
setInterval(logMemoryUsage, 5 * 60 * 1000);

async function main() {
    logInfo("Starting MEV searcher with WebSocket...");
    
    try {
        // Initialize HTTP provider for standard JSON-RPC calls with optimized timeouts
        logInfo('Initializing HTTP Provider...');
        const provider = new providers.StaticJsonRpcProvider({
            url: ETHEREUM_RPC_URL!,
            timeout: 10000, // 10 seconds instead of default 120s
            throttleLimit: 10, // Limit concurrent requests
            throttleSlotInterval: 100 // 100ms between requests
        });
        provider.pollingInterval = 5000; // 5 seconds for faster block detection
        logInfo('HTTP Provider initialized with optimized timeouts', { 
            url: ETHEREUM_RPC_URL || 'Not configured',
            timeout: 10000,
            pollingInterval: provider.pollingInterval 
        });

        // Initialize wallets
        const arbitrageSigningWallet = new Wallet(PRIVATE_KEY);
        const flashbotsRelaySigningWallet = new Wallet(FLASHBOTS_RELAY_SIGNING_KEY);
        logInfo('Wallets initialized', {
            searcherAddress: await arbitrageSigningWallet.getAddress()
        });
    
        // Initialize Flashbots provider
        const flashbotsProvider = await FlashbotsBundleProvider.create(
            provider, 
            flashbotsRelaySigningWallet
        );
        logInfo('Flashbots provider initialized');

        // Initialize circuit breaker and gas price manager
        const circuitBreaker = new CircuitBreaker(circuitBreakerConfig);
        const gasPriceManager = new GasPriceManager(provider);

        // Display detailed algorithm constraints
        logConstraints("Bot is starting with the following parameters", {
            minLiquidityETH: ethers.utils.formatEther(DEFAULT_THRESHOLDS.MIN_LIQUIDITY_ETH),
            minVolume24H: ethers.utils.formatEther(DEFAULT_THRESHOLDS.MIN_VOLUME_24H),
            maxPriceImpact: "1%",
            maxSlippage: "0.5%",
            minProfitThreshold: ethers.utils.formatEther(DEFAULT_THRESHOLDS.minProfitThreshold || ethers.utils.parseEther("0.01")),
            maxGasPrice: process.env.MAX_GAS_PRICE || "Auto (dynamic)",
            gasOptimizationStrategy: "Dynamic adjustment based on network conditions and profit opportunity",
            maxPositionSize: process.env.MAX_POSITION_SIZE || "Auto (based on liquidity)"
        });

        // Initialize enhanced provider manager and batch service
        const providerManager = new ProviderManager(DEFAULT_PROVIDER_CONFIGS);
        const batchService = new BatchService(providerManager);
        
        logInfo('Enhanced services initialized', {
            providersConfigured: DEFAULT_PROVIDER_CONFIGS.length,
            batchServiceEnabled: true
        });

        // Initialize arbitrage instance
        const arbitrage = new Arbitrage(
            arbitrageSigningWallet,
            provider,
            new Contract(BUNDLE_EXECUTOR_ADDRESS, BUNDLE_EXECUTOR_ABI, provider),
            DEFAULT_THRESHOLDS,
            circuitBreaker,
            gasPriceManager
        );
        logInfo('Arbitrage instance initialized');

        // Get initial markets
        logInfo('Fetching initial markets...');
        const markets = await UniswapV2EthPair.getUniswapMarketsByToken(
            provider,
            FACTORY_ADDRESSES,
            UniswapV2EthPair.impactAndFeeFuncs
        );
        
        // Display detailed market analysis parameters
        logInfo('Initial markets before filtering', {
            totalMarkets: flattenArray(Object.values(markets.marketsByToken)).length,
            minLiquidityETH: ethers.utils.formatEther(DEFAULT_THRESHOLDS.MIN_LIQUIDITY_ETH),
            minVolume24H: ethers.utils.formatEther(DEFAULT_THRESHOLDS.MIN_VOLUME_24H),
            maxPriceImpact: '1%',
            maxPairsPerToken: DEFAULT_THRESHOLDS.MAX_PAIRS
        });

        // Update reserves using multicall for efficiency
        if (markets.allMarketPairs.length > 0) {
            logInfo(`Starting reserve updates for pre-filtered pairs`, { 
                pairCount: markets.allMarketPairs.length 
            });
            
            const updatedPairs = await UniswapV2EthPair.updateReserves(
                provider,
                markets.allMarketPairs,
                WETH_ADDRESS
            );
            
            const validUpdatedPairs = updatedPairs.filter((pair): pair is UniswapV2EthPair => pair !== undefined);
            
            if (validUpdatedPairs.length === 0) {
                logWarn('No pairs were successfully updated - continuing with original pairs');
                // Keep original pairs if update failed completely
            } else {
                markets.allMarketPairs = validUpdatedPairs;
                logInfo(`Successfully updated reserves`, { 
                    pairCount: validUpdatedPairs.length
                });
            }
        } else {
            logWarn('No market pairs found for reserve updates');
        }

        // Initialize WebSocket manager
        logInfo('Initializing WebSocket manager...');
        const wsManager = new EnhancedWebSocketManager(
            ETHEREUM_WS_URL,
            DEFAULT_CONFIG,
            arbitrage,
            markets.marketsByToken as unknown as MarketsByToken
        );

        // Connect to WebSocket and start real-time monitoring
        logInfo('PHASE 2: Connecting to WebSocket for real-time monitoring...');
        await wsManager.connect();
        logInfo('✅ WebSocket connected successfully - real-time monitoring ACTIVE');

        // Set up graceful shutdown handlers
        const gracefulShutdown = async () => {
            logInfo('Starting graceful shutdown...');
            try {
                await wsManager.disconnect();
                logInfo('WebSocket manager disconnected');
                process.exit(0);
            } catch (error) {
                logError('Error during shutdown', { error: error as Error });
                process.exit(1);
            }
        };
        
        process.removeAllListeners('SIGINT');
        process.removeAllListeners('SIGTERM');
        process.on('SIGINT', gracefulShutdown);
        process.on('SIGTERM', gracefulShutdown);
        
        logInfo("🚀 WebSocket MEV bot initialization COMPLETE!");
        logInfo("⚡ TRANSITIONING TO ACTIVE TRADING MODE - Bot is now monitoring for arbitrage opportunities");

        // Print final startup summary
        logInfo('═'.repeat(80));
        logInfo('🎯 MEV BOT STARTUP COMPLETE - MARKET DISCOVERY FINISHED');
        logInfo('═'.repeat(80));
        logInfo(`📊 DISCOVERY PHASE COMPLETE - Found ${flattenArray(Object.values(markets.marketsByToken)).length} total markets, ${markets.allMarketPairs.length} active pairs`);
        logInfo('⚡ ACTIVE TRADING PHASE: Coordinated evaluation every 30s, WebSocket events active, health monitoring every 2 blocks');
        logInfo('🔧 ENHANCED FEATURES: Memory leak protection, operation deduplication, graceful shutdown');
        logInfo('═'.repeat(80));

        // Coordinated operation manager to prevent conflicts
        const operationManager = {
            isRunning: false,
            lastUpdate: 0,
            MIN_INTERVAL: 10000, // Minimum 10 seconds between updates
            
            async runCoordinatedUpdate(source: string) {
                const now = Date.now();
                if (this.isRunning || (now - this.lastUpdate) < this.MIN_INTERVAL) {
                    logDebug(`Skipping ${source} update - operation in progress or too soon`);
                    return;
                }
                
                this.isRunning = true;
                this.lastUpdate = now;
                
                try {
                    logDebug(`Running coordinated update from ${source}...`);
                    
                    // Check WebSocket health before proceeding with operations
                    if (!wsManager.isHealthyForTrading()) {
                        const metrics = wsManager.getHealthMetrics();
                        logWarn(`Skipping ${source} update - WebSocket connection unhealthy`, {
                            error: new Error(`Connected: ${metrics.isConnected}, Healthy: ${metrics.isHealthyForTrading}`)
                        });
                        return;
                    }
                    
                    // Update reserves first
                    if (markets.allMarketPairs.length > 0) {
                        const updatedPairs = await UniswapV2EthPair.updateReserves(
                            provider, 
                            markets.allMarketPairs,
                            WETH_ADDRESS
                        );
                        markets.allMarketPairs = updatedPairs.filter((pair): pair is UniswapV2EthPair => pair !== undefined);
                    }

                    // Evaluate markets for arbitrage opportunities
                    const opportunities = await arbitrage.evaluateMarkets(markets.marketsByToken);
                    
                    if (opportunities.length > 0) {
                        logInfo(`💰 Found ${opportunities.length} arbitrage opportunities from ${source} - Max profit: ${opportunities[0].profit.toString()} wei`);
                        
                        // Get current block and attempt execution
                        const currentBlock = await provider.getBlockNumber();
                        await arbitrage.takeCrossedMarkets(opportunities, currentBlock, 3);
                    } else {
                        logDebug(`No arbitrage opportunities found from ${source}`);
                    }
                    
                } catch (error: any) {
                    logError(`Error in coordinated update from ${source}`, { 
                        error: error instanceof Error ? error : new Error(error?.message || String(error))
                    });
                } finally {
                    this.isRunning = false;
                }
            }
        };

        // Continuous arbitrage evaluation loop - coordinated with WebSocket events
        logInfo('🔄 Starting coordinated arbitrage evaluation loop...');
        setInterval(async () => {
            await operationManager.runCoordinatedUpdate('periodic');
        }, 30000); // Every 30 seconds for active scanning

        // Expose operation manager to WebSocket manager for coordination
        (wsManager as any).operationManager = operationManager;
        
        // Light periodic health check (no heavy operations)
        setInterval(async () => {
            try {
                const status = wsManager.getOperationStatus();
                logDebug('System health check');
                
                // Force garbage collection if available
                if (global.gc) {
                    global.gc();
                }
                
            } catch (error: any) {
                logError('Error in health check', { 
                    error: error instanceof Error ? error : new Error(error?.message || String(error))
                });
            }
        }, DEFAULT_CONFIG.NETWORK.BLOCK_TIME * 1000 * 2); // Every 2 blocks for health monitoring

    } catch (error: any) {
        logError('Error initializing WebSocket searcher', { error: error as Error });
        process.exit(1);
    }
}

main().catch((error: any) => {
    logError('Unhandled error in main', { 
        error: error instanceof Error ? error : new Error(error?.message || String(error))
    });
    process.exit(1);
});
