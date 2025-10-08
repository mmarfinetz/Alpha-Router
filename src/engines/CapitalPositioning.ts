import { BigNumber } from "@ethersproject/bignumber";
import { Wallet } from "@ethersproject/wallet";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";
import { EthMarket, MarketType } from "../EthMarket";
import { StatisticalOpportunity } from "./StatisticalArbitrageEngine";
import { logInfo, logError, logDebug, logWarn } from "../utils/logger";

/**
 * Position in a market
 */
export interface MarketPosition {
    market: MarketType;
    tokenAddress: string;
    amount: BigNumber;
    entryPrice: BigNumber;
    entryTime: number;
    reason: string;
    expectedExitTime: number;
    stopLoss: BigNumber; // Price at which to exit position
    takeProfit: BigNumber; // Target profit price
}

/**
 * Position performance tracking
 */
interface PositionPerformance {
    positionId: string;
    profitLoss: BigNumber;
    holdingPeriod: number; // seconds
    exitReason: 'profit' | 'stop-loss' | 'timeout' | 'manual';
    actualProfit: BigNumber;
    expectedProfit: BigNumber;
}

/**
 * Capital allocation strategy
 */
export interface CapitalAllocationConfig {
    maxPositionSize: BigNumber; // Max size per position (in wei)
    maxTotalCapital: BigNumber; // Max total capital to deploy
    positionSizePercentage: number; // Percentage of available capital per position (0-100)
    maxPositions: number; // Maximum number of concurrent positions
    stopLossPercentage: number; // Stop loss threshold (0-100)
    takeProfitPercentage: number; // Take profit threshold (0-100)
    positionTimeout: number; // Max time to hold position (seconds)
    minConfidenceForPosition: number; // Minimum confidence to open position
    rebalanceFrequency: number; // How often to rebalance (seconds)
}

/**
 * Capital Positioning Engine
 * Manages capital allocation and pre-positioning for predicted arbitrage opportunities
 */
export class CapitalPositioningEngine {
    private config: CapitalAllocationConfig;
    private wallet: Wallet;
    private provider: Provider;
    private activePositions: Map<string, MarketPosition> = new Map();
    private positionHistory: PositionPerformance[] = [];
    private totalDeployedCapital: BigNumber = BigNumber.from(0);
    private availableCapital: BigNumber = BigNumber.from(0);
    private lastRebalance: number = 0;

    constructor(
        wallet: Wallet,
        provider: Provider,
        config?: Partial<CapitalAllocationConfig>
    ) {
        this.wallet = wallet;
        this.provider = provider;
        this.config = {
            maxPositionSize: BigNumber.from(10).pow(18).mul(10), // 10 ETH default
            maxTotalCapital: BigNumber.from(10).pow(18).mul(100), // 100 ETH default
            positionSizePercentage: 10, // 10% per position
            maxPositions: 5,
            stopLossPercentage: 5, // 5% stop loss
            takeProfitPercentage: 10, // 10% take profit
            positionTimeout: 3600, // 1 hour
            minConfidenceForPosition: 75,
            rebalanceFrequency: 300, // 5 minutes
            ...config
        };

        logInfo("Capital Positioning Engine initialized", {
            maxPositionSize: this.config.maxPositionSize.toString(),
            maxTotalCapital: this.config.maxTotalCapital.toString(),
            maxPositions: this.config.maxPositions
        });
    }

    /**
     * Update available capital from wallet balance
     */
    async updateAvailableCapital(): Promise<void> {
        try {
            const balance = await this.wallet.getBalance();
            this.availableCapital = balance.sub(this.totalDeployedCapital);

            // Cap at max total capital
            if (this.availableCapital.gt(this.config.maxTotalCapital)) {
                this.availableCapital = this.config.maxTotalCapital;
            }

            logDebug("Updated available capital", {
                total: balance.toString(),
                deployed: this.totalDeployedCapital.toString(),
                available: this.availableCapital.toString()
            });

        } catch (error) {
            logError("Failed to update available capital", {
                error: error as Error
            });
        }
    }

