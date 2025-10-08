#!/usr/bin/env node

const { spawn } = require('child_process');

console.log('🤖 Starting MEV Bot with Multi-Protocol Support');
console.log('================================================\n');

console.log('📊 Supported Protocols:');
console.log('  • Uniswap V2 & Forks');
console.log('  • Curve Finance (StableSwap)');
console.log('  • Balancer V2 (Weighted/Stable)');
console.log('  • DODO V2 (PMM)');
console.log('  • Kyber DMM (Amplified)\n');

console.log('🚀 Starting bot (10 second test run)...\n');

// Run the bot for 10 seconds
const bot = spawn('node', ['build/index.js'], {
    env: { ...process.env },
    stdio: 'pipe'
});

let output = '';

bot.stdout.on('data', (data) => {
    const str = data.toString();
    output += str;
    process.stdout.write(str);
});

bot.stderr.on('data', (data) => {
    const str = data.toString();
    output += str;
    process.stderr.write(str);
});

// Kill after 10 seconds
setTimeout(() => {
    console.log('\n\n⏱️  Stopping bot after 10 second test...');
    bot.kill('SIGTERM');
    
    // Summary
    setTimeout(() => {
        console.log('\n📈 Test Summary:');
        
        // Check for key indicators
        if (output.includes('Connected to Ethereum')) {
            console.log('  ✅ Ethereum connection established');
        }
        
        if (output.includes('markets')) {
            console.log('  ✅ Market discovery active');
        }
        
        if (output.includes('Monitoring')) {
            console.log('  ✅ Bot monitoring active');
        }
        
        if (output.includes('error')) {
            console.log('  ⚠️  Some errors detected (check logs)');
        }
        
        console.log('\n✨ MEV bot test completed!');
        console.log('💡 Run "npm run start" for continuous monitoring');
        
        process.exit(0);
    }, 1000);
}, 10000);

bot.on('error', (err) => {
    console.error('❌ Failed to start bot:', err);
    process.exit(1);
});