import { BigNumber } from "@ethersproject/bignumber";
import { EthMarket, MarketType } from "../EthMarket";
import { MarketsByToken, CrossedMarketDetails } from "../types";
import { logInfo, logError, logDebug, logWarn } from "../utils/logger";

/**
 * Graph edge representing a trading pair
 */
interface TradingEdge {
    fromToken: string;
    toToken: string;
    market: MarketType;
    weight: number; // Negative log of exchange rate
    fee: BigNumber;
    liquidity: BigNumber;
}

/**
 * Trading path through multiple markets
 */
export interface ArbitragePath {
    tokens: string[];
    markets: MarketType[];
    expectedProfit: BigNumber;
    volume: BigNumber;
    priceImpact: BigNumber;
    complexity: number; // Number of hops
}

/**
 * Optimization result
 */
export interface OptimizationResult {
    optimalPaths: ArbitragePath[];
    totalExpectedProfit: BigNumber;
    computationTime: number;
    iterations: number;
}

/**
 * Configuration for dual decomposition
 */
export interface DualDecompositionConfig {
    maxIterations: number;
    convergenceTolerance: number;
    stepSize: number; // For gradient descent
    maxPathLength: number; // Maximum number of hops
    minProfitThreshold: BigNumber;
    maxPriceImpact: BigNumber; // In basis points
}

/**
 * Enhanced Dual Decomposition Optimizer
 * Finds optimal multi-hop arbitrage paths across multiple AMMs
 */
export class DualDecompositionOptimizer {
    private config: DualDecompositionConfig;
    private graph: Map<string, TradingEdge[]> = new Map();
    private dualVariables: Map<string, number> = new Map();

    constructor(config?: Partial<DualDecompositionConfig>) {
        this.config = {
            maxIterations: 100,
            convergenceTolerance: 0.0001,
            stepSize: 0.1,
            maxPathLength: 4,
            minProfitThreshold: BigNumber.from(10).pow(16), // 0.01 ETH
            maxPriceImpact: BigNumber.from(500), // 5%
            ...config
        };

        logInfo("Dual Decomposition Optimizer initialized", {
            maxIterations: this.config.maxIterations,
            maxPathLength: this.config.maxPathLength
        });
    }

    /**
     * Build trading graph from markets
     */
    private buildTradingGraph(marketsByToken: MarketsByToken): void {
        this.graph.clear();

        for (const [tokenAddress, markets] of Object.entries(marketsByToken)) {
            for (const market of markets) {
                // Add edges for both directions
                for (let i = 0; i < market.tokens.length; i++) {
                    for (let j = 0; j < market.tokens.length; j++) {
                        if (i === j) continue;

                        const fromToken = market.tokens[i];
                        const toToken = market.tokens[j];

                        // Initialize edge with market info
                        const edge: TradingEdge = {
                            fromToken,
                            toToken,
                            market,
                            weight: 0, // Will be calculated
                            fee: BigNumber.from(0),
                            liquidity: BigNumber.from(0)
                        };

                        // Add to graph
                        if (!this.graph.has(fromToken)) {
                            this.graph.set(fromToken, []);
                        }
                        this.graph.get(fromToken)!.push(edge);
                    }
                }
            }
        }

        logDebug("Built trading graph", {
            nodes: this.graph.size,
            edges: Array.from(this.graph.values()).reduce((sum, edges) => sum + edges.length, 0)
        });
    }

    /**
     * Update edge weights based on current market prices
     */
    private async updateEdgeWeights(): Promise<void> {
        for (const edges of this.graph.values()) {
            for (const edge of edges) {
                try {
                    // Get exchange rate
                    const testAmount = BigNumber.from(10).pow(18); // 1 unit
                    const outputAmount = await edge.market.getTokensOut(
                        edge.fromToken,
                        edge.toToken,
                        testAmount
                    );

                    if (outputAmount.isZero()) {
                        edge.weight = Infinity;
                        continue;
                    }

                    // Calculate exchange rate
                    const exchangeRate = outputAmount.mul(10000).div(testAmount).toNumber() / 10000;
                    
                    // Weight is negative log of exchange rate (for shortest path = best rate)
                    edge.weight = -Math.log(exchangeRate);

                    // Get fee and liquidity
                    edge.fee = await edge.market.getTradingFee();
                    edge.liquidity = await edge.market.getLiquidity();

                } catch (error) {
                    edge.weight = Infinity; // Invalid edge
                    logWarn("Failed to update edge weight", {
                        from: edge.fromToken,
                        to: edge.toToken,
                        error: error as Error
                    });
                }
            }
        }
    }