    /**
     * Evaluate opportunities and decide which to pre-position for
     */
    async evaluatePositioningOpportunities(
        opportunities: StatisticalOpportunity[]
    ): Promise<MarketPosition[]> {
        await this.updateAvailableCapital();

        // Filter opportunities that qualify for positioning
        const qualifiedOpportunities = opportunities.filter(opp => 
            opp.shouldPrePosition && 
            opp.confidence >= this.config.minConfidenceForPosition
        );

        if (qualifiedOpportunities.length === 0) {
            return [];
        }

        // Check if we have room for more positions
        const availableSlots = this.config.maxPositions - this.activePositions.size;
        if (availableSlots <= 0) {
            logInfo("No available position slots", {
                current: this.activePositions.size,
                max: this.config.maxPositions
            });
            return [];
        }

        // Sort by expected profit * confidence
        const sortedOpportunities = qualifiedOpportunities
            .sort((a, b) => {
                const scoreA = a.expectedProfitBps * a.confidence;
                const scoreB = b.expectedProfitBps * b.confidence;
                return scoreB - scoreA;
            })
            .slice(0, availableSlots);

        const newPositions: MarketPosition[] = [];

        for (const opportunity of sortedOpportunities) {
            try {
                const position = await this.createPosition(opportunity);
                if (position) {
                    newPositions.push(position);
                }
            } catch (error) {
                logError("Failed to create position", {
                    market: opportunity.market.marketAddress,
                    error: error as Error
                });
            }
        }

        return newPositions;
    }

    /**
     * Create a new position for an opportunity
     */
    private async createPosition(opportunity: StatisticalOpportunity): Promise<MarketPosition | null> {
        try {
            // Calculate position size
            const positionSize = this.calculatePositionSize(opportunity);
            
            if (positionSize.isZero() || positionSize.gt(this.availableCapital)) {
                logWarn("Insufficient capital for position", {
                    required: positionSize.toString(),
                    available: this.availableCapital.toString()
                });
                return null;
            }

            // Get current price
            const reserves = await opportunity.market.getReservesByToken();
            if (!Array.isArray(reserves) || reserves.length < 2) {
                return null;
            }

            const currentPrice = reserves[1].mul(BigNumber.from(10).pow(18)).div(reserves[0]);

            // Calculate stop loss and take profit levels
            const stopLoss = currentPrice.mul(100 - this.config.stopLossPercentage).div(100);
            const takeProfit = currentPrice.mul(100 + this.config.takeProfitPercentage).div(100);

            const position: MarketPosition = {
                market: opportunity.market,
                tokenAddress: opportunity.market.tokens[0],
                amount: positionSize,
                entryPrice: currentPrice,
                entryTime: Date.now(),
                reason: opportunity.reason,
                expectedExitTime: Date.now() + (opportunity.timeHorizon * 1000),
                stopLoss,
                takeProfit
            };

            // Add to active positions
            const positionId = `${opportunity.market.marketAddress}-${Date.now()}`;
            this.activePositions.set(positionId, position);
            
            // Update deployed capital
            this.totalDeployedCapital = this.totalDeployedCapital.add(positionSize);
            this.availableCapital = this.availableCapital.sub(positionSize);

            logInfo("Created new position", {
                market: opportunity.market.marketAddress,
                size: positionSize.toString(),
                entryPrice: currentPrice.toString(),
                stopLoss: stopLoss.toString(),
                takeProfit: takeProfit.toString(),
                reason: opportunity.reason
            });

            return position;

        } catch (error) {
            logError("Error creating position", {
                error: error as Error
            });
            return null;
        }
    }

    /**
     * Calculate optimal position size based on Kelly Criterion and confidence
     */
    private calculatePositionSize(opportunity: StatisticalOpportunity): BigNumber {
        // Base position size from available capital
        const baseSize = this.availableCapital
            .mul(this.config.positionSizePercentage)
            .div(100);

        // Cap at max position size
        let positionSize = baseSize.gt(this.config.maxPositionSize) 
            ? this.config.maxPositionSize 
            : baseSize;

        // Adjust based on confidence (Kelly Criterion inspired)
        // Kelly% = (confidence * expectedProfit - (1-confidence)) / expectedProfit
        const confidence = opportunity.confidence / 100;
        const expectedReturn = opportunity.expectedProfitBps / 10000;
        
        let kellyFraction = (confidence * expectedReturn - (1 - confidence)) / expectedReturn;
        kellyFraction = Math.max(0, Math.min(kellyFraction, 0.5)); // Cap at 50% Kelly for safety

        positionSize = positionSize.mul(Math.floor(kellyFraction * 100)).div(100);

        // Ensure minimum viable size
        const minSize = BigNumber.from(10).pow(17); // 0.1 ETH
        if (positionSize.lt(minSize)) {
            return BigNumber.from(0);
        }

        return positionSize;
    }

