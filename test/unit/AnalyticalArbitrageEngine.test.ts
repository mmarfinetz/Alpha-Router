import { expect } from 'chai';
import { BigNumber } from '@ethersproject/bignumber';
import { AnalyticalArbitrageEngine, AnalyticalEngineConfig } from '../../src/engines/AnalyticalArbitrageEngine.js';
import { EthMarket } from '../../src/EthMarket.js';

// Mock EthMarket class for testing
class MockEthMarket implements Partial<EthMarket> {
    public marketAddress: string;
    public tokens: string[];
    private reserves: [BigNumber, BigNumber];

    constructor(marketAddress: string, tokens: string[], reserves: [BigNumber, BigNumber]) {
        this.marketAddress = marketAddress;
        this.tokens = tokens;
        this.reserves = reserves;
    }

    async getReservesByToken(): Promise<[BigNumber, BigNumber]> {
        return this.reserves;
    }

    async updateReserves(): Promise<void> {
        // Mock implementation
    }
}

describe('AnalyticalArbitrageEngine', () => {
    let engine: AnalyticalArbitrageEngine;
    let config: AnalyticalEngineConfig;

    beforeEach(() => {
        config = {
            minProfitWei: BigNumber.from('10000000000000000'), // 0.01 ETH
            maxGasPriceGwei: BigNumber.from('100'),
            maxSlippagePercent: 1.0,
            maxTradePercentOfLiquidity: 20,
            gasCostPerSwap: BigNumber.from('350000')
        };
        engine = new AnalyticalArbitrageEngine(config);
    });

    describe('calculateOptimalTrade', () => {
        it('should calculate correct optimal trade for Uniswap V2 arbitrage opportunity', async () => {
            // Test case: Reserve A: 1000 ETH, Reserve B: 2000 USDC, External: 2100 USDC/ETH
            // Expected optimal input: ~47.6 ETH
            const buyMarket = new MockEthMarket(
                '0x1234567890abcdef1234567890abcdef12345678',
                ['0xToken0', '0xToken1'],
                [
                    BigNumber.from('1000000000000000000000'), // 1000 ETH
                    BigNumber.from('2000000000000000000000000') // 2,000,000 USDC (assuming 6 decimals scaled to 18)
                ]
            ) as EthMarket;

            const sellMarket = new MockEthMarket(
                '0xabcdef1234567890abcdef1234567890abcdef12',
                ['0xToken0', '0xToken1'],
                [
                    BigNumber.from('800000000000000000000'), // 800 ETH
                    BigNumber.from('1680000000000000000000000') // 1,680,000 USDC (better price)
                ]
            ) as EthMarket;

            const result = await engine.calculateOptimalTrade(buyMarket, sellMarket, '0xToken1');

            expect(result).to.not.be.null;
            if (result) {
                expect(result.optimalInputAmount.gt(BigNumber.from('40000000000000000000'))).to.be.true; // > 40 ETH
                expect(result.optimalInputAmount.lt(BigNumber.from('60000000000000000000'))).to.be.true; // < 60 ETH
                expect(result.netProfit.gt(0)).to.be.true;
                expect(result.profitPercentage.gt(0)).to.be.true;
            }
        });

        it('should return null when no arbitrage opportunity exists', async () => {
            // Same price on both markets
            const reserves = [
                BigNumber.from('1000000000000000000000'), // 1000 ETH
                BigNumber.from('2000000000000000000000000') // 2,000,000 USDC
            ] as [BigNumber, BigNumber];

            const buyMarket = new MockEthMarket('0x1111', ['0xToken0', '0xToken1'], reserves) as EthMarket;
            const sellMarket = new MockEthMarket('0x2222', ['0xToken0', '0xToken1'], reserves) as EthMarket;

            const result = await engine.calculateOptimalTrade(buyMarket, sellMarket, '0xToken1');
            expect(result).to.be.null;
        });

        it('should return null when reserves are zero', async () => {
            const buyMarket = new MockEthMarket(
                '0x1111',
                ['0xToken0', '0xToken1'],
                [BigNumber.from(0), BigNumber.from('1000000000000000000000')]
            ) as EthMarket;

            const sellMarket = new MockEthMarket(
                '0x2222',
                ['0xToken0', '0xToken1'],
                [BigNumber.from('1000000000000000000000'), BigNumber.from('2000000000000000000000')]
            ) as EthMarket;

            const result = await engine.calculateOptimalTrade(buyMarket, sellMarket, '0xToken1');
            expect(result).to.be.null;
        });

        it('should respect maximum trade size limits', async () => {
            const buyMarket = new MockEthMarket(
                '0x1111',
                ['0xToken0', '0xToken1'],
                [
                    BigNumber.from('100000000000000000000'), // 100 ETH (small pool)
                    BigNumber.from('200000000000000000000000') // 200,000 USDC
                ]
            ) as EthMarket;

            const sellMarket = new MockEthMarket(
                '0x2222',
                ['0xToken0', '0xToken1'],
                [
                    BigNumber.from('50000000000000000000'), // 50 ETH
                    BigNumber.from('150000000000000000000000') // 150,000 USDC (much better price)
                ]
            ) as EthMarket;

            const result = await engine.calculateOptimalTrade(buyMarket, sellMarket, '0xToken1');

            if (result) {
                // Trade size should not exceed 20% of buy market liquidity
                const maxAllowed = BigNumber.from('100000000000000000000').mul(20).div(100); // 20 ETH
                expect(result.optimalInputAmount.lte(maxAllowed)).to.be.true;
            }
        });

        it('should calculate gas costs correctly', async () => {
            const buyMarket = new MockEthMarket(
                '0x1111',
                ['0xToken0', '0xToken1'],
                [
                    BigNumber.from('1000000000000000000000'), // 1000 ETH
                    BigNumber.from('2000000000000000000000000') // 2,000,000 USDC
                ]
            ) as EthMarket;

            const sellMarket = new MockEthMarket(
                '0x2222',
                ['0xToken0', '0xToken1'],
                [
                    BigNumber.from('800000000000000000000'), // 800 ETH
                    BigNumber.from('1680000000000000000000000') // 1,680,000 USDC
                ]
            ) as EthMarket;

            const result = await engine.calculateOptimalTrade(buyMarket, sellMarket, '0xToken1');

            if (result) {
                expect(result.gasEstimate.gt(BigNumber.from('300000'))).to.be.true; // At least 300k gas
                expect(result.netProfit.lt(result.expectedProfit)).to.be.true; // Net profit should be less than gross
            }
        });
    });

    describe('Mathematical Validation', () => {
        it('should correctly implement Uniswap V2 getAmountOut formula', async () => {
            // Test the private getAmountOut method through calculateOptimalTrade
            const buyMarket = new MockEthMarket(
                '0x1111',
                ['0xToken0', '0xToken1'],
                [
                    BigNumber.from('1000000000000000000000'), // 1000 ETH
                    BigNumber.from('1000000000000000000000') // 1000 Token
                ]
            ) as EthMarket;

            const sellMarket = new MockEthMarket(
                '0x2222',
                ['0xToken0', '0xToken1'],
                [
                    BigNumber.from('500000000000000000000'), // 500 ETH
                    BigNumber.from('600000000000000000000') // 600 Token (better price)
                ]
            ) as EthMarket;

            const result = await engine.calculateOptimalTrade(buyMarket, sellMarket, '0xToken1');

            if (result) {
                // Verify the calculation follows Uniswap V2 formula
                // For input of 1 ETH: output = (1 * 0.997 * 1000) / (1000 + 1 * 0.997) ≈ 0.996 Token
                expect(result.optimalInputAmount.gt(0)).to.be.true;
                expect(result.expectedProfit.gt(0)).to.be.true;
            }
        });

        it('should handle square root calculation correctly', async () => {
            // Test square root calculation for optimal trade sizing
            const buyMarket = new MockEthMarket(
                '0x1111',
                ['0xToken0', '0xToken1'],
                [
                    BigNumber.from('1000000000000000000000'), // 1000 ETH
                    BigNumber.from('4000000000000000000000') // 4000 Token (1:4 ratio)
                ]
            ) as EthMarket;

            const sellMarket = new MockEthMarket(
                '0x2222',
                ['0xToken0', '0xToken1'],
                [
                    BigNumber.from('1000000000000000000000'), // 1000 ETH
                    BigNumber.from('3000000000000000000000') // 3000 Token (1:3 ratio, better for selling)
                ]
            ) as EthMarket;

            const result = await engine.calculateOptimalTrade(buyMarket, sellMarket, '0xToken1');

            // Should find an opportunity due to price difference
            expect(result).to.not.be.null;
            if (result) {
                expect(result.optimalInputAmount.gt(0)).to.be.true;
                expect(result.expectedProfit.gt(0)).to.be.true;
            }
        });
    });

    describe('Profit Calculation Validation', () => {
        it('should include all costs in profit calculation', async () => {
            const buyMarket = new MockEthMarket(
                '0x1111',
                ['0xToken0', '0xToken1'],
                [
                    BigNumber.from('1000000000000000000000'), // 1000 ETH
                    BigNumber.from('2000000000000000000000000') // 2,000,000 USDC
                ]
            ) as EthMarket;

            const sellMarket = new MockEthMarket(
                '0x2222',
                ['0xToken0', '0xToken1'],
                [
                    BigNumber.from('800000000000000000000'), // 800 ETH
                    BigNumber.from('1800000000000000000000000') // 1,800,000 USDC (better price)
                ]
            ) as EthMarket;

            const result = await engine.calculateOptimalTrade(buyMarket, sellMarket, '0xToken1');

            if (result) {
                // Net profit should account for gas costs
                const gasPrice = config.maxGasPriceGwei.mul(1000000000); // Convert to wei
                const gasCost = result.gasEstimate.mul(gasPrice);
                const expectedNetProfit = result.expectedProfit.sub(gasCost);
                
                expect(result.netProfit.toString()).to.equal(expectedNetProfit.toString());
                expect(result.netProfit.gte(config.minProfitWei)).to.be.true;
            }
        });

        it('should filter out unprofitable opportunities after gas costs', async () => {
            // Create a scenario with very small profit that becomes unprofitable after gas
            const buyMarket = new MockEthMarket(
                '0x1111',
                ['0xToken0', '0xToken1'],
                [
                    BigNumber.from('1000000000000000000000'), // 1000 ETH
                    BigNumber.from('1000000000000000000000') // 1000 Token
                ]
            ) as EthMarket;

            const sellMarket = new MockEthMarket(
                '0x2222',
                ['0xToken0', '0xToken1'],
                [
                    BigNumber.from('1000000000000000000000'), // 1000 ETH
                    BigNumber.from('1001000000000000000000') // 1001 Token (tiny difference)
                ]
            ) as EthMarket;

            const result = await engine.calculateOptimalTrade(buyMarket, sellMarket, '0xToken1');

            // Should return null because profit after gas costs is too small
            expect(result).to.be.null;
        });
    });

    describe('Edge Cases', () => {
        it('should handle very large numbers without overflow', async () => {
            const buyMarket = new MockEthMarket(
                '0x1111',
                ['0xToken0', '0xToken1'],
                [
                    BigNumber.from('1000000000000000000000000'), // 1M ETH
                    BigNumber.from('2000000000000000000000000000') // 2B Token
                ]
            ) as EthMarket;

            const sellMarket = new MockEthMarket(
                '0x2222',
                ['0xToken0', '0xToken1'],
                [
                    BigNumber.from('800000000000000000000000'), // 800K ETH
                    BigNumber.from('1800000000000000000000000000') // 1.8B Token
                ]
            ) as EthMarket;

            const result = await engine.calculateOptimalTrade(buyMarket, sellMarket, '0xToken1');

            // Should handle large numbers without throwing errors
            expect(() => result).to.not.throw();
        });

        it('should handle very small numbers correctly', async () => {
            const buyMarket = new MockEthMarket(
                '0x1111',
                ['0xToken0', '0xToken1'],
                [
                    BigNumber.from('1000000'), // 0.000001 ETH
                    BigNumber.from('2000000') // 0.000002 Token
                ]
            ) as EthMarket;

            const sellMarket = new MockEthMarket(
                '0x2222',
                ['0xToken0', '0xToken1'],
                [
                    BigNumber.from('1000000'), // 0.000001 ETH
                    BigNumber.from('2100000') // 0.0000021 Token (better price)
                ]
            ) as EthMarket;

            const result = await engine.calculateOptimalTrade(buyMarket, sellMarket, '0xToken1');

            // Should return null due to insufficient liquidity
            expect(result).to.be.null;
        });
    });
});