const { BigNumber } = require('@ethersproject/bignumber');

// Import from the built JS files
const { HybridOptimizer } = require('./build/src/optimization/HybridOptimizer.js');

console.log('🧪 Simple HybridOptimizer Test');
console.log('==============================\n');

// Create mock CFMM
const mockCFMM = {
    reserves: [
        BigNumber.from('1000000000000000000'), // 1 ETH
        BigNumber.from('2000000000000000000')  // 2 ETH
    ],
    fee: 0.003,
    A: [[1, 0], [0, 1]],
    marketAddress: '0x1234567890123456789012345678901234567890',
    tradingFunction: (reserves) => reserves[0].mul(reserves[1]),
    tradingFunctionGradient: (reserves) => [reserves[1], reserves[0]],
    arbitrage: async (prices) => {
        const delta = [
            BigNumber.from('100000000000000000'), // 0.1 ETH
            BigNumber.from('200000000000000000')  // 0.2 ETH
        ];
        const value = BigNumber.from('50000000000000000'); // 0.05 ETH profit
        return { delta, value };
    },
    updateReserves: async () => {}
};

// Create mock utility function
const mockUtility = {
    U: (delta) => {
        return delta.reduce((a, b) => a.add(b), BigNumber.from(0));
    },
    U_optimal: (v) => {
        const value = BigNumber.from(0);
        const gradient = v.map(() => BigNumber.from('1000000000000000')); // 0.001 ETH
        return { value, gradient };
    }
};

async function runSimpleTest() {
    try {
        console.log('Creating HybridOptimizer instance...');
        const optimizer = new HybridOptimizer(
            [mockCFMM],
            mockUtility,
            {
                maxIterations: 10,
                tolerance: 1e-6,
                memory: 5
            }
        );

        console.log('Running optimization...');
        const initialV = [
            BigNumber.from('1000000000000000000'), // 1 ETH
            BigNumber.from('1000000000000000000')  // 1 ETH
        ];

        const result = await optimizer.optimize(initialV);
        
        console.log('\n📊 Results:');
        console.log('- Converged:', result.converged);
        console.log('- Iterations:', result.iterations);
        console.log('- Final values:', result.v.map(v => (parseFloat(v.toString()) / 1e18).toFixed(6) + ' ETH'));
        console.log('- Dual value:', (parseFloat(result.dualValue.toString()) / 1e18).toFixed(6) + ' ETH');
        
        // Test assertions
        const tests = [
            { name: 'Convergence', passed: result.converged === true },
            { name: 'Reasonable iterations', passed: result.iterations > 0 && result.iterations <= 10 },
            { name: 'Valid final values', passed: result.v.length === 2 && result.v.every(v => v.gt(0)) },
            { name: 'Positive dual value', passed: result.dualValue.gt(0) }
        ];
        
        console.log('\n🔍 Test Results:');
        tests.forEach(test => {
            console.log(`  ${test.passed ? '✅' : '❌'} ${test.name}`);
        });
        
        const allPassed = tests.every(test => test.passed);
        console.log(`\n${allPassed ? '🎉' : '❌'} Overall: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
        
    } catch (error) {
        console.error('❌ Test failed with error:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

runSimpleTest();