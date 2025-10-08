import winston from 'winston';
import { BigNumber } from '@ethersproject/bignumber';
import { ethers } from 'ethers';
import { format } from 'winston';

// Custom format for BigNumber values
const bigNumberFormat = winston.format((info) => {
    const transformed = { ...info };
    Object.keys(transformed).forEach(key => {
        if (transformed[key] instanceof BigNumber) {
            transformed[key] = transformed[key].toString();
        }
    });
    return transformed;
});

// Create a custom format for terminal output
const terminalFormat = format.printf(({ level, message, timestamp, ...rest }) => {
    // Format timestamp for better readability
    const formattedTime = timestamp ? new Date(timestamp as string).toLocaleTimeString() : new Date().toLocaleTimeString();
    
    // Format the main log message based on level
    let formattedMessage = '';
    if (level === 'error') {
        formattedMessage = `ERROR | ${formattedTime} | ${message}`;
    } else if (level === 'warn') {
        formattedMessage = `WARN | ${formattedTime} | ${message}`;
    } else if (level === 'info') {
        formattedMessage = `INFO | ${formattedTime} | ${message}`;
    } else if (level === 'debug') {
        formattedMessage = `DEBUG | ${formattedTime} | ${message}`;
    }
    
    // Handle certain types of logs specially
    if (rest.event === 'ARBITRAGE_OPPORTUNITY') {
        formattedMessage = `OPPORTUNITY | ${formattedTime} | ${message}`;
    } else if (rest.event === 'ARBITRAGE_EXECUTION') {
        formattedMessage = `EXECUTION | ${formattedTime} | ${message}`;
    } else if (rest.event === 'CIRCUIT_BREAKER_TRIPPED') {
        formattedMessage = `CIRCUIT BREAKER | ${formattedTime} | ${message}`;
    }
    
    // Format context data in a readable way
    const contextString = formatContext(rest);
    
    return `${formattedMessage}${contextString ? '\n' + contextString : ''}`;
});

// Helper function to format context data
const formatContext = (context: any) => {
    // Skip if we have no context or it's empty
    if (!context || Object.keys(context).length === 0) {
        return '';
    }
    
    // Skip service property as it's already included in the log prefix
    const { service, ...restContext } = context;
    if (Object.keys(restContext).length === 0) {
        return '';
    }
    
    // Format specific fields for readability
    let formatted = '  ┌─ Details ──────────────────────────────────────────────────';
    
    // Format arbitrage opportunities with more detail
    if (context.event === 'ARBITRAGE_OPPORTUNITY') {
        formatted += '\n' + `  │ Buy Market: ${context.buyMarket}`;
        formatted += '\n' + `  │ Sell Market: ${context.sellMarket}`;
        
        if (context.inputAmount) {
            const formattedInput = ethers.utils.formatEther(context.inputAmount).slice(0, 10);
            formatted += '\n' + `  │ Input Amount: ${formattedInput} ETH`;
        }
        
        if (context.expectedOutput) {
            const formattedOutput = ethers.utils.formatEther(context.expectedOutput).slice(0, 10);
            formatted += '\n' + `  │ Expected Output: ${formattedOutput} ETH`;
        }
        
        if (context.profit) {
            const formattedProfit = ethers.utils.formatEther(context.profit).slice(0, 10);
            formatted += '\n' + `  │ Expected Profit: ${formattedProfit} ETH`;
        }
        
        if (context.gasUsed) {
            formatted += '\n' + `  │ Gas Used: ${context.gasUsed}`;
        }
        
        formatted += '\n' + '  └──────────────────────────────────────────────────────────';
        return formatted;
    }
    
    // Format constraint information for market analysis
    if (context.minLiquidityETH || context.minVolume24H || context.maxPriceImpact || 
        context.skippedByLiquidity !== undefined || context.skippedByImpact !== undefined) {
        
        formatted += '\n' + `  │ Constraints:`;
        
        if (context.minLiquidityETH) {
            formatted += '\n' + `  │   Min Liquidity: ${context.minLiquidityETH} ETH`;
        }
        
        if (context.minVolume24H) {
            formatted += '\n' + `  │   Min 24h Volume: ${context.minVolume24H} ETH`;
        }
        
        if (context.maxPriceImpact) {
            formatted += '\n' + `  │   Max Price Impact: ${context.maxPriceImpact}`;
        }
        
        if (context.maxSlippage) {
            formatted += '\n' + `  │   Max Slippage: ${context.maxSlippage}%`;
        }
        
        if (context.skippedByLiquidity !== undefined) {
            formatted += '\n' + `  │ Skipped Due To:`;
            formatted += '\n' + `  │   Low Liquidity: ${context.skippedByLiquidity}`;
        }
        
        if (context.skippedByWeth !== undefined) {
            formatted += '\n' + `  │   No WETH: ${context.skippedByWeth}`;
        }
        
        if (context.skippedByImpact !== undefined) {
            formatted += '\n' + `  │   High Impact: ${context.skippedByImpact}`;
        }
        
        if (context.skippedByError !== undefined) {
            formatted += '\n' + `  │   Errors: ${context.skippedByError}`;
        }
        
        if (context.validPairsFound !== undefined && context.totalProcessed !== undefined) {
            const successRate = ((context.validPairsFound / context.totalProcessed) * 100).toFixed(2);
            formatted += '\n' + `  │ Filter Success Rate: ${successRate}% (${context.validPairsFound}/${context.totalProcessed})`;
        }
        
        formatted += '\n' + '  └──────────────────────────────────────────────────────────';
        return formatted;
    }
    
    // Handle gas price information
    if (context.current || context.average || context.competing || context.adjustedGasPrice) {
        formatted += '\n' + `  │ Gas Prices (Gwei):`;
        
        if (context.current) {
            formatted += '\n' + `  │   Current: ${context.current}`;
        }
        
        if (context.average) {
            formatted += '\n' + `  │   Average: ${context.average}`;
        }
        
        if (context.competing) {
            formatted += '\n' + `  │   Competing: ${context.competing}`;
        }
        
        if (context.adjustedGasPrice) {
            formatted += '\n' + `  │   Adjusted: ${context.adjustedGasPrice}`;
        }
        
        formatted += '\n' + '  └──────────────────────────────────────────────────────────';
        return formatted;
    }
    
    // For other types of logs, format key-value pairs in a readable way
    Object.entries(restContext).forEach(([key, value]) => {
        // Skip the event property as we already used it
        if (key === 'event') return;
        
        // Format the value based on type
        let formattedValue = value;
        if (typeof value === 'object' && value !== null) {
            if (value instanceof Error) {
                formattedValue = value.message;
            } else {
                try {
                    formattedValue = JSON.stringify(value, null, 2);
                } catch (e) {
                    formattedValue = '[Complex Object]';
                }
            }
        }
        
        formatted += '\n' + `  │ ${key}: ${formattedValue}`;
    });
    
    formatted += '\n' + '  └──────────────────────────────────────────────────────────';
    return formatted;
};

