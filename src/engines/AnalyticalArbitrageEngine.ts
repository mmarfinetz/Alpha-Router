import { BigNumber } from "@ethersproject/bignumber";
import { formatUnits, parseUnits, formatEther } from "@ethersproject/units";
import logger from '../utils/logger';
import { MarketsByToken, CrossedMarketDetails } from '../types';
import { EthMarket } from '../EthMarket';
import { MARKET_FILTERS, MarketFilterValidator } from '../config/marketFilters';

export interface ArbitrageOpportunity {
    buyMarket: EthMarket;
    sellMarket: EthMarket;
    tokenAddress: string;
    optimalInputAmount: BigNumber;
    expectedProfit: BigNumber;
    profitPercentage: BigNumber;
    gasEstimate: BigNumber;
    netProfit: BigNumber;
}

export interface AnalyticalEngineConfig {
    minProfitWei: BigNumber;
    maxGasPriceGwei: BigNumber;
    maxSlippagePercent: number;
    maxTradePercentOfLiquidity: number;
    gasCostPerSwap: BigNumber;
}

export class AnalyticalArbitrageEngine {
    private readonly config: AnalyticalEngineConfig;
    private readonly FEE_NUMERATOR = BigNumber.from('997'); // 0.3% fee
    private readonly FEE_DENOMINATOR = BigNumber.from('1000');
    private readonly ONE_ETH = BigNumber.from('1000000000000000000');
    private readonly PRECISION = BigNumber.from('1000000000000000000'); // 18 decimals

    constructor(config: AnalyticalEngineConfig) {
        this.config = config;
    }

