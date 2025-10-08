#!/usr/bin/env node

import dotenv from 'dotenv';
import { ethers } from 'ethers';

dotenv.config();

const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

// Uniswap V2 Factory and Router
const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';

// SushiSwap Factory and Router  
const SUSHISWAP_FACTORY = '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac';
const SUSHISWAP_ROUTER = '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F';

// Minimal ABI for what we need
const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)'
];

const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)'
];

class SimpleArbitrageScanner {
  constructor(provider) {
    this.provider = provider;
    this.uniswapFactory = new ethers.Contract(UNISWAP_V2_FACTORY, FACTORY_ABI, provider);
    this.sushiFactory = new ethers.Contract(SUSHISWAP_FACTORY, FACTORY_ABI, provider);
  }

  async getPairAddress(factory, tokenA, tokenB) {
    try {
      return await factory.getPair(tokenA, tokenB);
    } catch (error) {
      return ethers.constants.AddressZero;
    }
  }

  async getPairReserves(pairAddress) {
    if (pairAddress === ethers.constants.AddressZero) return null;
    
    try {
      const pair = new ethers.Contract(pairAddress, PAIR_ABI, this.provider);
      const [reserve0, reserve1] = await pair.getReserves();
      const token0 = await pair.token0();
      
      return {
        reserve0: reserve0.toString(),
        reserve1: reserve1.toString(),
        token0: token0.toLowerCase()
      };
    } catch (error) {
      return null;
    }
  }

  calculatePrice(reserves, tokenAddress, isToken0) {
    if (!reserves) return 0;
    
    const reserve0 = ethers.BigNumber.from(reserves.reserve0);
    const reserve1 = ethers.BigNumber.from(reserves.reserve1);
    
    // Price = reserve1 / reserve0 if token is token0, else reserve0 / reserve1
    if (isToken0) {
      return reserve1.mul(ethers.utils.parseEther('1')).div(reserve0);
    } else {
      return reserve0.mul(ethers.utils.parseEther('1')).div(reserve1);
    }
  }

  async scanPair(tokenA, tokenB, tokenASymbol, tokenBSymbol) {
    console.log(`\n🔍 Scanning ${tokenASymbol}/${tokenBSymbol} pair...`);
    
    // Get pair addresses
    const uniPairAddr = await this.getPairAddress(this.uniswapFactory, tokenA, tokenB);
    const sushiPairAddr = await this.getPairAddress(this.sushiFactory, tokenA, tokenB);
    
    if (uniPairAddr === ethers.constants.AddressZero && sushiPairAddr === ethers.constants.AddressZero) {
      console.log(`  ❌ No pairs found on either DEX`);
      return;
    }
    
    // Get reserves
    const [uniReserves, sushiReserves] = await Promise.all([
      this.getPairReserves(uniPairAddr),
      this.getPairReserves(sushiPairAddr)
    ]);
    
    if (!uniReserves || !sushiReserves) {
      console.log(`  ⚠️  Missing reserves - Uni: ${!!uniReserves}, Sushi: ${!!sushiReserves}`);
      return;
    }
    
    // Calculate prices (tokenA in terms of tokenB)
    const tokenAIsToken0Uni = uniReserves.token0 === tokenA.toLowerCase();
    const tokenAIsToken0Sushi = sushiReserves.token0 === tokenA.toLowerCase();
    
    const uniPrice = this.calculatePrice(uniReserves, tokenA, tokenAIsToken0Uni);
    const sushiPrice = this.calculatePrice(sushiReserves, tokenA, tokenAIsToken0Sushi);
    
    // Calculate price difference
    const priceDiff = uniPrice.gt(sushiPrice) 
      ? uniPrice.sub(sushiPrice).mul(10000).div(sushiPrice) // (uni - sushi) / sushi * 100%
      : sushiPrice.sub(uniPrice).mul(10000).div(uniPrice); // (sushi - uni) / uni * 100%
    
    const priceDiffPercent = parseInt(priceDiff.toString()) / 100;
    
    console.log(`  📊 Uniswap V2: ${ethers.utils.formatEther(uniPrice)} ${tokenBSymbol}/${tokenASymbol}`);
    console.log(`  📊 SushiSwap:  ${ethers.utils.formatEther(sushiPrice)} ${tokenBSymbol}/${tokenASymbol}`);
    console.log(`  📈 Price diff: ${priceDiffPercent.toFixed(3)}%`);
    
    // Flag potential arbitrage opportunities
    if (priceDiffPercent > 0.1) { // More than 0.1% difference
      const buyFrom = uniPrice.gt(sushiPrice) ? 'SushiSwap' : 'Uniswap V2';
      const sellTo = uniPrice.gt(sushiPrice) ? 'Uniswap V2' : 'SushiSwap';
      
      console.log(`  🚨 ARBITRAGE OPPORTUNITY: Buy on ${buyFrom}, sell on ${sellTo}`);
      console.log(`  💰 Potential profit: ${priceDiffPercent.toFixed(3)}% (before gas)`);
      
      return {
        tokenA: tokenASymbol,
        tokenB: tokenBSymbol,
        priceDiff: priceDiffPercent,
        buyFrom,
        sellTo,
        uniPrice: ethers.utils.formatEther(uniPrice),
        sushiPrice: ethers.utils.formatEther(sushiPrice)
      };
    }
    
    return null;
  }