// Create logger instance
const transports: winston.transport[] = [
    // Console transport with custom format (always enabled)
    new winston.transports.Console({
        format: winston.format.combine(
            winston.format.timestamp(),
            terminalFormat
        )
    })
];

// Only add file transports in non-production environments
// In production (Railway, Docker, etc.), logs go to stdout and are captured by the platform
if (process.env.NODE_ENV !== 'production') {
    transports.push(
        // File transport for error logs
        new winston.transports.File({
            filename: 'error.log',
            level: 'error'
        }),
        // File transport for all logs
        new winston.transports.File({
            filename: 'combined.log'
        })
    );
}

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        bigNumberFormat(),
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'mev-arbitrage-bot' },
    transports
});

// Add additional constraint information to the existing LogContext interface
export interface LogContext {
    txHash?: string;
    blockNumber?: number;
    marketAddress?: string;
    tokenAddress?: string;
    profit?: BigNumber;
    gasPrice?: BigNumber;
    error?: Error;
    // Additional properties for WebSocket and market monitoring
    url?: string;
    wsUrl?: string;
    rpcUrl?: string;
    pollingInterval?: number;
    searcherAddress?: string;
    totalMarkets?: number;
    minLiquidityETH?: string;
    minVolume24H?: string;
    maxPriceImpact?: string;
    // Provider and performance metrics
    timeout?: number;
    providersConfigured?: number;
    batchServiceEnabled?: boolean;
    priority?: number;
    failures?: number;
    // Performance monitoring
    requestCount?: number;
    timeoutRate?: string;
    avgResponseTime?: string;
    p95ResponseTime?: string;
    timespan?: string;
    recommendations?: string;
    maxPairsPerToken?: number;
    pairCount?: number;
    updatedPairCount?: number;
    attempt?: number;
    maxAttempts?: number;
    // Algorithm constraints (new or enhanced)
    maxSlippage?: string;            // Maximum allowed slippage percentage
    minProfitThreshold?: string;     // Minimum profit required to execute
    maxGasPrice?: string;            // Maximum gas price willing to pay
    gasOptimizationStrategy?: string; // Description of gas strategy
    maxPositionSize?: string;        // Maximum position size in ETH
    minimumReserveRatio?: string;    // Minimum reserve ratio for safety
    // Batch processing properties
    failedCount?: number;
    batchIndex?: number;
    // Additional properties for WebSocket events
    rpcCallTimeout?: string;         // RPC call timeout setting
    // DEX-specific properties
    dexName?: string;                // Name of the DEX being analyzed
    factoryAddress?: string;         // Factory address for the DEX
    progress?: string;               // Progress percentage
    consecutiveFailures?: number;    // Number of consecutive failures
    totalErrors?: number;            // Total error count
    errorType?: string;              // Type/message of error
    successRate?: string;            // Success rate percentage
    remaining?: number;              // Remaining items to process
    validResults?: number;           // Number of valid results in batch
    processedSoFar?: number;         // Items processed so far
    circuitBreakerTriggered?: boolean; // Whether circuit breaker was triggered
    finalBatchSize?: number;         // Final batch size used
    message?: any;
    event?: any;
    maxProfit?: string;
    subscriptionTypes?: string[];
    dexAddresses?: string[];
    method?: string;
    id?: number | string;
    params?: any;
    data?: string;
    code?: number;
    reason?: string;
    readyState?: number;
    eventType?: string;
    timestamp?: number;
    result?: any;
    // Additional properties for optimization and calculations
    iteration?: number;
    deltaPlus?: number;
    deltaMinus?: number;
    objectiveFunctionResult?: number;
    penaltyResult?: number;
    finalNu?: number;
    finalPsi?: number;
    // Market analysis properties - removed duplicate factoryAddress
    totalPairs?: number;
    batchSize?: number;
    concurrentRequests?: number;
    batch?: number;
    startIndex?: number;
    endIndex?: number;
    pairArray?: any;
    token0?: string;
    token1?: string;
    pairAddress?: string;
    totalLiquidity?: string;
    minRequired?: string;
    wethBalance?: string;
    priceImpact?: string;
    retry?: number;
    processed?: number;
    total?: string | number;
    validPairs?: number;
    skippedByLiquidity?: number;
    skippedByWeth?: number;
    skippedByImpact?: number;
    skippedByError?: number;
    totalProcessed?: number;
    validPairsFound?: number;
    totalSkipped?: number;
    // Additional properties for market analysis
    thresholds?: {
        minLiquidity: string;
        minVolume: string;
        minMarketCap: string;
        maxPairs: number;
    };
    filteredMarkets?: number;
    count?: number;
    adjustedGasPrice?: string;
    bundleHash?: string;
    current?: string;
    average?: string;
    competing?: string;
    optimalVolume?: string;
    retries?: number;
    duration?: number;
    address?: string;
    marketCount?: number;
    factoryCount?: number;
    totalTokens?: number;
    averagePairsPerToken?: number;
    monitoredPairs?: number;
    updateInterval?: string;
    wsEnabled?: boolean;
    tradingFunctionResult?: string;
    tradingFunctionResult2?: string;
    bundleGas?: string;
    isValid?: boolean;
    gasPrices?: string[];
}

