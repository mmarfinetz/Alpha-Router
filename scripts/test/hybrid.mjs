import { BigNumber } from '@ethersproject/bignumber';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import * as sinon from 'sinon';

// Import from the built JS files
import { HybridOptimizer } from '../../dist/src/optimization/HybridOptimizer.js';

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
        // Simple mock implementation
        const delta = prices.map(p => p.mul('1000000000000000')); // 0.001 ETH per unit
        const value = delta.reduce((a, b) => a.add(b), BigNumber.from(0));
        return { delta, value };
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

// Create optimizer instance
const optimizer = new HybridOptimizer(
    [mockCFMM],
    mockUtility,
    {
        maxIterations: 10,
        tolerance: 1e-6,
        memory: 5
    }
);

// Test the optimizer
const initialV = [
    BigNumber.from('1000000000000000000'), // 1 ETH
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