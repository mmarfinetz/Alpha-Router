import { WebSocket } from 'ws';
import { BigNumber } from '@ethersproject/bignumber';
import { Arbitrage } from './Arbitrage';
import { UniswapV2EthPair } from './UniswapV2EthPair';
import * as dotenv from "dotenv";
import axios from 'axios';
import { MarketsByToken } from './types';
import { Config } from './config/config';
import { logInfo, logError, logDebug, logWarn } from './utils/logger';
import { EventEmitter } from 'events';
dotenv.config();

// Increase max listeners to prevent memory leak warnings during batch operations
EventEmitter.defaultMaxListeners = 100; // Increased to handle batch operations
process.setMaxListeners(100); // Also set process max listeners

// Function to send updates to the frontend server
async function sendUpdate(eventName: string, data: any) {
    try {
        await axios.post('http://localhost:3001/update', {
            eventName,
            data
        });
    } catch (error: any) {
        logError('Failed to send update to frontend', { 
            error: error instanceof Error ? error : new Error(error?.message || String(error))
        });
    }
}

export interface SubscriptionConfig {
    DEX_ADDRESSES: string[];
    TRANSFER_TOPIC: string;
    SWAP_TOPIC: string;
}

export class EnhancedWebSocketManager extends EventEmitter {
    private ws: WebSocket | null = null;
    private url: string;
    private rpcUrl: string = '';
    public isConnected: boolean = false;
    private reconnectAttempts: number = 0;
    private readonly MAX_RECONNECT_ATTEMPTS = 10;
    private readonly RECONNECT_DELAY = 5000; // 5 seconds, increasing with backoff
    private reconnectTimer: NodeJS.Timeout | null = null;
    private pingInterval: NodeJS.Timeout | null = null;
    private subscriptions: Map<string, { id: string, params: any }> = new Map();
    private pendingRequests: Map<string, { resolve: Function, reject: Function, timestamp: number }> = new Map();
    private readonly REQUEST_TIMEOUT = 10000; // 10 seconds for MEV operations
    private nextId: number = 1;
    
    // Health monitoring and circuit breaker properties
    private lastSuccessfulPing: number = Date.now();
    private lastBlockReceived: number = Date.now();
    private consecutiveFailures: number = 0;
    private readonly MAX_CONSECUTIVE_FAILURES = 3;
    private readonly STALE_DATA_THRESHOLD = 60000; // 1 minute
    private readonly PING_FAILURE_THRESHOLD = 120000; // 2 minutes
    private config: Config;
    private arbitrage: Arbitrage;
    private marketsByToken: MarketsByToken;
    private metrics: any = {};
    private timeoutChecker: NodeJS.Timeout | null = null;
    private operationLocks: Set<string> = new Set(); // Prevent duplicate operations
    private abortControllers: Map<string, AbortController> = new Map(); // Track abort controllers
    public operationManager: any = null; // Will be injected by main process

    constructor(
        wsUrl: string,
        config: Config,
        arbitrage: Arbitrage,
        marketsByToken: MarketsByToken
    ) {
        super();
        this.url = wsUrl;
        this.rpcUrl = wsUrl;
        this.config = config;
        this.arbitrage = arbitrage;
        this.marketsByToken = marketsByToken;
        logInfo('WebSocket configuration', { wsUrl });
    }

    /**
     * Connect to the WebSocket server with automatic reconnection
     */
    public async connect(): Promise<void> {
        if (this.isConnected) {
            logInfo('WebSocket already connected');
            return;
        }

        logInfo('Connecting to WebSocket server', { url: this.url });
        
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.url);
                
