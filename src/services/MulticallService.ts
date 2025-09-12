import { Contract, providers, utils, BigNumber } from 'ethers';
import logger from '../utils/logger.js';

// Multicall2 ABI - only the methods we need
const MULTICALL2_ABI = [
  'function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) public view returns (tuple(bool success, bytes returnData)[])'
];

// Standard ERC20 methods we'll be calling
const TOKEN_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function totalSupply() view returns (uint256)'
];

export interface MulticallRequest {
  target: string;
  interface: utils.Interface;
  methodName: string;
  params: any[];
}

export class MulticallService {
  private multicallContract: Contract;
  private readonly MULTICALL2_ADDRESS = '0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696'; // Ethereum Mainnet
  private readonly BATCH_SIZE = 250; // Maximum number of calls to batch together
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 2000; // 2 seconds
  private readonly RATE_LIMIT_DELAY = 100; // 100ms between batches to avoid rate limiting
  private readonly CALL_TIMEOUT = 30000; // 30 second timeout
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5; // Number of consecutive failures before circuit breaker activates
  private readonly CIRCUIT_BREAKER_COOLDOWN = 60000; // 1 minute cooldown
  
  private consecutiveFailures = 0;
  private circuitBreakerActivated = false;
  private circuitBreakerResetTime = 0;

  constructor(provider: providers.Provider) {
    this.multicallContract = new Contract(
      this.MULTICALL2_ADDRESS,
      MULTICALL2_ABI,
      provider
    );
  }

  private chunkCalls(calls: MulticallRequest[]): MulticallRequest[][] {
    const chunks: MulticallRequest[][] = [];
    for (let i = 0; i < calls.length; i += this.BATCH_SIZE) {
      chunks.push(calls.slice(i, i + this.BATCH_SIZE));
    }
    return chunks;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | null = null;
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      return result;
    } finally {
      // Cleanup: clear timeout and abort controller
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      // AbortController cleanup - remove all listeners
      controller.abort(); // This will clean up internal listeners
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private checkCircuitBreaker(): void {
    const now = Date.now();
    
    if (this.circuitBreakerActivated) {
      if (now > this.circuitBreakerResetTime) {
        logger.info('Circuit breaker reset, attempting to restore service');
        this.circuitBreakerActivated = false;
        this.consecutiveFailures = 0;
      } else {
        const remainingTime = Math.ceil((this.circuitBreakerResetTime - now) / 1000);
        throw new Error(`Circuit breaker activated. Service will retry in ${remainingTime} seconds`);
      }
    }
  }

  private handleCallSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.circuitBreakerActivated) {
      logger.info('Service restored after circuit breaker activation');
      this.circuitBreakerActivated = false;
    }
  }

  private handleCallFailure(error: Error): void {
    this.consecutiveFailures++;
    
    if (this.consecutiveFailures >= this.CIRCUIT_BREAKER_THRESHOLD && !this.circuitBreakerActivated) {
      this.circuitBreakerActivated = true;
      this.circuitBreakerResetTime = Date.now() + this.CIRCUIT_BREAKER_COOLDOWN;
      logger.error(`Circuit breaker activated after ${this.consecutiveFailures} consecutive failures`, { 
        error,
        cooldownSeconds: this.CIRCUIT_BREAKER_COOLDOWN / 1000
      });
    }
  }

  public async multicall(requests: MulticallRequest[]): Promise<(any[] | null)[]> {
    // Check circuit breaker before attempting calls
    this.checkCircuitBreaker();

    if (requests.length === 0) {
      return [];
    }

    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const chunks = this.chunkCalls(requests);
        const allResults: (any[] | null)[] = [];

        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
          const chunk = chunks[chunkIndex];
          
          // Add rate limiting delay between batches
          if (chunkIndex > 0) {
            await this.delay(this.RATE_LIMIT_DELAY);
          }

          const callData = chunk.map(req => ({
            target: req.target,
            callData: req.interface.encodeFunctionData(req.methodName, req.params)
          }));

          // Execute multicall with timeout
          const results = await this.withTimeout(
            this.multicallContract.tryAggregate(false, callData),
            this.CALL_TIMEOUT
          ) as any[];

          // Process results
          for (let i = 0; i < results.length; i++) {
            const [success, returnData] = results[i];
            if (!success) {
              allResults.push(null);
              continue;
            }

            try {
              const decodedResult = chunk[i].interface.decodeFunctionResult(
                chunk[i].methodName,
                returnData
              );
              allResults.push(Array.isArray(decodedResult) ? decodedResult : [decodedResult]);
            } catch (error) {
              logger.error('Error decoding multicall result', { 
                error: error as Error,
                chunkIndex,
                callIndex: i,
                target: chunk[i].target,
                method: chunk[i].methodName
              });
              allResults.push(null);
            }
          }
        }

        // Success - reset circuit breaker state
        this.handleCallSuccess();
        return allResults;

      } catch (error) {
        lastError = error as Error;
        
        logger.error(`Multicall attempt ${attempt + 1} failed`, { 
          error: lastError,
          requestCount: requests.length,
          chunkCount: Math.ceil(requests.length / this.BATCH_SIZE),
          attempt: attempt + 1,
          maxRetries: this.MAX_RETRIES
        });

        // Don't retry on timeout or circuit breaker errors
        if (lastError.message.includes('timed out') || lastError.message.includes('Circuit breaker')) {
          break;
        }

        // Don't retry on the last attempt
        if (attempt < this.MAX_RETRIES) {
          const delay = this.RETRY_DELAY * Math.pow(2, attempt); // Exponential backoff
          logger.info(`Retrying multicall in ${delay}ms`, { attempt: attempt + 1 });
          await this.delay(delay);
        }
      }
    }

    // All attempts failed
    this.handleCallFailure(lastError!);
    
    const errorMessage = `Multicall failed after ${this.MAX_RETRIES + 1} attempts: ${lastError?.message}`;
    logger.error(errorMessage, { 
      error: lastError,
      requestCount: requests.length,
      consecutiveFailures: this.consecutiveFailures
    });
    
    throw new Error(errorMessage);
  }

  public async getTokenData(tokenAddresses: string[]): Promise<Map<string, { balance: BigNumber, totalSupply: BigNumber } | null>> {
    const requests: MulticallRequest[] = [];
    const tokenInterface = new utils.Interface(TOKEN_ABI);

    for (const address of tokenAddresses) {
      // Add balanceOf call
      requests.push({
        target: address,
        interface: tokenInterface,
        methodName: 'balanceOf',
        params: [this.MULTICALL2_ADDRESS]
      });

      // Add totalSupply call
      requests.push({
        target: address,
        interface: tokenInterface,
        methodName: 'totalSupply',
        params: []
      });
    }

    const results = await this.multicall(requests);
    const tokenData = new Map();

    for (let i = 0; i < tokenAddresses.length; i++) {
      const balanceResult = results[i * 2];
      const supplyResult = results[i * 2 + 1];

      if (!balanceResult || !supplyResult) {
        tokenData.set(tokenAddresses[i], null);
        continue;
      }

      tokenData.set(tokenAddresses[i], {
        balance: balanceResult[0],
        totalSupply: supplyResult[0]
      });
    }

    return tokenData;
  }
} 