    /**
     * Find all paths from start to end token using DFS
     */
    private findAllPaths(
        startToken: string,
        endToken: string,
        maxLength: number = this.config.maxPathLength
    ): Array<{ tokens: string[]; edges: TradingEdge[] }> {
        const paths: Array<{ tokens: string[]; edges: TradingEdge[] }> = [];
        const visited = new Set<string>();

        const dfs = (
            currentToken: string,
            currentPath: string[],
            currentEdges: TradingEdge[],
            depth: number
        ) => {
            if (depth > maxLength) return;

            if (currentToken === endToken && depth > 1) {
                paths.push({
                    tokens: [...currentPath],
                    edges: [...currentEdges]
                });
                return;
            }

            visited.add(currentToken);

            const edges = this.graph.get(currentToken) || [];
            for (const edge of edges) {
                if (visited.has(edge.toToken)) continue;
                if (edge.weight === Infinity) continue;

                dfs(
                    edge.toToken,
                    [...currentPath, edge.toToken],
                    [...currentEdges, edge],
                    depth + 1
                );
            }

            visited.delete(currentToken);
        };

        dfs(startToken, [startToken], [], 0);

        return paths;
    }

    /**
     * Bellman-Ford algorithm for finding negative cycles (arbitrage opportunities)
     */
    private findNegativeCycles(startToken: string): ArbitragePath[] {
        const opportunities: ArbitragePath[] = [];
        
        // Initialize distances
        const distances = new Map<string, number>();
        const predecessors = new Map<string, { token: string; edge: TradingEdge }>();
        
        for (const token of this.graph.keys()) {
            distances.set(token, Infinity);
        }
        distances.set(startToken, 0);

        // Relax edges V-1 times
        const vertices = Array.from(this.graph.keys());
        for (let i = 0; i < vertices.length - 1; i++) {
            for (const [fromToken, edges] of this.graph.entries()) {
                for (const edge of edges) {
                    const dist = distances.get(fromToken)!;
                    if (dist === Infinity) continue;

                    const newDist = dist + edge.weight;
                    if (newDist < distances.get(edge.toToken)!) {
                        distances.set(edge.toToken, newDist);
                        predecessors.set(edge.toToken, { token: fromToken, edge });
                    }
                }
            }
        }

        // Check for negative cycles
        for (const [fromToken, edges] of this.graph.entries()) {
            for (const edge of edges) {
                const dist = distances.get(fromToken)!;
                if (dist === Infinity) continue;

                const newDist = dist + edge.weight;
                if (newDist < distances.get(edge.toToken)!) {
                    // Found negative cycle, reconstruct path
                    const path = this.reconstructCycle(edge.toToken, predecessors);
                    if (path && path.tokens[0] === path.tokens[path.tokens.length - 1]) {
                        opportunities.push(path);
                    }
                }
            }
        }

        return opportunities;
    }

    /**
     * Reconstruct arbitrage cycle from predecessors
     */
    private reconstructCycle(
        cycleNode: string,
        predecessors: Map<string, { token: string; edge: TradingEdge }>
    ): ArbitragePath | null {
        const tokens: string[] = [cycleNode];
        const markets: MarketType[] = [];
        const visited = new Set<string>();
        
        let current = cycleNode;
        
        while (true) {
            const pred = predecessors.get(current);
            if (!pred) break;
            
            if (visited.has(pred.token)) {
                // Found cycle start
                const cycleStart = tokens.indexOf(pred.token);
                if (cycleStart !== -1) {
                    tokens.splice(0, cycleStart);
                    markets.splice(0, cycleStart);
                }
                break;
            }
            
            visited.add(current);
            tokens.unshift(pred.token);
            markets.unshift(pred.edge.market);
            current = pred.token;
            
            if (tokens.length > this.config.maxPathLength) break;
        }

        if (tokens.length < 2 || tokens[0] !== tokens[tokens.length - 1]) {
            return null;
        }

        return {
            tokens,
            markets,
            expectedProfit: BigNumber.from(0), // Will be calculated
            volume: BigNumber.from(0), // Will be optimized
            priceImpact: BigNumber.from(0),
            complexity: markets.length
        };
    }

    /**
     * Calculate expected profit for a path
     */
    private async calculatePathProfit(
        path: ArbitragePath,
        volume: BigNumber
    ): Promise<{ profit: BigNumber; priceImpact: BigNumber }> {
        let currentAmount = volume;
        let totalPriceImpact = BigNumber.from(0);

        for (let i = 0; i < path.markets.length; i++) {
            const market = path.markets[i];
            const tokenIn = path.tokens[i];
            const tokenOut = path.tokens[i + 1];

            try {
                // Calculate output
                const outputAmount = await market.getTokensOut(tokenIn, tokenOut, currentAmount);
                
                // Calculate price impact
                const priceImpact = await market.getPriceImpact(tokenIn, currentAmount);
                totalPriceImpact = totalPriceImpact.add(priceImpact);

                currentAmount = outputAmount;

                if (currentAmount.isZero()) {
                    return { profit: BigNumber.from(0), priceImpact: BigNumber.from(10000) };
                }

            } catch (error) {
                return { profit: BigNumber.from(0), priceImpact: BigNumber.from(10000) };
            }
        }

        // Profit is final amount minus initial amount (for cycle)
        const profit = currentAmount.sub(volume);

        return { profit, priceImpact: totalPriceImpact };
    }