// Enhanced logging functions with more constraint information
export const logInfo = (message: string, context: LogContext = {}) => {
    logger.info(message, context);
};

export const logError = (message: string, context: LogContext = {}) => {
    logger.error(message, context);
};

export const logWarn = (message: string, context: LogContext = {}) => {
    logger.warn(message, context);
};

export const logDebug = (message: string, context: LogContext = {}) => {
    logger.debug(message, context);
};

// New specialized logging functions for constraints
export const logConstraints = (message: string, context: LogContext & {
    minLiquidityETH: string;
    minVolume24H: string;
    maxPriceImpact: string;
    maxSlippage: string;
    minProfitThreshold: string;
    maxGasPrice: string;
    gasOptimizationStrategy: string;
    maxPositionSize?: string;
}) => {
    logger.info(`Algorithm Constraints: ${message}`, {
        ...context,
        event: 'ALGORITHM_CONSTRAINTS'
    });
};

// Circuit breaker events
export const logCircuitBreakerTripped = (reason: string, context: LogContext = {}) => {
    logger.error(`Circuit breaker tripped: ${reason}`, {
        ...context,
        event: 'CIRCUIT_BREAKER_TRIPPED'
    });
};

// Enhanced arbitrage opportunity logging
export const logArbitrageOpportunity = (context: LogContext & {
    buyMarket: string;
    sellMarket: string;
    inputAmount: BigNumber;
    expectedOutput: BigNumber;
    expectedProfit?: BigNumber;
    priceImpact?: string;
    gasEstimate?: string;
    netProfitAfterGas?: BigNumber;
    slippage?: string;
    routeDescription?: string;
}) => {
    logger.info('Arbitrage opportunity found', {
        ...context,
        event: 'ARBITRAGE_OPPORTUNITY'
    });
};

// Enhanced execution logging
export const logArbitrageExecution = (context: LogContext & {
    status: 'success' | 'failure';
    gasUsed?: BigNumber;
    actualProfit?: BigNumber;
    txHash?: string;
    executionTime?: number; // milliseconds
    errorReason?: string;
    blockNumber?: number;
}) => {
    logger.info('Arbitrage execution completed', {
        ...context,
        event: 'ARBITRAGE_EXECUTION'
    });
};

// MEV-Share events
export const logMevShareEvent = (event: string, context: LogContext = {}) => {
    logger.info(`MEV-Share event: ${event}`, {
        ...context,
        event: 'MEV_SHARE'
    });
};

// Enhanced market stats logging
export const logMarketStats = (context: LogContext & {
    totalMarkets: number;
    filteredMarkets: number;
    minLiquidityETH: string;
    minVolume24H: string;
    maxPriceImpact: string;
    skippedByLiquidity: number;
    skippedByWeth: number;
    skippedByImpact: number;
    skippedByError: number;
    validPairsFound: number;
    totalProcessed: number;
}) => {
    logger.info('Market statistics', {
        ...context,
        event: 'MARKET_STATS'
    });
};

export default logger; 