  async scan() {
    console.log('\n=== Simple MEV Arbitrage Scanner ===');
    console.log('Scanning for arbitrage opportunities between Uniswap V2 and SushiSwap...\n');
    
    const opportunities = [];
    
    // Scan major pairs
    const pairs = [
      [WETH_ADDRESS, USDC_ADDRESS, 'WETH', 'USDC']
    ];
    
    for (const [tokenA, tokenB, symbolA, symbolB] of pairs) {
      const opportunity = await this.scanPair(tokenA, tokenB, symbolA, symbolB);
      if (opportunity) {
        opportunities.push(opportunity);
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Summary
    console.log(`\n📋 Scan Summary:`);
    console.log(`   Pairs scanned: ${pairs.length}`);
    console.log(`   Opportunities found: ${opportunities.length}`);
    
    if (opportunities.length > 0) {
      console.log(`\n🎯 Best Opportunities:`);
      opportunities.sort((a, b) => b.priceDiff - a.priceDiff);
      opportunities.forEach((opp, i) => {
        console.log(`   ${i + 1}. ${opp.tokenA}/${opp.tokenB}: ${opp.priceDiff.toFixed(3)}% - Buy ${opp.buyFrom}, Sell ${opp.sellTo}`);
      });
    }
    
    return opportunities;
  }
}

async function main() {
  try {
    const rpcUrl = process.env.ETHEREUM_RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/your-api-key';
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    
    // Test connection
    const network = await provider.getNetwork();
    const blockNumber = await provider.getBlockNumber();
    console.log(`Connected to ${network.name} (block ${blockNumber})`);
    
    const scanner = new SimpleArbitrageScanner(provider);
    
    // Run initial scan
    await scanner.scan();
    
    // Set up continuous scanning if requested
    const continuous = process.env.CONTINUOUS_SCAN === 'true';
    if (continuous) {
      console.log(`\n🔄 Starting continuous scanning every 30 seconds...`);
      setInterval(async () => {
        console.log(`\n⏰ ${new Date().toLocaleTimeString()} - Running scan...`);
        await scanner.scan();
      }, 30000);
    } else {
      console.log(`\n✅ Scan complete. Set CONTINUOUS_SCAN=true for continuous monitoring.`);
    }
    
  } catch (error) {
    console.error('❌ Scanner error:', error.message);
    
    if (error.message.includes('invalid project id') || error.message.includes('unauthorized')) {
      console.log('\n💡 Please set ETHEREUM_RPC_URL in your .env file with a valid RPC endpoint.');
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down scanner...');
  process.exit(0);
});

main().catch(console.error);