    /**
     * Monitor active positions and close those that hit targets or stops
     */
    async monitorPositions(): Promise<void> {
        if (this.activePositions.size === 0) {
            return;
        }

        const now = Date.now();
        const positionsToClose: Array<[string, MarketPosition, string]> = [];

        for (const [positionId, position] of this.activePositions.entries()) {
            try {
                // Get current price
                const reserves = await position.market.getReservesByToken();
                if (!Array.isArray(reserves) || reserves.length < 2) {
                    continue;
                }

                const currentPrice = reserves[1].mul(BigNumber.from(10).pow(18)).div(reserves[0]);

                // Check stop loss
                if (currentPrice.lte(position.stopLoss)) {
                    positionsToClose.push([positionId, position, 'stop-loss']);
                    logWarn("Position hit stop loss", {
                        market: position.market.marketAddress,
                        entryPrice: position.entryPrice.toString(),
                        currentPrice: currentPrice.toString(),
                        stopLoss: position.stopLoss.toString()
                    });
                    continue;
                }

                // Check take profit
                if (currentPrice.gte(position.takeProfit)) {
                    positionsToClose.push([positionId, position, 'profit']);
                    logInfo("Position hit take profit", {
                        market: position.market.marketAddress,
                        entryPrice: position.entryPrice.toString(),
                        currentPrice: currentPrice.toString(),
                        takeProfit: position.takeProfit.toString()
                    });
                    continue;
                }

                // Check timeout
                if (now >= position.expectedExitTime + this.config.positionTimeout * 1000) {
                    positionsToClose.push([positionId, position, 'timeout']);
                    logWarn("Position timed out", {
                        market: position.market.marketAddress,
                        holdingPeriod: (now - position.entryTime) / 1000
                    });
                    continue;
                }

            } catch (error) {
                logError("Error monitoring position", {
                    positionId,
                    error: error as Error
                });
            }
        }

        // Close positions that hit targets
        for (const [positionId, position, reason] of positionsToClose) {
            await this.closePosition(positionId, position, reason as PositionPerformance['exitReason']);
        }
    }

    /**
     * Close a position and record performance
     */
    private async closePosition(
        positionId: string,
        position: MarketPosition,
        exitReason: PositionPerformance['exitReason']
    ): Promise<void> {
        try {
            // Get current price for P&L calculation
            const reserves = await position.market.getReservesByToken();
            let currentPrice = position.entryPrice;
            
            if (Array.isArray(reserves) && reserves.length >= 2) {
                currentPrice = reserves[1].mul(BigNumber.from(10).pow(18)).div(reserves[0]);
            }

            // Calculate profit/loss
            const priceDiff = currentPrice.sub(position.entryPrice);
            const profitLoss = priceDiff.mul(position.amount).div(BigNumber.from(10).pow(18));

            // Calculate expected profit
            const expectedProfitBps = position.reason.includes("reversion") ? 40 : 50;
            const expectedProfit = position.amount.mul(expectedProfitBps).div(10000);

            // Record performance
            const performance: PositionPerformance = {
                positionId,
                profitLoss,
                holdingPeriod: (Date.now() - position.entryTime) / 1000,
                exitReason,
                actualProfit: profitLoss,
                expectedProfit
            };

            this.positionHistory.push(performance);

            // Remove from active positions
            this.activePositions.delete(positionId);
            
            // Update capital
            this.totalDeployedCapital = this.totalDeployedCapital.sub(position.amount);
            this.availableCapital = this.availableCapital.add(position.amount).add(profitLoss);

            logInfo("Closed position", {
                market: position.market.marketAddress,
                exitReason,
                profitLoss: profitLoss.toString(),
                holdingPeriod: performance.holdingPeriod,
                entryPrice: position.entryPrice.toString(),
                exitPrice: currentPrice.toString()
            });

        } catch (error) {
            logError("Error closing position", {
                positionId,
                error: error as Error
            });
        }
    }