    /**
     * Enhanced arbitrage discovery with aggressive thresholds and detailed analysis
     */
    public async findProfitableArbitrage(marketsByToken: MarketsByToken): Promise<ArbitrageOpportunity[]> {
        const opportunities: ArbitrageOpportunity[] = [];
        let totalComparisons = 0;
        let filteredByReserves = 0;
        let filteredBySpread = 0;
        let filteredByProfit = 0;
        
        logger.info('Starting enhanced analytical arbitrage discovery...', {
            tokens: Object.keys(marketsByToken).length,
            totalMarkets: Object.values(marketsByToken).flat().length,
            minProfitETH: formatEther(this.config.minProfitWei),
            maxSlippage: `${this.config.maxSlippagePercent}%`
        });

        try {
            for (const [tokenAddress, markets] of Object.entries(marketsByToken)) {
                if (markets.length < 2) continue;

                // Prioritize tokens in our priority list
                const isPriorityToken = MARKET_FILTERS.PRIORITY_TOKENS.includes(tokenAddress.toLowerCase());
                
                // Compare all market pairs for this token
                for (let i = 0; i < markets.length; i++) {
                    for (let j = i + 1; j < markets.length; j++) {
                        totalComparisons++;
                        const market1 = markets[i] as EthMarket;
                        const market2 = markets[j] as EthMarket;

                        try {
                            // Quick reserve validation before expensive calculations
                            const reserves1 = await market1.getReservesByToken();
                            const reserves2 = await market2.getReservesByToken();
                            
                            if (!Array.isArray(reserves1) || !Array.isArray(reserves2)) {
                                filteredByReserves++;
                                continue;
                            }

                            // Apply market filters early
                            if (!MarketFilterValidator.validateLiquidity([reserves1[0], reserves1[1]], MARKET_FILTERS) ||
                                !MarketFilterValidator.validateLiquidity([reserves2[0], reserves2[1]], MARKET_FILTERS)) {
                                filteredByReserves++;
                                continue;
                            }

                            // Calculate prices for quick spread check
                            const price1 = reserves1[1].mul(this.PRECISION).div(reserves1[0]);
                            const price2 = reserves2[1].mul(this.PRECISION).div(reserves2[0]);
                            
                            // Calculate spread in basis points
                            const priceDiff = price1.gt(price2) ? price1.sub(price2) : price2.sub(price1);
                            const avgPrice = price1.add(price2).div(2);
                            const spreadBps = avgPrice.gt(0) ? priceDiff.mul(10000).div(avgPrice).toNumber() : 0;
                            
                            // Check if there's a meaningful price difference
                            if (!MarketFilterValidator.validateSpread(spreadBps, MARKET_FILTERS)) {
                                filteredBySpread++;
                                continue;
                            }

                            // Calculate arbitrage in both directions with priority for priority tokens
                            const opportunities_temp = [];
                            
                            const opportunity1 = await this.calculateOptimalTrade(
                                market1, market2, tokenAddress
                            );
                            if (opportunity1) opportunities_temp.push(opportunity1);
                            
                            const opportunity2 = await this.calculateOptimalTrade(
                                market2, market1, tokenAddress
                            );
                            if (opportunity2) opportunities_temp.push(opportunity2);

                            // Select best opportunity
                            if (opportunities_temp.length > 0) {
                                const bestOpportunity = opportunities_temp.reduce((best, current) => 
                                    current.netProfit.gt(best.netProfit) ? current : best
                                );

                                // Apply more aggressive profit threshold for priority tokens
                                const effectiveMinProfit = isPriorityToken 
                                    ? this.config.minProfitWei.div(2)  // Half the minimum for priority tokens
                                    : this.config.minProfitWei;

                                if (bestOpportunity.netProfit.gte(effectiveMinProfit)) {
                                    opportunities.push(bestOpportunity);
                                } else {
                                    filteredByProfit++;
                                }
                            }
                        } catch (error) {
                            logger.debug('Error calculating arbitrage opportunity', {
                                tokenAddress: tokenAddress.slice(0, 8) + '...',
                                market1: market1.marketAddress.slice(0, 8) + '...',
                                market2: market2.marketAddress.slice(0, 8) + '...',
                                error: error instanceof Error ? error.message : String(error)
                            });
                        }
                    }
                }
            }

            // Sort by net profit descending
            opportunities.sort((a, b) => b.netProfit.gt(a.netProfit) ? 1 : -1);

            // Enhanced logging with detailed statistics
            logger.info('Enhanced arbitrage discovery completed', {
                totalComparisons,
                opportunitiesFound: opportunities.length,
                filteredByReserves,
                filteredBySpread,
                filteredByProfit,
                successRate: totalComparisons > 0 ? `${((opportunities.length / totalComparisons) * 100).toFixed(3)}%` : '0%',
                topOpportunities: opportunities.slice(0, 3).map(opp => ({
                    netProfitETH: formatEther(opp.netProfit),
                    profitBps: opp.profitPercentage.toString(),
                    inputETH: formatEther(opp.optimalInputAmount)
                }))
            });

            if (opportunities.length === 0) {
                // Provide actionable insights
                const insights = [];
                if (filteredByReserves > totalComparisons * 0.5) {
                    insights.push('Many markets filtered by liquidity - consider lowering MIN_LIQUIDITY_USD');
                }
                if (filteredBySpread > totalComparisons * 0.3) {
                    insights.push('Price spreads too small - market is efficient or thresholds too high');
                }
                if (filteredByProfit > 0) {
                    insights.push('Opportunities exist but profit after gas too low - check gas settings');
                }
                
                logger.info('No opportunities found - optimization suggestions:', { insights });
            }

            return opportunities;

        } catch (error) {
            logger.error('Error in enhanced analytical arbitrage discovery', {
                error: error instanceof Error ? error : new Error(String(error))
            });
            return [];
        }
    }

