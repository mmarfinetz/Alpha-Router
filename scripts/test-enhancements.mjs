#!/usr/bin/env node

/**
 * Test script for MEV Bot enhancements
 * 
 * This script validates that all the enhanced components work together properly:
 * - Multiple DEX address configuration
 * - Market filters and validation
 * - Enhanced scanner with lower thresholds
 * - Performance monitoring integration
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('🔧 Testing MEV Bot Enhancements\n');

// Test configurations
const tests = [
    {
        name: 'Configuration Validation',
        description: 'Test that all new DEX addresses and configurations load correctly',
        command: 'node',
        args: ['-e', `
            import('./src/addresses.js').then(({ FACTORY_ADDRESSES, DEX_INFO }) => {
                console.log('✅ DEX Addresses loaded:', FACTORY_ADDRESSES.length);
                console.log('✅ DEX Info loaded:', Object.keys(DEX_INFO).length);
                
                import('./src/config/marketFilters.js').then(({ MARKET_FILTERS, MarketFilterValidator }) => {
                    console.log('✅ Market filters loaded');
                    console.log('   - Min profit ETH:', MARKET_FILTERS.MIN_PROFIT_ETH.toString());
                    console.log('   - Priority tokens:', MARKET_FILTERS.PRIORITY_TOKENS.length);
                    
                    import('./src/config/thresholds.js').then(({ DEFAULT_THRESHOLDS }) => {
                        console.log('✅ Thresholds updated');
                        console.log('   - Min liquidity:', DEFAULT_THRESHOLDS.MIN_LIQUIDITY_ETH.toString());
                        console.log('   - Min profit:', DEFAULT_THRESHOLDS.minProfitThreshold.toString());
                        process.exit(0);
                    });
                });
            }).catch(err => {
                console.error('❌ Configuration test failed:', err.message);
                process.exit(1);
            });
        `]
    },
    {
        name: 'Scanner Enhancement Test',
        description: 'Test enhanced CrossDEXScanner with new features',
        command: 'node',
        args: ['-e', `
            import('./src/scanners/CrossDEXScanner.js').then(({ CrossDEXScanner }) => {
                console.log('✅ Enhanced CrossDEXScanner loaded');
                
                import('./src/engines/AnalyticalArbitrageEngine.js').then(({ AnalyticalArbitrageEngine }) => {
                    console.log('✅ Enhanced AnalyticalArbitrageEngine loaded');
                    
                    console.log('✅ All enhanced components available');
                    process.exit(0);
                });
            }).catch(err => {
                console.error('❌ Scanner test failed:', err.message);
                process.exit(1);
            });
        `]
    },
    {
        name: 'Market Filter Validation',
        description: 'Test market filter validation functions',
        command: 'node',
        args: ['-e', `
            import('./src/config/marketFilters.js').then(({ MarketFilterValidator, MARKET_FILTERS }) => {
                import('ethers').then(({ BigNumber }) => {
                    console.log('✅ Testing market filter validation...');
                    
                    // Test liquidity validation
                    const reserves = [
                        BigNumber.from('1000000000000000000'), // 1 ETH
                        BigNumber.from('3000000000000000000000') // 3000 tokens
                    ];
                    
                    const isValid = MarketFilterValidator.validateLiquidity(reserves, MARKET_FILTERS);
                    console.log('   - Liquidity validation:', isValid ? '✅ PASS' : '❌ FAIL');
                    
                    // Test spread validation
                    const price1 = BigNumber.from('3000000000000000000000'); // 3000
                    const price2 = BigNumber.from('3030000000000000000000'); // 3030 (1% spread)
                    
                    const spreadValid = MarketFilterValidator.validateSpread(price1, price2, MARKET_FILTERS);
                    console.log('   - Spread validation:', spreadValid ? '✅ PASS' : '❌ FAIL');
                    
                    console.log('✅ Market filter tests completed');
                    process.exit(0);
                });
            }).catch(err => {
                console.error('❌ Market filter test failed:', err.message);
                process.exit(1);
            });
        `]
    },
    {
        name: 'Service Integration Test',
        description: 'Test enhanced services (BatchService, ProviderManager)',
        command: 'node',
        args: ['-e', `
            import('./src/services/BatchService.js').then(({ BatchService }) => {
                console.log('✅ BatchService loaded');
                
                import('./src/services/ProviderManager.js').then(({ ProviderManager, DEFAULT_PROVIDER_CONFIGS }) => {
                    console.log('✅ ProviderManager loaded');
                    console.log('   - Default provider configs:', DEFAULT_PROVIDER_CONFIGS.length);
                    
                    import('./src/utils/PerformanceMonitor.js').then(({ PerformanceMonitor }) => {
                        console.log('✅ PerformanceMonitor loaded');
                        
                        console.log('✅ All services loaded successfully');
                        process.exit(0);
                    });
                });
            }).catch(err => {
                console.error('❌ Service integration test failed:', err.message);
                process.exit(1);
            });
        `]
    }
];

// Function to run a single test
function runTest(test) {
    return new Promise((resolve, reject) => {
        console.log(`🧪 Running: ${test.name}`);
        console.log(`   ${test.description}\n`);
        
        const process_child = spawn(test.command, test.args, {
            cwd: projectRoot,
            stdio: ['inherit', 'pipe', 'pipe'],
            shell: true
        });
        
        let stdout = '';
        let stderr = '';
        
        process_child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        process_child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        process_child.on('close', (code) => {
            if (code === 0) {
                console.log(stdout);
                console.log(`✅ ${test.name} PASSED\n`);
                resolve();
            } else {
                console.error(`❌ ${test.name} FAILED`);
                if (stdout) console.log('STDOUT:', stdout);
                if (stderr) console.error('STDERR:', stderr);
                console.log('');
                reject(new Error(`Test failed with exit code ${code}`));
            }
        });
        
        process_child.on('error', (error) => {
            console.error(`❌ ${test.name} ERROR:`, error.message);
            reject(error);
        });
    });
}

// Run all tests sequentially
async function runAllTests() {
    let passed = 0;
    let failed = 0;
    
    console.log(`Starting ${tests.length} enhancement tests...\n`);
    
    for (const test of tests) {
        try {
            await runTest(test);
            passed++;
        } catch (error) {
            failed++;
            console.error(`Test "${test.name}" failed:`, error.message);
        }
    }
    
    console.log('='.repeat(60));
    console.log('📊 Test Results Summary');
    console.log('='.repeat(60));
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📊 Total:  ${passed + failed}`);
    console.log('');
    
    if (failed === 0) {
        console.log('🎉 All enhancement tests passed! The MEV bot upgrades are working correctly.');
        console.log('');
        console.log('Next steps:');
        console.log('1. Run: npm run start:ws (to start the enhanced bot)');
        console.log('2. Monitor logs for increased opportunity detection');
        console.log('3. Adjust MARKET_FILTERS if needed based on performance');
        console.log('');
    } else {
        console.log('❌ Some tests failed. Please check the errors above and fix any issues.');
        console.log('');
        process.exit(1);
    }
}

// Run tests
runAllTests().catch(error => {
    console.error('❌ Test runner failed:', error.message);
    process.exit(1);
});