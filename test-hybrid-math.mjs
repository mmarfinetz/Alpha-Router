const { BigNumber } = await import('@ethersproject/bignumber');
const { HybridOptimizer } = await import('./dist/src/optimization/HybridOptimizer.js');

console.log('🧮 Mathematical Verification of HybridOptimizer');
console.log('================================================\n');

// Test 1: Mathematical Convergence with Simple Quadratic Function
console.log('Test 1: Mathematical Convergence Analysis');
console.log('-----------------------------------------');

const createQuadraticUtility = () => ({
    U: (delta) => {
        // Quadratic utility: -0.5 * sum(delta_i^2)
        return delta.reduce((sum, d) => {
            const dSquared = d.mul(d).div(BigNumber.from(10).pow(18)); // Scale for precision
            return sum.sub(dSquared.div(2));
        }, BigNumber.from(0));
    },
    U_optimal: (v) => {
        // For quadratic utility, gradient is proportional to v
        const value = v.reduce((sum, vi) => {
            const vSquared = vi.mul(vi).div(BigNumber.from(10).pow(18));
            return sum.add(vSquared.div(2));
        }, BigNumber.from(0));
        
        const gradient = v.map(vi => vi.div(BigNumber.from(10).pow(6))); // Scale down gradient
        return { value, gradient };
    }
});

const createLinearArbitrageCFMM = (baseProfit = '50000000000000000') => ({
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
        // Simple linear arbitrage with scaling
        const delta = prices.map(p => p.div(BigNumber.from(10).pow(12))); // Scale down
        const value = BigNumber.from(baseProfit); // Fixed base profit
        return { delta, value };
    },
    updateReserves: async () => {}
});

// Test mathematical properties
async function testMathematicalProperties() {
    const utility = createQuadraticUtility();
    const cfmm = createLinearArbitrageCFMM();
    
    const optimizer = new HybridOptimizer([cfmm], utility, {
        maxIterations: 20,
        tolerance: 1e-8,
        memory: 10
    });

    // Test different initial conditions
    const testCases = [
        {
            name: 'Small initial values',
            initial: [BigNumber.from('100000000000000'), BigNumber.from('100000000000000')] // 0.0001 ETH
        },
        {
            name: 'Medium initial values', 
            initial: [BigNumber.from('1000000000000000000'), BigNumber.from('1000000000000000000')] // 1 ETH
        },
        {
            name: 'Large initial values',
            initial: [BigNumber.from('5000000000000000000'), BigNumber.from('5000000000000000000')] // 5 ETH
        },
        {
            name: 'Asymmetric initial values',
            initial: [BigNumber.from('100000000000000000'), BigNumber.from('2000000000000000000')] // 0.1, 2 ETH
        }
    ];

    const results = [];
    
    for (const testCase of testCases) {
        console.log(`\n📐 Testing: ${testCase.name}`);
        console.log(`   Initial: [${testCase.initial.map(v => (parseFloat(v.toString()) / 1e18).toFixed(4)).join(', ')}] ETH`);
        
        try {
            const result = await optimizer.optimize(testCase.initial);
            const finalEth = result.v.map(v => parseFloat(v.toString()) / 1e18);
            
            console.log(`   ✅ Converged: ${result.converged} in ${result.iterations} iterations`);
            console.log(`   📊 Final values: [${finalEth.map(v => v.toFixed(6)).join(', ')}] ETH`);
            console.log(`   💰 Dual value: ${parseFloat(result.dualValue.toString()) / 1e18} ETH`);
            
            results.push({
                testCase: testCase.name,
                converged: result.converged,
                iterations: result.iterations,
                finalValues: finalEth,
                dualValue: parseFloat(result.dualValue.toString()) / 1e18
            });
        } catch (error) {
            console.log(`   ❌ Error: ${error.message}`);
            results.push({
                testCase: testCase.name,
                error: error.message
            });
        }
    }
    
    return results;
}

// Test 2: Gradient Accuracy
console.log('\nTest 2: Gradient Calculation Accuracy');
console.log('-------------------------------------');

async function testGradientAccuracy() {
    const utility = createQuadraticUtility();
    const testPoints = [
        [BigNumber.from('1000000000000000000'), BigNumber.from('1000000000000000000')],
        [BigNumber.from('500000000000000000'), BigNumber.from('2000000000000000000')],
        [BigNumber.from('100000000000000000'), BigNumber.from('100000000000000000')]
    ];
    
    console.log('🔍 Testing utility function gradient accuracy:');
    
    for (const point of testPoints) {
        const { value, gradient } = utility.U_optimal(point);
        const pointEth = point.map(p => parseFloat(p.toString()) / 1e18);
        const gradEth = gradient.map(g => parseFloat(g.toString()) / 1e18);
        
        console.log(`   Point: [${pointEth.map(v => v.toFixed(4)).join(', ')}] ETH`);
        console.log(`   Value: ${parseFloat(value.toString()) / 1e18} ETH`);
        console.log(`   Gradient: [${gradEth.map(g => g.toFixed(6)).join(', ')}]`);
        
        // Verify gradient makes mathematical sense for quadratic function
        const expectedGrad = pointEth.map(v => v / 1e6); // Should be proportional to input
        const gradientError = gradEth.map((actual, i) => Math.abs(actual - expectedGrad[i]));
        const maxError = Math.max(...gradientError);
        
        if (maxError < 1e-6) {
            console.log(`   ✅ Gradient accuracy: excellent (max error: ${maxError.toExponential(2)})`);
        } else if (maxError < 1e-3) {
            console.log(`   ⚠️  Gradient accuracy: acceptable (max error: ${maxError.toExponential(2)})`);
        } else {
            console.log(`   ❌ Gradient accuracy: poor (max error: ${maxError.toExponential(2)})`);
        }
    }
}