    /**
     * Calculate optimal trade size using correct Uniswap V2 formula
     * Formula: δ_optimal = (√(R₁ × R₂ × external_price) - R₁) / (1 + fee)
     */
    public async calculateOptimalTrade(
        buyMarket: EthMarket,
        sellMarket: EthMarket,
        tokenAddress: string
    ): Promise<ArbitrageOpportunity | null> {
        try {
            // Get reserves for both markets
            const buyReserves = await buyMarket.getReservesByToken();
            const sellReserves = await sellMarket.getReservesByToken();

            if (!Array.isArray(buyReserves) || !Array.isArray(sellReserves)) {
                throw new Error('Expected reserves to be arrays');
            }

            const [buyR0, buyR1] = buyReserves;
            const [sellR0, sellR1] = sellReserves;

            // Validate reserves
            if (buyR0.eq(0) || buyR1.eq(0) || sellR0.eq(0) || sellR1.eq(0)) {
                return null;
            }

            // Calculate current prices (token1/token0 ratio)
            const buyPrice = buyR1.mul(this.PRECISION).div(buyR0);
            const sellPrice = sellR1.mul(this.PRECISION).div(sellR0);

            // Check if there's a profitable price difference with more aggressive threshold
            const minPriceDifferencePercent = MARKET_FILTERS.MIN_SPREAD_BASIS_POINTS / 10000; // Convert basis points to decimal
            const priceDifferencePercent = sellPrice.sub(buyPrice).mul(10000).div(buyPrice).toNumber() / 10000;
            
            if (sellPrice.lte(buyPrice) || priceDifferencePercent < minPriceDifferencePercent) {
                return null; // No significant arbitrage opportunity
            }

            // Calculate optimal input amount using Uniswap V2 formula
            // δ_optimal = (√(R₁ × R₂ × P_external) - R₁) / (1 + fee)
            const target = buyR0.mul(buyR1).mul(sellPrice).div(this.PRECISION);
            const sqrtTarget = this.sqrtBigNumber(target);

            if (sqrtTarget.lte(buyR0)) {
                return null; // No profitable trade size
            }

            // Calculate optimal input amount with fee adjustment
            const optimalInput = sqrtTarget.sub(buyR0)
                .mul(this.FEE_DENOMINATOR)
                .div(this.FEE_DENOMINATOR.add(this.FEE_NUMERATOR));

            // Limit trade size based on liquidity constraints
            const maxTradeSize = buyR0.mul(this.config.maxTradePercentOfLiquidity).div(100);
            const finalInputAmount = optimalInput.gt(maxTradeSize) ? maxTradeSize : optimalInput;

            if (finalInputAmount.lte(0)) {
                return null;
            }

            // Calculate expected output from buy market
            const outputFromBuy = this.getAmountOut(finalInputAmount, buyR0, buyR1);
            
            // Calculate expected output from sell market (selling the token we just bought)
            const finalOutput = this.getAmountOut(outputFromBuy, sellR1, sellR0);

            // Calculate profit
            const grossProfit = finalOutput.sub(finalInputAmount);
            
            // Estimate gas costs
            const gasEstimate = this.estimateGasAndProfit(finalInputAmount);
            const gasCost = gasEstimate.mul(this.config.maxGasPriceGwei).mul(1000000000); // Convert to wei

            const netProfit = grossProfit.sub(gasCost);

            // Calculate profit percentage
            const profitPercentage = grossProfit.mul(10000).div(finalInputAmount); // Basis points

            // Validate minimum profit threshold
            if (netProfit.lt(this.config.minProfitWei)) {
                return null;
            }

            // Check slippage constraints
            const slippage = this.calculateSlippage(finalInputAmount, buyR0, outputFromBuy, buyR1);
            if (slippage > this.config.maxSlippagePercent) {
                return null;
            }

            return {
                buyMarket,
                sellMarket,
                tokenAddress,
                optimalInputAmount: finalInputAmount,
                expectedProfit: grossProfit,
                profitPercentage,
                gasEstimate,
                netProfit
            };

        } catch (error) {
            logger.error('Error in calculateOptimalTrade', {
                buyMarket: buyMarket.marketAddress,
                sellMarket: sellMarket.marketAddress,
                tokenAddress,
                error: error instanceof Error ? error : new Error(String(error))
            });
            return null;
        }
    }

