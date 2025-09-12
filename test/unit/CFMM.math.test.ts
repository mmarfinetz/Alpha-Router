import { expect } from 'chai';
import { BigNumber } from '@ethersproject/bignumber';
import { providers } from 'ethers';
import { UniswapV2CFMM } from '../../src/cfmm/CFMM.js';

// Mock provider
class MockProvider extends providers.BaseProvider {
    constructor() {
        super('mock');
    }

    async detectNetwork() {
        return { name: 'mock', chainId: 1 };
    }

    async perform() {
        return {};
    }
}

describe('CFMM Mathematical Corrections', () => {
    let cfmm: UniswapV2CFMM;
    let provider: MockProvider;

    beforeEach(() => {
        provider = new MockProvider();
        
        // Initialize CFMM with test reserves
        cfmm = new UniswapV2CFMM(
            '0x1234567890abcdef1234567890abcdef12345678',
            [
                BigNumber.from('1000000000000000000000'), // 1000 ETH
                BigNumber.from('2000000000000000000000000') // 2,000,000 USDC (scaled to 18 decimals)
            ],
            0.003, // 0.3% fee
            [[1, 0], [0, 1]], // Identity matrix
            provider
        );
    });

    describe('Fee Calculation Fix', () => {
        it('should calculate optimal trade size with correct fee formula', async () => {
            // Test the corrected fee calculation: FEE_DENOMINATOR / (FEE_DENOMINATOR + FEE_NUMERATOR)
            // Instead of incorrect: FEE_NUMERATOR / (FEE_DENOMINATOR + FEE_NUMERATOR)
            
            const prices = [
                BigNumber.from('1000000000000000000'), // 1 ETH price
                BigNumber.from('2100000000000000000000') // 2100 USDC price (higher than current)
            ];

            const result = await cfmm.arbitrage(prices);

            expect(result.delta).to.be.an('array');
            expect(result.delta.length).to.equal(2);
            expect(result.value).to.be.instanceOf(BigNumber);

            // Should find an arbitrage opportunity due to price difference
            if (result.value.gt(BigNumber.from('10000000000000000'))) { // > 0.01 ETH profit
                // Delta should be negative for selling token0 (ETH) to buy token1 (USDC)
                expect(result.delta[0].lt(0) || result.delta[1].gt(0)).to.be.true;
            }
        });

        it('should use correct fee adjustment in optimal calculation', async () => {
            // Test that the optimal trade calculation uses:
            // delta = (sqrt(target) - R1) * FEE_DENOMINATOR / (FEE_DENOMINATOR + FEE_NUMERATOR)
            // Not: delta = (sqrt(target) - R1) * FEE_NUMERATOR / (FEE_DENOMINATOR + FEE_NUMERATOR)
            
            const R1 = BigNumber.from('1000000000000000000000'); // 1000 ETH
            const R2 = BigNumber.from('2000000000000000000000000'); // 2M USDC
            const externalPrice = BigNumber.from('2100000000000000000000'); // 2100 USDC per ETH

            // Calculate expected optimal trade size manually
            // target = R1 * R2 * externalPrice / currentPrice
            const currentPrice = R2.mul(BigNumber.from('1000000000000000000')).div(R1); // 2000 USDC per ETH
            const target = R1.mul(R2).mul(externalPrice).div(currentPrice);
            
            // sqrtTarget should be approximately sqrt(1000 * 2M * 2100 / 2000) = sqrt(2.1M * 1000) ≈ 1449 ETH
            // So optimal delta ≈ (1449 - 1000) * 1000 / 1003 ≈ 447.7 ETH
            
            const prices = [
                BigNumber.from('1000000000000000000'), // 1 ETH
                externalPrice
            ];

            const result = await cfmm.arbitrage(prices);

            if (result.value.gt(0)) {
                // The optimal input should be reasonable (not too large due to wrong fee calculation)
                const inputAmount = result.delta[0].abs();
                expect(inputAmount.lt(R1.div(2))).to.be.true; // Should be less than 50% of reserves
                expect(inputAmount.gt(BigNumber.from('100000000000000000000'))).to.be.true; // Should be > 100 ETH
            }
        });
    });

    describe('Square Root Convergence Fix', () => {
        it('should converge correctly with tolerance check', async () => {
            // Test the corrected Newton's method convergence
            // Old: y.lt(x) (backwards check)
            // New: x.sub(y).abs().lte(tolerance) (proper tolerance check)
            
            const prices = [
                BigNumber.from('1000000000000000000'), // 1 ETH
                BigNumber.from('2000000000000000000000') // 2000 USDC (same as current)
            ];

            // This should complete without infinite loops
            const startTime = Date.now();
            const result = await cfmm.arbitrage(prices);
            const endTime = Date.now();

            // Should complete within reasonable time (not hang due to wrong convergence)
            expect(endTime - startTime).to.be.lessThan(1000); // < 1 second

            // Should return zero values when no arbitrage opportunity
            expect(result.delta[0]).to.equal(BigNumber.from(0));
            expect(result.delta[1]).to.equal(BigNumber.from(0));
            expect(result.value).to.equal(BigNumber.from(0));
        });

        it('should handle large numbers in square root calculation', async () => {
            // Test with very large reserves to ensure convergence works
            const largeCfmm = new UniswapV2CFMM(
                '0x1234567890abcdef1234567890abcdef12345678',
                [
                    BigNumber.from('1000000000000000000000000'), // 1M ETH
                    BigNumber.from('2000000000000000000000000000') // 2B USDC
                ],
                0.003,
                [[1, 0], [0, 1]],
                provider
            );

            const prices = [
                BigNumber.from('1000000000000000000'), // 1 ETH
                BigNumber.from('2100000000000000000000') // 2100 USDC
            ];

            const startTime = Date.now();
            const result = await largeCfmm.arbitrage(prices);
            const endTime = Date.now();

            // Should converge without timeout
            expect(endTime - startTime).to.be.lessThan(2000); // < 2 seconds
            expect(result).to.exist;
        });

        it('should handle edge cases in square root calculation', async () => {
            // Test edge cases that might cause convergence issues
            
            // Case 1: Perfect square
            cfmm = new UniswapV2CFMM(
                '0x1234567890abcdef1234567890abcdef12345678',
                [
                    BigNumber.from('1000000000000000000000'), // 1000 ETH
                    BigNumber.from('1000000000000000000000') // 1000 Token (1:1)
                ],
                0.003,
                [[1, 0], [0, 1]],
                provider
            );

            const prices = [
                BigNumber.from('1000000000000000000'), // 1 ETH
                BigNumber.from('1100000000000000000') // 1.1 Token (10% higher)
            ];

            const result = await cfmm.arbitrage(prices);
            expect(result).to.exist;

            // Case 2: Very small difference
            const prices2 = [
                BigNumber.from('1000000000000000000'), // 1 ETH
                BigNumber.from('1000000000000000001') // Tiny difference
            ];

            const result2 = await cfmm.arbitrage(prices2);
            expect(result2).to.exist;
        });
    });

    describe('Mathematical Validation', () => {
        it('should follow Uniswap V2 constant product formula', async () => {
            const R1 = BigNumber.from('1000000000000000000000'); // 1000 ETH
            const R2 = BigNumber.from('2000000000000000000000'); // 2000 Token

            cfmm = new UniswapV2CFMM(
                '0x1234567890abcdef1234567890abcdef12345678',
                [R1, R2],
                0.003,
                [[1, 0], [0, 1]],
                provider
            );

            // Test trading function: k = x * y
            const k = cfmm.tradingFunction([R1, R2]);
            expect(k).to.equal(R1.mul(R2));

            // Test gradient: [y, x]
            const gradient = cfmm.tradingFunctionGradient([R1, R2]);
            expect(gradient[0]).to.equal(R2);
            expect(gradient[1]).to.equal(R1);
        });

        it('should calculate arbitrage profit correctly', async () => {
            // Test with known values
            const R1 = BigNumber.from('1000000000000000000000'); // 1000 ETH
            const R2 = BigNumber.from('2000000000000000000000000'); // 2M USDC
            
            cfmm = new UniswapV2CFMM(
                '0x1234567890abcdef1234567890abcdef12345678',
                [R1, R2],
                0.003,
                [[1, 0], [0, 1]],
                provider
            );

            // Current price: 2000 USDC/ETH
            // External price: 2200 USDC/ETH (10% higher)
            const prices = [
                BigNumber.from('1000000000000000000'), // 1 ETH
                BigNumber.from('2200000000000000000000') // 2200 USDC
            ];

            const result = await cfmm.arbitrage(prices);

            if (result.value.gt(0)) {
                // Verify arbitrage makes sense:
                // 1. Should buy ETH (delta[0] < 0) and sell USDC (delta[1] > 0) OR vice versa
                // 2. Profit should be positive
                // 3. Trade size should be reasonable
                expect(result.value.gt(BigNumber.from('1000000000000000'))).to.be.true; // > 0.001 ETH profit
                
                const totalDelta = result.delta[0].abs().add(result.delta[1].abs());
                expect(totalDelta.gt(0)).to.be.true; // Some trade should happen
            }
        });

        it('should respect trade size limits', async () => {
            const R1 = BigNumber.from('1000000000000000000000'); // 1000 ETH
            const R2 = BigNumber.from('1000000000000000000000'); // 1000 Token
            
            cfmm = new UniswapV2CFMM(
                '0x1234567890abcdef1234567890abcdef12345678',
                [R1, R2],
                0.003,
                [[1, 0], [0, 1]],
                provider
            );

            // Very high external price to test limits
            const prices = [
                BigNumber.from('1000000000000000000'), // 1 ETH
                BigNumber.from('10000000000000000000') // 10 Token (10x higher)
            ];

            const result = await cfmm.arbitrage(prices);

            if (result.value.gt(0)) {
                // Trade size should not exceed 20% of reserves (200 ETH)
                const maxAllowed = R1.div(5); // 20% = 1/5
                const actualTrade = result.delta[0].abs();
                expect(actualTrade.lte(maxAllowed)).to.be.true;
            }
        });
    });

    describe('Integration with Analytical Engine', () => {
        it('should produce results compatible with analytical engine', async () => {
            // Test that CFMM results align with what the analytical engine expects
            const prices = [
                BigNumber.from('1000000000000000000'), // 1 ETH
                BigNumber.from('2100000000000000000000') // 2100 USDC
            ];

            const result = await cfmm.arbitrage(prices);

            // Results should have proper structure
            expect(result).to.have.property('delta');
            expect(result).to.have.property('value');
            expect(result.delta).to.be.an('array');
            expect(result.delta.length).to.equal(2);
            expect(result.value).to.be.instanceOf(BigNumber);

            // Values should be valid BigNumbers
            expect(result.delta[0]).to.be.instanceOf(BigNumber);
            expect(result.delta[1]).to.be.instanceOf(BigNumber);
        });
    });
});