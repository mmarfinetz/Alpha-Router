import { expect } from 'chai';
import { BigNumber } from '@ethersproject/bignumber';
import { HybridOptimizer } from '../src/optimization/HybridOptimizer';
import { CFMM } from '../src/cfmm/CFMM';
import { UtilityFunction } from '../src/utility/UtilityFunction';
import { Provider } from '@ethersproject/abstract-provider';
import * as sinon from 'sinon';

describe('HybridOptimizer', () => {
    let optimizer: HybridOptimizer;
    let mockCFMM: CFMM;
    let mockUtility: UtilityFunction;
    let mockProvider: Provider;

    beforeEach(() => {
        // Create mock CFMM
        mockCFMM = {
            reserves: [
                BigNumber.from('1000000000000000000'), // 1 ETH
                BigNumber.from('2000000000000000000')  // 2 ETH
            ],
            fee: 0.003, // 0.3%
            A: [[1, 0], [0, 1]], // Identity matrix for simple test case
            marketAddress: '0x1234567890123456789012345678901234567890',
            tradingFunction: (reserves: BigNumber[]) => {
                return reserves[0].mul(reserves[1]); // x * y = k
            },
            tradingFunctionGradient: (reserves: BigNumber[]) => {
                return [reserves[1], reserves[0]]; // [y, x]
            },
            arbitrage: async (prices: BigNumber[]) => {
                // Simple profitable mock implementation that always returns positive value
                const delta = [
                    BigNumber.from('100000000000000000'), // 0.1 ETH
                    BigNumber.from('200000000000000000')  // 0.2 ETH
                ];
                const value = BigNumber.from('50000000000000000'); // 0.05 ETH profit
                return { delta, value };
            },
            updateReserves: async () => {
                // No-op for testing
            }
        };

        // Create mock utility function
        mockUtility = {
            U: (delta: BigNumber[]) => {
                // Simple linear utility function that doesn't cause BigNumber overflow
                return delta.reduce((a, b) => a.add(b), BigNumber.from(0));
            },
            U_optimal: (v: BigNumber[]) => {
                // Returns zero value and simple gradient for stable testing
                const value = BigNumber.from(0);
                const gradient = v.map(() => BigNumber.from('1000000000000000')); // 0.001 ETH
                return { value, gradient };
            }
        };

        // Create optimizer instance
        optimizer = new HybridOptimizer(
            [mockCFMM],
            mockUtility,
            {
                maxIterations: 10,
                tolerance: 1e-6,
                memory: 5
            }
        );
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('optimize', () => {
        it('should converge to optimal solution for simple case', async () => {
            const initialV = [
                BigNumber.from('1000000000000000000'), // 1 ETH
                BigNumber.from('1000000000000000000')  // 1 ETH
            ];

            const result = await optimizer.optimize(initialV);

            expect(result.converged).to.be.true;
            expect(result.iterations).to.be.lessThanOrEqual(10);
            expect(result.v.length).to.equal(2);
            expect(result.dualValue.gt(0)).to.be.true;
        });

        it('should handle zero initial prices', async () => {
            const initialV = [
                BigNumber.from(0),
                BigNumber.from(0)
            ];

            const result = await optimizer.optimize(initialV);

            expect(result.v.length).to.equal(2);
            expect(result.v.every(v => v.gte(0))).to.be.true;
        });

        it('should respect bounds from active intervals', async () => {
            const initialV = [
                BigNumber.from('2000000000000000000'), // 2 ETH
                BigNumber.from('2000000000000000000')  // 2 ETH
            ];

            const result = await optimizer.optimize(initialV);

            // Check that final prices are within reasonable bounds
            result.v.forEach(v => {
                expect(v.gt(0)).to.be.true;
                // Assuming max price should be around 10 ETH for this test
                expect(v.lt(BigNumber.from('10000000000000000000').mul(10))).to.be.true;
            });
        });

        it('should handle failed market queries gracefully', async () => {
            // Mock a failing arbitrage call
            const failingCFMM = {
                ...mockCFMM,
                arbitrage: async () => {
                    throw new Error('Market query failed');
                }
            };

            const optimizerWithFailingMarket = new HybridOptimizer(
                [failingCFMM],
                mockUtility,
                {
                    maxIterations: 10,
                    tolerance: 1e-6,
                    memory: 5
                }
            );

            const initialV = [
                BigNumber.from('1000000000000000000'),
                BigNumber.from('1000000000000000000')
            ];

            try {
                await optimizerWithFailingMarket.optimize(initialV);
                expect.fail('Should have thrown an error');
            } catch (error) {
                expect(error).to.be.instanceOf(Error);
                expect((error as Error).message).to.include('Market query failed');
            }
        });
    });
}); 