    /**
     * Calculate output amount using Uniswap V2 formula with proper fee handling
     */
    private getAmountOut(amountIn: BigNumber, reserveIn: BigNumber, reserveOut: BigNumber): BigNumber {
        if (amountIn.eq(0) || reserveIn.eq(0) || reserveOut.eq(0)) {
            return BigNumber.from(0);
        }

        const amountInWithFee = amountIn.mul(this.FEE_NUMERATOR);
        const numerator = amountInWithFee.mul(reserveOut);
        const denominator = reserveIn.mul(this.FEE_DENOMINATOR).add(amountInWithFee);
        
        return numerator.div(denominator);
    }

    /**
     * Square root approximation using Newton's method for BigNumber
     */
    private sqrtBigNumber(value: BigNumber): BigNumber {
        if (value.eq(0)) return BigNumber.from(0);
        if (value.eq(1)) return BigNumber.from(1);
        
        let x = value;
        let y = value.add(1).div(2);
        
        const tolerance = BigNumber.from('1000000000000'); // 1e-6 ETH tolerance
        
        for (let i = 0; i < 50; i++) {
            x = y;
            y = x.add(value.div(x)).div(2);
            
            // Check for convergence
            if (x.sub(y).abs().lte(tolerance)) {
                break;
            }
        }
        
        return x;
    }

    /**
     * Estimate gas cost for arbitrage transaction
     */
    private estimateGasAndProfit(inputAmount: BigNumber): BigNumber {
        // Base gas cost for arbitrage (swap + flashloan + overhead)
        const baseGas = BigNumber.from('350000'); // Conservative estimate
        
        // Additional gas based on input amount (larger trades may need more gas)
        const additionalGas = inputAmount.div(this.ONE_ETH).mul(10000); // 10k gas per ETH
        
        return baseGas.add(additionalGas);
    }

    /**
     * Calculate slippage percentage for a trade
     */
    private calculateSlippage(
        inputAmount: BigNumber,
        inputReserve: BigNumber,
        outputAmount: BigNumber,
        outputReserve: BigNumber
    ): number {
        // Calculate expected output without slippage (linear price)
        const spotPrice = outputReserve.mul(this.PRECISION).div(inputReserve);
        const expectedOutput = inputAmount.mul(spotPrice).div(this.PRECISION);
        
        // Calculate slippage percentage
        const slippage = expectedOutput.sub(outputAmount).mul(10000).div(expectedOutput);
        
        return slippage.toNumber() / 100; // Convert basis points to percentage
    }

    /**
     * Convert ArbitrageOpportunity to CrossedMarketDetails for compatibility
     */
    public convertToCrossedMarketDetails(opportunities: ArbitrageOpportunity[]): CrossedMarketDetails[] {
        return opportunities.map(opp => ({
            buyFromMarket: opp.buyMarket,
            sellToMarket: opp.sellMarket,
            tokenAddress: opp.tokenAddress,
            profit: opp.netProfit,
            volume: opp.optimalInputAmount,
            marketPairs: [
                {
                    market: opp.buyMarket,
                    tokens: opp.buyMarket.tokens
                },
                {
                    market: opp.sellMarket,
                    tokens: opp.sellMarket.tokens
                }
            ]
        }));
    }

    /**
     * Validate mathematical precision and overflow checks
     */
    private validateCalculation(value: BigNumber, context: string): boolean {
        // Check for overflow (values too large)
        const MAX_SAFE_VALUE = BigNumber.from('0xffffffffffffffffffffffffffffffff');
        if (value.gt(MAX_SAFE_VALUE)) {
            logger.warn(`Value overflow detected in ${context}`, { value: value.toString() });
            return false;
        }

        // Check for underflow (negative values where they shouldn't be)
        if (value.lt(0)) {
            logger.warn(`Negative value detected in ${context}`, { value: value.toString() });
            return false;
        }

        return true;
    }

    /**
     * Get engine statistics for monitoring
     */
    public getEngineStats(): {
        totalOpportunitiesFound: number;
        averageProfit: string;
        averageGasCost: string;
        successRate: number;
    } {
        // This would be implemented with actual tracking in production
        return {
            totalOpportunitiesFound: 0,
            averageProfit: '0',
            averageGasCost: '0',
            successRate: 0
        };
    }
}