    /**
     * Manually close a position
     */
    async closePositionManually(positionId: string): Promise<boolean> {
        const position = this.activePositions.get(positionId);
        if (!position) {
            logWarn("Position not found", { positionId });
            return false;
        }

        await this.closePosition(positionId, position, 'manual');
        return true;
    }

    /**
     * Rebalance positions based on current market conditions
     */
    async rebalancePositions(): Promise<void> {
        const now = Date.now();
        
        // Throttle rebalancing
        if ((now - this.lastRebalance) < (this.config.rebalanceFrequency * 1000)) {
            return;
        }

        this.lastRebalance = now;

        logInfo("Rebalancing positions", {
            activePositions: this.activePositions.size,
            deployedCapital: this.totalDeployedCapital.toString()
        });

        // Monitor and potentially close positions
        await this.monitorPositions();

        // Update available capital
        await this.updateAvailableCapital();
    }

    /**
     * Get all active positions
     */
    getActivePositions(): MarketPosition[] {
        return Array.from(this.activePositions.values());
    }

    /**
     * Get position performance history
     */
    getPerformanceHistory(): PositionPerformance[] {
        return [...this.positionHistory];
    }

    /**
     * Calculate overall strategy performance
     */
    getStrategyPerformance(): {
        totalTrades: number;
        winRate: number;
        totalProfit: BigNumber;
        avgHoldingPeriod: number;
        sharpeRatio: number;
    } {
        if (this.positionHistory.length === 0) {
            return {
                totalTrades: 0,
                winRate: 0,
                totalProfit: BigNumber.from(0),
                avgHoldingPeriod: 0,
                sharpeRatio: 0
            };
        }

        const totalTrades = this.positionHistory.length;
        const winners = this.positionHistory.filter(p => p.profitLoss.gt(0)).length;
        const winRate = (winners / totalTrades) * 100;

        const totalProfit = this.positionHistory.reduce(
            (sum, p) => sum.add(p.profitLoss),
            BigNumber.from(0)
        );

        const avgHoldingPeriod = this.positionHistory.reduce(
            (sum, p) => sum + p.holdingPeriod,
            0
        ) / totalTrades;

        // Calculate Sharpe ratio (simplified)
        const returns = this.positionHistory.map(p => 
            p.profitLoss.mul(10000).div(p.expectedProfit.gt(0) ? p.expectedProfit : BigNumber.from(1)).toNumber() / 10000
        );

        const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
        const stdDev = Math.sqrt(variance);
        const sharpeRatio = stdDev > 0 ? meanReturn / stdDev : 0;

        return {
            totalTrades,
            winRate,
            totalProfit,
            avgHoldingPeriod,
            sharpeRatio
        };
    }

    /**
     * Get current capital allocation
     */
    getCapitalAllocation(): {
        total: BigNumber;
        deployed: BigNumber;
        available: BigNumber;
        utilizationRate: number;
    } {
        const total = this.config.maxTotalCapital;
        const utilizationRate = this.totalDeployedCapital.mul(10000).div(total).toNumber() / 100;

        return {
            total,
            deployed: this.totalDeployedCapital,
            available: this.availableCapital,
            utilizationRate
        };
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig: Partial<CapitalAllocationConfig>): void {
        this.config = { ...this.config, ...newConfig };
        logInfo("Capital positioning configuration updated", newConfig);
    }

    /**
     * Get configuration
     */
    getConfig(): CapitalAllocationConfig {
        return { ...this.config };
    }

    /**
     * Reset engine (clear positions and history)
     */
    reset(): void {
        this.activePositions.clear();
        this.positionHistory = [];
        this.totalDeployedCapital = BigNumber.from(0);
        this.lastRebalance = 0;
        logInfo("Capital positioning engine reset");
    }
}

