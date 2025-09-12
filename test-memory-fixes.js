#!/usr/bin/env node

/**
 * Memory Leak Test Script
 * Tests the MEV bot for memory leaks and AbortSignal warnings
 */

const { spawn } = require('child_process');
const fs = require('fs');

console.log('🧪 Testing MEV Bot Memory Leak Fixes...');
console.log('═══════════════════════════════════════');

const testResults = {
  memoryLeakWarnings: 0,
  blockEventWarnings: 0,
  successfulOperations: 0,
  testDuration: 60000, // 1 minute test
  startTime: Date.now()
};

// Start the bot process
const botProcess = spawn('npm', ['run', 'start:ws'], {
  stdio: 'pipe',
  cwd: process.cwd()
});

console.log(`⏱️  Running test for ${testResults.testDuration / 1000} seconds...`);
console.log('Monitoring for:');
console.log('  - MaxListenersExceededWarning messages');
console.log('  - Block event parsing issues'); 
console.log('  - Successful operations');
console.log('');

// Monitor stdout
botProcess.stdout.on('data', (data) => {
  const output = data.toString();
  
  // Check for memory leak warnings
  if (output.includes('MaxListenersExceededWarning')) {
    testResults.memoryLeakWarnings++;
    console.log('❌ MEMORY LEAK WARNING DETECTED');
  }
  
  // Check for block event warnings
  if (output.includes('Received block event without valid block number')) {
    testResults.blockEventWarnings++;
    console.log('⚠️  Block event parsing issue detected');
  }
  
  // Check for successful operations
  if (output.includes('Batch') && output.includes('completed')) {
    testResults.successfulOperations++;
    console.log('✅ Successful batch operation');
  }
  
  if (output.includes('Reserve update completed')) {
    console.log('✅ Reserve update completed successfully');
  }
  
  if (output.includes('WebSocket connected successfully')) {
    console.log('🔗 WebSocket connected successfully');
  }
});

// Monitor stderr
botProcess.stderr.on('data', (data) => {
  const error = data.toString();
  
  if (error.includes('MaxListenersExceededWarning')) {
    testResults.memoryLeakWarnings++;
    console.log('❌ MEMORY LEAK WARNING DETECTED (stderr)');
  }
});

// Test timeout
setTimeout(() => {
  console.log('');
  console.log('⏰ Test timeout reached, stopping bot...');
  
  // Gracefully terminate the bot
  botProcess.kill('SIGINT');
  
  setTimeout(() => {
    if (!botProcess.killed) {
      console.log('Force killing bot process...');
      botProcess.kill('SIGKILL');
    }
  }, 5000);
  
}, testResults.testDuration);

// Handle process exit
botProcess.on('exit', (code, signal) => {
  const endTime = Date.now();
  const actualDuration = endTime - testResults.startTime;
  
  console.log('');
  console.log('📊 TEST RESULTS');
  console.log('═══════════════');
  console.log(`🕐 Test Duration: ${(actualDuration / 1000).toFixed(1)}s`);
  console.log(`❌ Memory Leak Warnings: ${testResults.memoryLeakWarnings}`);
  console.log(`⚠️  Block Event Warnings: ${testResults.blockEventWarnings}`);
  console.log(`✅ Successful Operations: ${testResults.successfulOperations}`);
  console.log(`🔄 Exit Code: ${code} (Signal: ${signal})`);
  console.log('');
  
  // Determine test result
  const success = testResults.memoryLeakWarnings === 0;
  
  if (success) {
    console.log('🎉 SUCCESS: No memory leak warnings detected!');
    console.log('✅ Memory leak fixes appear to be working correctly.');
  } else {
    console.log('💥 FAILURE: Memory leak warnings still present.');
    console.log(`❌ Found ${testResults.memoryLeakWarnings} memory leak warning(s).`);
  }
  
  if (testResults.blockEventWarnings > 0) {
    console.log(`⚠️  Note: ${testResults.blockEventWarnings} block event parsing issues detected.`);
  }
  
  // Write results to file
  const report = {
    timestamp: new Date().toISOString(),
    duration: actualDuration,
    ...testResults,
    success,
    recommendations: success 
      ? ['Memory leak fixes are working correctly']
      : ['Memory leaks still present - review AbortController cleanup']
  };
  
  fs.writeFileSync('memory-test-results.json', JSON.stringify(report, null, 2));
  console.log('📝 Test results saved to memory-test-results.json');
  
  process.exit(success ? 0 : 1);
});

// Handle script interruption
process.on('SIGINT', () => {
  console.log('');
  console.log('⏹️  Test interrupted by user');
  if (botProcess && !botProcess.killed) {
    botProcess.kill('SIGINT');
  }
  setTimeout(() => process.exit(1), 2000);
});

console.log('🚀 Bot started, monitoring output...');