    /**
     * Optimize volume for a path using binary search
     */
    private async optimizePathVolume(path: ArbitragePath): Promise<ArbitragePath> {
        // Get minimum liquidity across path
        const liquidities = await Promise.all(
            path.markets.map(m => m.getLiquidity())
        );
        const minLiquidity = liquidities.reduce((min, l) => l.lt(min) ? l : min);

        if (minLiquidity.isZero()) {
            return { ...path, expectedProfit: BigNumber.from(0), volume: BigNumber.from(0) };
        }

        // Binary search for optimal volume
        let left = BigNumber.from(10).pow(15); // 0.001 ETH
        let right = minLiquidity.div(10); // Max 10% of minimum liquidity
        let optimalVolume = left;
        let maxProfit = BigNumber.from(0);

        const iterations = 20;
        for (let i = 0; i < iterations; i++) {
            const mid = left.add(right).div(2);

            const { profit, priceImpact } = await this.calculatePathProfit(path, mid);

            // Check if price impact is acceptable
            if (priceImpact.gt(this.config.maxPriceImpact)) {
                right = mid;
                continue;
            }

            if (profit.gt(maxProfit)) {
                maxProfit = profit;
                optimalVolume = mid;
                left = mid;
            } else {
                right = mid;
            }

            // Convergence check
            if (right.sub(left).lt(BigNumber.from(10).pow(14))) {
                break;
            }
        }

        // Final calculation with optimal volume
        const { profit, priceImpact } = await this.calculatePathProfit(path, optimalVolume);

        return {
            ...path,
            volume: optimalVolume,
            expectedProfit: profit,
            priceImpact
        };
    }

    /**
     * Main optimization function - finds all profitable arbitrage paths
     */
    async optimize(marketsByToken: MarketsByToken): Promise<OptimizationResult> {
        const startTime = Date.now();

        // Build and update graph
        this.buildTradingGraph(marketsByToken);
        await this.updateEdgeWeights();

        const allPaths: ArbitragePath[] = [];

        // Find arbitrage cycles for each token
        const tokens = Array.from(this.graph.keys());
        const processingLimit = Math.min(tokens.length, 50); // Limit for performance

        for (let i = 0; i < processingLimit; i++) {
            const token = tokens[i];
            
            try {
                // Find negative cycles (arbitrage opportunities)
                const cycles = this.findNegativeCycles(token);
                
                for (const cycle of cycles) {
                    // Optimize volume for this path
                    const optimizedPath = await this.optimizePathVolume(cycle);
                    
                    // Only include if profitable enough
                    if (optimizedPath.expectedProfit.gte(this.config.minProfitThreshold)) {
                        allPaths.push(optimizedPath);
                    }
                }
            } catch (error) {
                logWarn("Error finding cycles for token", {
                    token,
                    error: error as Error
                });
            }
        }

        // Sort by expected profit
        allPaths.sort((a, b) => b.expectedProfit.sub(a.expectedProfit).toNumber());

        // Calculate total profit
        const totalExpectedProfit = allPaths.reduce(
            (sum, path) => sum.add(path.expectedProfit),
            BigNumber.from(0)
        );

        const computationTime = Date.now() - startTime;

        logInfo("Optimization completed", {
            pathsFound: allPaths.length,
            totalProfit: totalExpectedProfit.toString(),
            computationTime,
            avgComplexity: allPaths.length > 0 
                ? allPaths.reduce((sum, p) => sum + p.complexity, 0) / allPaths.length 
                : 0
        });

        return {
            optimalPaths: allPaths,
            totalExpectedProfit,
            computationTime,
            iterations: processingLimit
        };
    }

    /**
     * Convert arbitrage paths to CrossedMarketDetails format
     */
    convertPathsToCrossedMarkets(paths: ArbitragePath[]): CrossedMarketDetails[] {
        return paths.map(path => ({
            profit: path.expectedProfit,
            volume: path.volume,
            tokenAddress: path.tokens[0],
            buyFromMarket: path.markets[0] as any,
            sellToMarket: path.markets[path.markets.length - 1] as any,
            marketPairs: path.markets.map((market, idx) => ({
                market,
                tokenIn: path.tokens[idx],
                tokenOut: path.tokens[idx + 1]
            }))
        }));
    }

    /**
     * Get trading graph statistics
     */
    getGraphStatistics(): {
        nodes: number;
        edges: number;
        avgDegree: number;
        maxPathLength: number;
    } {
        const nodes = this.graph.size;
        let edges = 0;
        let totalDegree = 0;

        for (const nodeEdges of this.graph.values()) {
            const degree = nodeEdges.length;
            edges += degree;
            totalDegree += degree;
        }

        return {
            nodes,
            edges,
            avgDegree: nodes > 0 ? totalDegree / nodes : 0,
            maxPathLength: this.config.maxPathLength
        };
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig: Partial<DualDecompositionConfig>): void {
        this.config = { ...this.config, ...newConfig };
        logInfo("Dual decomposition configuration updated", newConfig);
    }

    /**
     * Get configuration
     */
    getConfig(): DualDecompositionConfig {
        return { ...this.config };
    }

    /**
     * Clear graph and reset
     */
    reset(): void {
        this.graph.clear();
        this.dualVariables.clear();
        logInfo("Dual decomposition optimizer reset");
    }
}

