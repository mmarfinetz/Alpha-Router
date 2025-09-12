import { providers } from 'ethers';
import { logInfo, logError, logWarn } from '../utils/logger.js';

export interface ProviderConfig {
    url: string;
    name: string;
    priority: number;
    timeout: number;
    maxRetries: number;
}

export class ProviderManager {
    private providers: Map<string, providers.StaticJsonRpcProvider> = new Map();
    private providerConfigs: ProviderConfig[];
    private currentProviderIndex: number = 0;
    private failureCount: Map<string, number> = new Map();
    private lastFailureTime: Map<string, number> = new Map();
    private readonly CIRCUIT_BREAKER_THRESHOLD = 5;
    private readonly CIRCUIT_BREAKER_TIMEOUT = 30000; // 30 seconds

    constructor(configs: ProviderConfig[]) {
        this.providerConfigs = configs.sort((a, b) => a.priority - b.priority);
        this.initializeProviders();
    }

    private initializeProviders(): void {
        for (const config of this.providerConfigs) {
            try {
                const provider = new providers.StaticJsonRpcProvider({
                    url: config.url,
                    timeout: config.timeout,
                    throttleLimit: 10,
                    throttleSlotInterval: 100
                });
                provider.pollingInterval = 5000;
                
                this.providers.set(config.name, provider);
                this.failureCount.set(config.name, 0);
                
                logInfo(`Initialized provider: ${config.name}`, {
                    url: config.url,
                    timeout: config.timeout,
                    priority: config.priority
                });
            } catch (error) {
                logError(`Failed to initialize provider: ${config.name}`, {
                    error: error instanceof Error ? error : new Error(String(error))
                });
            }
        }
    }

    async send(method: string, params: any[]): Promise<any> {
        let lastError: Error | null = null;
        
        // Try each provider in priority order
        for (const config of this.providerConfigs) {
            if (this.isProviderInCircuitBreaker(config.name)) {
                continue;
            }

            const provider = this.providers.get(config.name);
            if (!provider) continue;

            try {
                const result = await provider.send(method, params);
                this.onSuccess(config.name);
                return result;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                this.onFailure(config.name, lastError.message);
                
                logWarn(`Provider ${config.name} failed, trying next`, {
                    method,
                    error: lastError
                });
            }
        }

        // If all providers failed, throw the last error
        throw lastError || new Error('All providers failed');
    }

    async call(transaction: any, blockTag?: any): Promise<any> {
        return this.send('eth_call', [transaction, blockTag || 'latest']);
    }

    async getBlockNumber(): Promise<number> {
        const result = await this.send('eth_blockNumber', []);
        return parseInt(result, 16);
    }

    private isProviderInCircuitBreaker(providerName: string): boolean {
        const failures = this.failureCount.get(providerName) || 0;
        const lastFailure = this.lastFailureTime.get(providerName) || 0;
        
        if (failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
            const timeSinceLastFailure = Date.now() - lastFailure;
            if (timeSinceLastFailure < this.CIRCUIT_BREAKER_TIMEOUT) {
                return true;
            } else {
                // Reset circuit breaker
                this.failureCount.set(providerName, 0);
                logInfo(`Circuit breaker reset for provider: ${providerName}`);
            }
        }
        
        return false;
    }

    private onSuccess(providerName: string): void {
        this.failureCount.set(providerName, 0);
    }

    private onFailure(providerName: string, errorMessage: string): void {
        const currentFailures = this.failureCount.get(providerName) || 0;
        this.failureCount.set(providerName, currentFailures + 1);
        this.lastFailureTime.set(providerName, Date.now());
        
        if (currentFailures + 1 >= this.CIRCUIT_BREAKER_THRESHOLD) {
            logError(`Circuit breaker activated for provider: ${providerName}`, {
                failures: currentFailures + 1,
                error: new Error(errorMessage)
            });
        }
    }

    getHealthStatus(): Record<string, any> {
        const status: Record<string, any> = {};
        
        for (const config of this.providerConfigs) {
            const failures = this.failureCount.get(config.name) || 0;
            const inCircuitBreaker = this.isProviderInCircuitBreaker(config.name);
            
            status[config.name] = {
                priority: config.priority,
                failures,
                inCircuitBreaker,
                healthy: failures < this.CIRCUIT_BREAKER_THRESHOLD && !inCircuitBreaker
            };
        }
        
        return status;
    }
}

// Default provider configurations
export const DEFAULT_PROVIDER_CONFIGS: ProviderConfig[] = [
    {
        url: process.env.ETHEREUM_RPC_URL || '',
        name: 'primary',
        priority: 1,
        timeout: 8000,
        maxRetries: 2
    },
    {
        url: process.env.BACKUP_RPC_URL || 'https://mainnet.infura.io/v3/' + process.env.INFURA_API_KEY,
        name: 'infura_backup',
        priority: 2,
        timeout: 10000,
        maxRetries: 2
    },
    {
        url: 'https://rpc.ankr.com/eth',
        name: 'ankr_backup',
        priority: 3,
        timeout: 12000,
        maxRetries: 1
    }
].filter(config => config.url && config.url !== '');