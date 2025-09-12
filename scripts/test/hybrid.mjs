import { BigNumber } from '@ethersproject/bignumber';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import * as sinon from 'sinon';

// Import from the built JS files
import { HybridOptimizer } from '../../build/src/optimization/HybridOptimizer.js';

// Simple test to check if the optimizer works
console.log('Testing HybridOptimizer...');

// Create mock CFMM
const mockCFMM = {
    reserves: [
        BigNumber.from('1000000000000000000'), // 1 ETH
        BigNumber.from('2000000000000000000')  // 2 ETH
    ],
    fee: 0.003, // 0.3%
    A: [[1, 0], [0, 1]], // Identity matrix for simple test case
    marketAddress: '0x1234567890123456789012345678901234567890',
    tradingFunction: (reserves) => {
        return reserves[0].mul(reserves[1]); // x * y = k
    },
    tradingFunctionGradient: (reserves) => {
        return [reserves[1], reserves[0]]; // [y, x]
    },
    arbitrage: async (prices) => {
        // More realistic arbitrage calculation
        // Only return positive value if there's actual arbitrage opportunity
        const [p0, p1] = prices;
        const [r0, r1] = mockCFMM.reserves;
        
        // Check if market price differs from AMM price
        const marketPrice = p1.mul('1000000000000000000').div(p0); // p1/p0
        const ammPrice = r0.mul('1000000000000000000').div(r1); // r0/r1
        
        if (marketPrice.gt(ammPrice.mul(1005).div(1000))) { // > 0.5% difference
            // Small profitable arbitrage
            const delta0 = BigNumber.from('10000000000000000'); // 0.01 ETH
            const delta1 = delta0.mul(ammPrice).div('1000000000000000000').mul(-1);
            const profit = delta0.mul(marketPrice.sub(ammPrice)).div('1000000000000000000');
            return { 
                delta: [delta0, delta1], 
                value: profit.gt(0) ? profit : BigNumber.from(0)
            };
        }
        
        return { delta: [BigNumber.from(0), BigNumber.from(0)], value: BigNumber.from(0) };
    },
    updateReserves: async () => {
        // No-op for testing
    }
};

// Create mock utility function
const mockUtility = {
    U: (delta) => {
        // Simple quadratic utility function
        return delta.reduce((a, b) => a.add(b.mul(b)), BigNumber.from(0));
    },
    U_optimal: (v) => {
        // Simple quadratic utility function
        const value = v.reduce((a, b) => a.add(b.mul(b)), BigNumber.from(0));
        const gradient = v.map(vi => vi.mul(2));
        return { value, gradient };
    }
};

// Create optimizer instance with better parameters
const optimizer = new HybridOptimizer(
    [mockCFMM],
    mockUtility,
    {
        maxIterations: 50,
        tolerance: 1e-3, // More lenient tolerance
        memory: 5
    }
);

// Test the optimizer with realistic initial prices
const initialV = [
    BigNumber.from('2000000000000000000'), // 2 ETH (matches mock reserves)
    BigNumber.from('1000000000000000000')  // 1 ETH
];

async function runTest() {
    try {
        const result = await optimizer.optimize(initialV);
        console.log('Optimization result:');
        console.log('- Converged:', result.converged);
        console.log('- Iterations:', result.iterations);
        console.log('- Dual value:', result.dualValue.toString());
        console.log('- v:', result.v.map(v => v.toString()));
        
        if (result.converged && result.iterations < 10 && 
            result.v.length === 2 && result.dualValue.gt(0)) {
            console.log('✅ Test passed!');
        } else {
            console.log('❌ Test failed!');
        }
    } catch (error) {
        console.error('Error during optimization:', error);
    }
}

runTest(); 