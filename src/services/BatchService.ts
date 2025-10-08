import { BigNumber, Contract } from 'ethers';
import { UNISWAP_PAIR_ABI } from '../abi';
import { ProviderManager } from './ProviderManager';
import { logInfo, logError, logDebug } from '../utils/logger';

export interface BatchedReserveRequest {
    pairAddress: string;
    tokenAddress?: string;
    requestId: string;
}

export interface CachedReserveData {
    reserves: [BigNumber, BigNumber];
    timestamp: number;
    blockNumber: number;
}

export class BatchService {
    private providerManager: ProviderManager;
    private cache: Map<string, CachedReserveData> = new Map();
    private readonly CACHE_TTL = 5000; // 5 seconds cache
    private readonly BATCH_SIZE = 50; // Process 50 pairs at once
    private readonly BATCH_DELAY = 100; // 100ms delay between batches
    private pendingBatches: Map<string, Promise<any>> = new Map();

    constructor(providerManager: ProviderManager) {
        this.providerManager = providerManager;
    }

    async getReservesBatch(requests: BatchedReserveRequest[]): Promise<Map<string, [BigNumber, BigNumber]>> {
        const results = new Map<string, [BigNumber, BigNumber]>();
        const uncachedRequests: BatchedReserveRequest[] = [];
        
        // Check cache first
        for (const request of requests) {
            const cached = this.getCachedReserves(request.pairAddress);
            if (cached) {
                results.set(request.pairAddress, cached.reserves);
                logDebug(`Cache hit for pair: ${request.pairAddress}`);
            } else {
                uncachedRequests.push(request);
            }
        }

        if (uncachedRequests.length === 0) {
            return results;
        }

        // Process uncached requests in batches
        const batches = this.chunkArray(uncachedRequests, this.BATCH_SIZE);
        
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            
            try {
                const batchResults = await this.processBatch(batch);
                
                // Merge results
                for (const [pairAddress, reserves] of batchResults) {
                    results.set(pairAddress, reserves);
                }
                
                // Add delay between batches to avoid overwhelming the provider
                if (i < batches.length - 1) {
                    await this.delay(this.BATCH_DELAY);
                }
                
            } catch (error) {
                logError(`Failed to process batch ${i + 1}/${batches.length}`, {
                    error: error instanceof Error ? error : new Error(String(error)),
                    batchSize: batch.length
                });
                
                // Process individually on batch failure
                for (const request of batch) {
                    try {
                        const reserves = await this.getSingleReserves(request.pairAddress);
                        results.set(request.pairAddress, reserves);
                    } catch (singleError) {
                        logError(`Failed to get reserves for ${request.pairAddress}`, {
                            error: singleError instanceof Error ? singleError : new Error(String(singleError))
                        });
                    }
                }
            }
        }

        return results;
    }

    private async processBatch(batch: BatchedReserveRequest[]): Promise<Map<string, [BigNumber, BigNumber]>> {
        const results = new Map<string, [BigNumber, BigNumber]>();
        
        // Create multicall-style batch request
        const calls = batch.map(request => ({
            target: request.pairAddress,
            callData: this.encodeGetReservesCall()
        }));

        try {
            // Use concurrent individual calls since we don't have multicall contract
            const promises = batch.map(request => 
                this.getSingleReservesWithRetry(request.pairAddress, 2)
            );
            
            const batchResults = await Promise.allSettled(promises);
            
            for (let i = 0; i < batchResults.length; i++) {
                const result = batchResults[i];
                const request = batch[i];
                
                if (result.status === 'fulfilled') {
                    results.set(request.pairAddress, result.value);
                    this.cacheReserves(request.pairAddress, result.value);
                } else {
                    logError(`Failed to get reserves for ${request.pairAddress}`, {
                        error: result.reason
                    });
                }
            }
            
        } catch (error) {
            logError('Batch processing failed', {
                error: error instanceof Error ? error : new Error(String(error)),
                batchSize: batch.length
            });
            throw error;
        }

        return results;
    }

    private async getSingleReserves(pairAddress: string): Promise<[BigNumber, BigNumber]> {
        // Check if there's already a pending request for this pair
        const pendingKey = `reserves_${pairAddress}`;
        if (this.pendingBatches.has(pendingKey)) {
            return await this.pendingBatches.get(pendingKey)!;
        }

        // Create new request
        const promise = this.getSingleReservesWithRetry(pairAddress, 2);
        this.pendingBatches.set(pendingKey, promise);
        
        try {
            const result = await promise;
            this.cacheReserves(pairAddress, result);
            return result;
        } finally {
            this.pendingBatches.delete(pendingKey);
        }
    }

    private async getSingleReservesWithRetry(pairAddress: string, maxRetries: number): Promise<[BigNumber, BigNumber]> {
        let lastError: Error | null = null;
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const callData = this.encodeGetReservesCall();
                const result = await this.providerManager.call({
                    to: pairAddress,
                    data: callData
                });
                
                // Decode the result (reserves are returned as [reserve0, reserve1, blockTimestampLast])
                const decoded = this.decodeGetReservesResult(result);
                return [decoded[0], decoded[1]];
                
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                
                if (attempt < maxRetries) {
                    await this.delay(Math.pow(2, attempt) * 1000); // Exponential backoff
                    logDebug(`Retrying getReserves for ${pairAddress}, attempt ${attempt + 1}/${maxRetries + 1}`);
                }
            }
        }
        
        throw lastError || new Error('Max retries exceeded');
    }

    private encodeGetReservesCall(): string {
        // getReserves() function selector: 0x0902f1ac
        return '0x0902f1ac';
    }

    private decodeGetReservesResult(result: string): [BigNumber, BigNumber, BigNumber] {
        // Remove 0x prefix and decode 32-byte chunks
        const clean = result.slice(2);
        const reserve0 = BigNumber.from('0x' + clean.slice(0, 64));
        const reserve1 = BigNumber.from('0x' + clean.slice(64, 128));
        const blockTimestampLast = BigNumber.from('0x' + clean.slice(128, 192));
        
        return [reserve0, reserve1, blockTimestampLast];
    }

    private getCachedReserves(pairAddress: string): CachedReserveData | null {
        const cached = this.cache.get(pairAddress);
        if (!cached) return null;
        
        const age = Date.now() - cached.timestamp;
        if (age > this.CACHE_TTL) {
            this.cache.delete(pairAddress);
            return null;
        }
        
        return cached;
    }

    private cacheReserves(pairAddress: string, reserves: [BigNumber, BigNumber]): void {
        this.cache.set(pairAddress, {
            reserves,
            timestamp: Date.now(),
            blockNumber: 0 // Will be updated with actual block number in production
        });
    }

    private chunkArray<T>(array: T[], chunkSize: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Cache management methods
    clearCache(): void {
        this.cache.clear();
        logInfo('Reserve cache cleared');
    }

    getCacheStats(): { size: number; entries: string[] } {
        return {
            size: this.cache.size,
            entries: Array.from(this.cache.keys())
        };
    }

    // Preload reserves for known pairs
    async preloadReserves(pairAddresses: string[]): Promise<void> {
        logInfo(`Preloading reserves for ${pairAddresses.length} pairs`);
        
        const requests: BatchedReserveRequest[] = pairAddresses.map((address, index) => ({
            pairAddress: address,
            requestId: `preload_${index}`
        }));
        
        try {
            await this.getReservesBatch(requests);
            logInfo(`Successfully preloaded reserves for ${requests.length} pairs`);
        } catch (error) {
            logError('Failed to preload reserves', {
                error: error instanceof Error ? error : new Error(String(error))
            });
        }
    }
}