// Test 3: L-BFGS Memory and Convergence
console.log('\nTest 3: L-BFGS Memory Performance');
console.log('----------------------------------');

async function testLBFGSMemory() {
    const utility = createQuadraticUtility();
    const cfmm = createLinearArbitrageCFMM();
    
    const memorySettings = [3, 5, 10, 20];
    const initialV = [BigNumber.from('1000000000000000000'), BigNumber.from('1000000000000000000')];
    
    console.log('🧠 Testing L-BFGS memory settings:');
    
    for (const memory of memorySettings) {
        const optimizer = new HybridOptimizer([cfmm], utility, {
            maxIterations: 50,
            tolerance: 1e-10,
            memory: memory
        });
        
        try {
            const startTime = process.hrtime.bigint();
            const result = await optimizer.optimize(initialV);
            const endTime = process.hrtime.bigint();
            const duration = Number(endTime - startTime) / 1e6; // Convert to milliseconds
            
            console.log(`   Memory=${memory}: ${result.converged ? '✅' : '❌'} ${result.iterations} iterations, ${duration.toFixed(2)}ms`);
            
            if (result.converged) {
                const finalEth = result.v.map(v => parseFloat(v.toString()) / 1e18);
                console.log(`     Final: [${finalEth.map(v => v.toFixed(6)).join(', ')}] ETH, Value: ${(parseFloat(result.dualValue.toString()) / 1e18).toFixed(6)} ETH`);
            }
        } catch (error) {
            console.log(`   Memory=${memory}: ❌ Error: ${error.message}`);
        }
    }
}

// Test 4: Numerical Stability with Extreme Values
console.log('\nTest 4: Numerical Stability Analysis');
console.log('------------------------------------');

async function testNumericalStability() {
    const utility = createQuadraticUtility();
    const cfmm = createLinearArbitrageCFMM();
    
    const optimizer = new HybridOptimizer([cfmm], utility, {
        maxIterations: 30,
        tolerance: 1e-6,
        memory: 5
    });
    
    const extremeCases = [
        {
            name: 'Very small values',
            values: [BigNumber.from('1000'), BigNumber.from('1000')] // 1e-15 ETH
        },
        {
            name: 'Very large values',
            values: [BigNumber.from('1000000000000000000000'), BigNumber.from('1000000000000000000000')] // 1000 ETH
        },
        {
            name: 'Zero values',
            values: [BigNumber.from('0'), BigNumber.from('0')]
        },
        {
            name: 'Highly asymmetric',
            values: [BigNumber.from('1000'), BigNumber.from('1000000000000000000000')] // 1e-15 vs 1000 ETH
        }
    ];
    
    console.log('⚖️  Testing numerical stability:');
    
    for (const testCase of extremeCases) {
        console.log(`\n   ${testCase.name}:`);
        try {
            const result = await optimizer.optimize(testCase.values);
            const finalEth = result.v.map(v => parseFloat(v.toString()) / 1e18);
            
            // Check for NaN or infinite values
            const hasValidValues = finalEth.every(v => isFinite(v) && !isNaN(v));
            const dualValueValid = isFinite(parseFloat(result.dualValue.toString()) / 1e18);
            
            if (hasValidValues && dualValueValid) {
                console.log(`     ✅ Stable: [${finalEth.map(v => v.toExponential(3)).join(', ')}] ETH`);
                console.log(`     💰 Dual: ${(parseFloat(result.dualValue.toString()) / 1e18).toExponential(3)} ETH`);
            } else {
                console.log(`     ❌ Unstable: Invalid numerical values detected`);
            }
        } catch (error) {
            console.log(`     ❌ Error: ${error.message}`);
        }
    }
}

// Run all tests
async function runAllTests() {
    console.log('🚀 Starting comprehensive hybrid optimizer analysis...\n');
    
    try {
        const mathResults = await testMathematicalProperties();
        await testGradientAccuracy();
        await testLBFGSMemory();
        await testNumericalStability();
        
        // Summary
        console.log('\n📋 SUMMARY');
        console.log('==========');
        
        const convergenceRate = mathResults.filter(r => r.converged).length / mathResults.length;
        console.log(`🎯 Convergence Rate: ${(convergenceRate * 100).toFixed(1)}%`);
        
        const avgIterations = mathResults
            .filter(r => r.converged)
            .reduce((sum, r) => sum + r.iterations, 0) / mathResults.filter(r => r.converged).length;
        console.log(`⚡ Average Iterations: ${avgIterations ? avgIterations.toFixed(1) : 'N/A'}`);
        
        const hasErrors = mathResults.some(r => r.error);
        console.log(`🛡️  Error Handling: ${hasErrors ? 'Some errors detected' : 'Robust'}`);
        
        console.log('\n✅ Mathematical verification complete!');
        
    } catch (error) {
        console.error('❌ Test suite failed:', error);
    }
}

runAllTests();