                // Set up a connection timeout
                const connectionTimeout = setTimeout(() => {
                    if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
                        logError('WebSocket connection timeout');
                        this.ws.close();
                        reject(new Error('WebSocket connection timeout'));
                    }
                }, 15000); // 15 second timeout
                
                // Set up event handlers
                this.ws.onopen = () => {
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    logInfo('WebSocket connected successfully');
                    
                    // Set up ping interval to keep connection alive
                    this.setupPingInterval();
                    
                    // Resubscribe to previous subscriptions
                    this.resubscribeAll().catch(this.handleError.bind(this));
                    
                    // Start the request timeout checker
                    this.startRequestTimeoutChecker();
                    
                    // Subscribe to events
                    this.subscribeToEvents();
                    
                    // Resolve the promise
                    clearTimeout(connectionTimeout);
                    resolve();
                    
                    // Emit connected event
                    this.emit('connected');
                };
                
                this.ws.onclose = (event) => {
                    clearTimeout(connectionTimeout);
                    this.isConnected = false;
                    logWarn(`WebSocket connection closed: ${event.code} - ${event.reason}`);
                    
                    this.cleanup();
                    
                    // Schedule a reconnect attempt if not triggered manually
                    if (event.code !== 1000) {
                        this.scheduleReconnect();
                    }
                    
                    // Only reject if still waiting for connection
                    if (!this.isConnected) {
                        reject(new Error(`WebSocket connection closed: ${event.code} - ${event.reason}`));
                    }
                    
                    this.emit('disconnected', { code: event.code, reason: event.reason });
                };
                
                this.ws.onerror = (error) => {
                    this.handleError(error);
                };
                
                // Use the message event handler with correct typing
                this.ws.onmessage = (event) => {
                    try {
                        if (event && event.data) {
                            const data = event.data;
                            // Convert data to string safely regardless of type
                            const dataString = typeof data === 'string' 
                                ? data 
                                : data instanceof Buffer 
                                    ? data.toString() 
                                    : JSON.stringify(data);
                            
                            const message = JSON.parse(dataString);
                            this.handleMessage(message);
                        }
                    } catch (error) {
                        this.handleError(error);
                    }
                };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logError(`Error creating WebSocket: ${errorMessage}`);
                this.scheduleReconnect();
                reject(error);
            }
        });
    }

    /**
     * Handle reconnection with exponential backoff
     */
    private scheduleReconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        this.reconnectAttempts++;
        
        if (this.reconnectAttempts > this.MAX_RECONNECT_ATTEMPTS) {
            logError(`Maximum reconnection attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`);
            this.emit('reconnect_failed');
            return;
        }

        // Calculate backoff delay with jitter to avoid thundering herd
        const delay = Math.min(30000, this.RECONNECT_DELAY * Math.pow(1.5, this.reconnectAttempts - 1)) 
                    + Math.floor(Math.random() * 1000);
        
        logInfo(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${Math.round(delay / 1000)} seconds`);
        
        this.reconnectTimer = setTimeout(() => {
            logInfo(`Attempting to reconnect (${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`);
            this.connect().catch(error => {
                logError(`Reconnection attempt failed: ${error.message}`);
            });
        }, delay);
    }

    /**
     * Set up a ping interval to keep the connection alive
     */
    private setupPingInterval(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }

        // Send a ping every 30 seconds to keep the connection alive
        this.pingInterval = setInterval(async () => {
            if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
                try {
                    await this.send('eth_blockNumber', []);
                    this.updatePingSuccess();
                } catch (error) {
                    logWarn(`Ping failed: ${error instanceof Error ? error.message : String(error)}`);
                    this.recordFailure();
                }
            }
        }, 30000);
    }

    /**
     * Clean up resources when connection is closed
     */
    private cleanup(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }

        if (this.timeoutChecker) {
            clearInterval(this.timeoutChecker);
            this.timeoutChecker = null;
        }

        // Abort all pending operations
        for (const [key, controller] of this.abortControllers.entries()) {
            controller.abort();
            this.abortControllers.delete(key);
        }

        // Reject all pending requests
        for (const [id, { reject }] of this.pendingRequests.entries()) {
            reject(new Error('WebSocket connection closed'));
            this.pendingRequests.delete(id);
        }

        // Clear operation locks
        this.operationLocks.clear();
    }

    /**
     * Check for timed-out requests
     */
    private startRequestTimeoutChecker(): void {
        if (this.timeoutChecker) {
            clearInterval(this.timeoutChecker);
        }
        
        this.timeoutChecker = setInterval(() => {
            const now = Date.now();
            for (const [id, { reject, timestamp }] of this.pendingRequests.entries()) {
                if (now - timestamp > this.REQUEST_TIMEOUT) {
                    reject(new Error(`Request timeout after ${this.REQUEST_TIMEOUT}ms`));
                    this.pendingRequests.delete(id);
                }
            }
        }, 5000);
    }

    /**
     * Resubscribe to all previous subscriptions after reconnect
     */
    private async resubscribeAll(): Promise<void> {
        logInfo(`Resubscribing to ${this.subscriptions.size} subscriptions`);
        
        for (const [key, { params }] of this.subscriptions.entries()) {
            try {
                const result = await this.send('eth_subscribe', params);
                this.subscriptions.set(key, { id: result, params });
                logInfo(`Resubscribed to ${key}`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logError(`Failed to resubscribe to ${key}: ${errorMessage}`);
            }
        }
    }

    /**
     * Send a message to the WebSocket server
     */
    public async send(method: string, params: any[]): Promise<any> {
        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            logWarn('Cannot send message: WebSocket not connected');
            await this.connect();
        }

        return new Promise((resolve, reject) => {
            try {
                const id = this.nextId++;
                const message = {
                    jsonrpc: '2.0',
                    id,
                    method,
                    params
                };

                this.pendingRequests.set(id.toString(), {
                    resolve,
                    reject,
                    timestamp: Date.now()
                });

                this.ws?.send(JSON.stringify(message));
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Handle incoming WebSocket messages
     */
    private handleMessage(message: any): void {
        try {
            // Handle subscription notifications
            if (message.method === 'eth_subscription' && message.params && message.params.subscription) {
                this.handleSubscriptionMessage(message.params).catch(this.handleError.bind(this));
                return;
            }
            
            // Handle regular responses
            const id = message.id;
            if (id && this.pendingRequests.has(id.toString())) {
                const { resolve, reject } = this.pendingRequests.get(id.toString())!;
                
                if (message.error) {
                    reject(new Error(message.error.message || 'Unknown error'));
                } else {
                    resolve(message.result);
                }
                
                this.pendingRequests.delete(id.toString());
            }
        } catch (error) {
            this.handleError(error);
        }
    }

    private handleError(error: unknown): void {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logError(`WebSocket error: ${errorMessage}`);
    }

    private subscribeToEvents() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            logWarn('WebSocket not open, cannot subscribe to events');
            return;
        }

        // Create a newHeads subscription
        const newHeadsSubscription = {
            jsonrpc: '2.0',
            id: (this.nextId++).toString(),
            method: 'eth_subscribe',
            params: ['newHeads']
        };

        // Create a logs subscription for Transfer events
        const transferSubscription = {
            jsonrpc: '2.0',
            id: (this.nextId++).toString(),
            method: 'eth_subscribe',
            params: ['logs', { topics: [this.config.TRANSFER_TOPIC], address: this.config.DEX_ADDRESSES }]
        };

        // Create a logs subscription for Swap events
        const swapSubscription = {
            jsonrpc: '2.0',
            id: (this.nextId++).toString(),
            method: 'eth_subscribe',
            params: ['logs', { topics: [this.config.SWAP_TOPIC], address: this.config.DEX_ADDRESSES }]
        };

        // Send subscriptions with error handling
        try {
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(newHeadsSubscription));
                logInfo('Sent newHeads subscription');
                
                this.ws.send(JSON.stringify(transferSubscription));
                logInfo('Sent transfer events subscription');
                
                this.ws.send(JSON.stringify(swapSubscription));
                logInfo('Sent swap events subscription');

                logInfo('Successfully sent all subscription requests', {
                    subscriptionTypes: ['newHeads', 'transfer', 'swap'],
                    dexAddresses: this.config.DEX_ADDRESSES
                });
            } else {
                logError('WebSocket not open when trying to subscribe', {
                    readyState: this.ws.readyState
                });
            }
        } catch (error: any) {
            logError('Error sending subscriptions', {
                error: error instanceof Error ? error : new Error(error?.message || String(error))
            });
        }
    }

    private async handleSubscriptionMessage(event: any) {
        logDebug('Processing subscription message', { 
            event,
            eventType: event.topics ? 'log' : 'newHeads'
        });
        
        // Handle newHeads subscription
        if (!event.topics) {
            // Validate event structure before parsing block number
            if (!event || typeof event !== 'object') {
                logWarn('Invalid event structure received', { event });
                return;
            }

            // Parse block number with validation - handle Alchemy's format
            let blockNumber: number | null = null;
            let timestamp: number | null = null;

            // Alchemy returns block data in event.result for newHeads subscriptions
            const blockData = event.result || event;
            
            // Try multiple field names for block number
            const blockNumberValue = blockData.number || blockData.blockNumber || event.number;
            
            if (blockNumberValue) {
                try {
                    if (typeof blockNumberValue === 'string' && blockNumberValue.startsWith('0x')) {
                        blockNumber = parseInt(blockNumberValue, 16);
                    } else if (typeof blockNumberValue === 'number') {
                        blockNumber = blockNumberValue;
                    } else if (typeof blockNumberValue === 'string' && !isNaN(Number(blockNumberValue))) {
                        blockNumber = Number(blockNumberValue);
                    }
                } catch (error) {
                    logWarn('Failed to parse block number', { 
                        error: error instanceof Error ? error : new Error(String(error))
                    });
                }
            }

            // Try multiple field names for timestamp
            const timestampValue = blockData.timestamp || event.timestamp;
            
            if (timestampValue) {
                try {
                    if (typeof timestampValue === 'string' && timestampValue.startsWith('0x')) {
                        timestamp = parseInt(timestampValue, 16);
                    } else if (typeof timestampValue === 'number') {
                        timestamp = timestampValue;
                    } else if (typeof timestampValue === 'string' && !isNaN(Number(timestampValue))) {
                        timestamp = Number(timestampValue);
                    }
                } catch (error) {
                    logWarn('Failed to parse timestamp', { 
                        error: error instanceof Error ? error : new Error(String(error))
                    });
                }
            }

            // Log block received with validated data
            if (blockNumber !== null) {
                logInfo('New block received', {
                    blockNumber,
                    timestamp: timestamp !== null ? timestamp : undefined
                });
                // Update health tracking for successful block reception
                this.updateBlockReceived();
            } else {
                logWarn('Received block event without valid block number');
                
                // Try to fetch current block number as fallback with abort controller
                const abortController = new AbortController();
                const fallbackKey = `fallback_block_${Date.now()}`;
                this.abortControllers.set(fallbackKey, abortController);
                
                try {
                    const currentBlock = await this.send('eth_blockNumber', []);
                    if (currentBlock && !abortController.signal.aborted) {
                        const fallbackBlockNumber = typeof currentBlock === 'string' && currentBlock.startsWith('0x')
                            ? parseInt(currentBlock, 16)
                            : Number(currentBlock);
                        
                        if (!isNaN(fallbackBlockNumber)) {
                            logInfo('Using fallback block number', { blockNumber: fallbackBlockNumber });
                            blockNumber = fallbackBlockNumber;
                        }
                    }
                } catch (fallbackError) {
                    logError('Failed to fetch fallback block number', { 
                        error: fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError))
                    });
                } finally {
                    // Proper cleanup of AbortController
                    try {
                        abortController.abort(); // Clean up listeners
                    } catch (cleanupError) {
                        // Ignore cleanup errors
                    }
                    this.abortControllers.delete(fallbackKey);
                }
            }
            return;
        }
        
        // Check if the event is related to our monitored DEXes
        if (!this.config.DEX_ADDRESSES.some(address => 
            event.address && event.address.toLowerCase() === address.toLowerCase()
        )) {
            return;
        }

        // Process transfer events
        if (event.topics && event.topics[0] === this.config.TRANSFER_TOPIC) {
            await this.handleTransferEvent(event);
        }

        // Process swap events
        if (event.topics && event.topics[0] === this.config.SWAP_TOPIC) {
            await this.handleSwapEvent(event);
        }
    }

    private async handleTransferEvent(event: any) {
        const operationKey = `transfer_${event.address}_${event.transactionHash}`;
        
        // Prevent duplicate processing
        if (this.operationLocks.has(operationKey)) {
            logDebug('Skipping duplicate transfer event', { txHash: event.transactionHash });
            return;
        }
        
        this.operationLocks.add(operationKey);
        
        try {
            logDebug('Processing transfer event', { 
                txHash: event.transactionHash,
                address: event.address
            });

            // Update reserves for the affected market with abort controller
            const abortController = new AbortController();
            this.abortControllers.set(operationKey, abortController);
            
            const market = await this.findMarketByAddress(event.address);
            if (market && !abortController.signal.aborted) {
                await market.updateReserves();
                logDebug('Updated reserves after transfer', {
                    marketAddress: event.address
                });

                // Use coordinated operation manager if available
                if (!abortController.signal.aborted && this.operationManager) {
                    await this.operationManager.runCoordinatedUpdate('transfer_event');
                }
            }
        } catch (error: any) {
            logError('Error handling transfer event', { 
                error: error instanceof Error ? error : new Error(error?.message || String(error)),
                txHash: event.transactionHash 
            });
        } finally {
            this.operationLocks.delete(operationKey);
            this.abortControllers.delete(operationKey);
        }
    }

    private async handleSwapEvent(event: any) {
        const operationKey = `swap_${event.address}_${event.transactionHash}`;
        
        // Prevent duplicate processing
        if (this.operationLocks.has(operationKey)) {
            logDebug('Skipping duplicate swap event', { txHash: event.transactionHash });
            return;
        }
        
        this.operationLocks.add(operationKey);
        
        try {
            logDebug('Processing swap event', { 
                txHash: event.transactionHash,
                address: event.address
            });

            // Update reserves for the affected market with abort controller
            const abortController = new AbortController();
            this.abortControllers.set(operationKey, abortController);
            
            const market = await this.findMarketByAddress(event.address);
            if (market && !abortController.signal.aborted) {
                await market.updateReserves();
                logDebug('Updated reserves after swap', {
                    marketAddress: event.address
                });

                // Use coordinated operation manager if available
                if (!abortController.signal.aborted && this.operationManager) {
                    await this.operationManager.runCoordinatedUpdate('swap_event');
                }
            }
        } catch (error: any) {
            logError('Error handling swap event', { 
                error: error instanceof Error ? error : new Error(error?.message || String(error)),
                txHash: event.transactionHash 
            });
        } finally {
            this.operationLocks.delete(operationKey);
            this.abortControllers.delete(operationKey);
        }
    }

    private async findMarketByAddress(address: string): Promise<UniswapV2EthPair | null> {
        for (const markets of Object.values(this.marketsByToken)) {
            for (const market of markets) {
                if (market.marketAddress.toLowerCase() === address.toLowerCase()) {
                    return market as UniswapV2EthPair;
                }
            }
        }
        return null;
    }

    public updateMetrics(newMetrics: any) {
        this.metrics = { ...this.metrics, ...newMetrics };
    }

    public getMetrics() {
        return this.metrics;
    }

    /**
     * Check if WebSocket connection and data are healthy for trading
     */
    public isHealthyForTrading(): boolean {
        const now = Date.now();
        
        // Check connection status
        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            logDebug('WebSocket unhealthy: not connected');
            return false;
        }
        
        // Check for stale ping responses
        if ((now - this.lastSuccessfulPing) > this.PING_FAILURE_THRESHOLD) {
            logWarn('WebSocket unhealthy: ping failures', {
                error: new Error(`Last ping: ${new Date(this.lastSuccessfulPing).toISOString()}, Time since: ${now - this.lastSuccessfulPing}ms`)
            });
            return false;
        }
        
        // Check for stale block data
        if ((now - this.lastBlockReceived) > this.STALE_DATA_THRESHOLD) {
            logWarn('WebSocket unhealthy: stale block data', {
                error: new Error(`Last block: ${new Date(this.lastBlockReceived).toISOString()}, Time since: ${now - this.lastBlockReceived}ms`)
            });
            return false;
        }
        
        // Check consecutive failures
        if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
            logWarn('WebSocket unhealthy: too many consecutive failures', {
                error: new Error(`Failures: ${this.consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES}`)
            });
            return false;
        }
        
        return true;
    }

    /**
     * Get connection health metrics
     */
    public getHealthMetrics(): {
        isConnected: boolean;
        lastSuccessfulPing: number;
        lastBlockReceived: number;
        timeSinceLastPing: number;
        timeSinceLastBlock: number;
        consecutiveFailures: number;
        isHealthyForTrading: boolean;
    } {
        const now = Date.now();
        return {
            isConnected: this.isConnected,
            lastSuccessfulPing: this.lastSuccessfulPing,
            lastBlockReceived: this.lastBlockReceived,
            timeSinceLastPing: now - this.lastSuccessfulPing,
            timeSinceLastBlock: now - this.lastBlockReceived,
            consecutiveFailures: this.consecutiveFailures,
            isHealthyForTrading: this.isHealthyForTrading()
        };
    }

    /**
     * Update health tracking when new block is received
     */
    private updateBlockReceived(): void {
        this.lastBlockReceived = Date.now();
        this.consecutiveFailures = 0; // Reset on successful block reception
    }

    /**
     * Update health tracking when ping succeeds
     */
    private updatePingSuccess(): void {
        this.lastSuccessfulPing = Date.now();
        this.consecutiveFailures = 0; // Reset on successful ping
    }

    /**
     * Update health tracking when operation fails
     */
    private recordFailure(): void {
        this.consecutiveFailures++;
    }

    /**
     * Graceful shutdown with cleanup
     */
    public async disconnect(): Promise<void> {
        logInfo('Disconnecting WebSocket manager...');
        
        this.cleanup();
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close(1000, 'Normal closure');
        }
        
        this.isConnected = false;
        logInfo('WebSocket manager disconnected');
    }

    /**
     * Get operation status for debugging
     */
    public getOperationStatus(): { pendingRequests: number, activeLocks: number, activeAbortControllers: number } {
        return {
            pendingRequests: this.pendingRequests.size,
            activeLocks: this.operationLocks.size,
            activeAbortControllers: this.abortControllers.size
        };
    }
}

// Example usage
const config: SubscriptionConfig = {
    DEX_ADDRESSES: [
        '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2 Router
        '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F'  // Sushiswap Router
    ],
    TRANSFER_TOPIC: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    SWAP_TOPIC: '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
};