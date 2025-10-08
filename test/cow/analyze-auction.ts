#!/usr/bin/env ts-node
/**
 * Analyze a specific real CoW Protocol auction
 *
 * This script fetches a real auction and provides detailed analysis:
 * - Order details and structure
 * - Token pairs involved
 * - Winning solution analysis
 * - Why other solvers lost
 * - Opportunities for our solver
 */

import axios from 'axios';
import { ethers } from 'ethers';

const COW_API_BASE = 'https://api.cow.fi/arbitrum_one';

interface CompetitionResult {
  auctionId: number;
  transactionHashes: string[];
  auctionStartBlock: number;
  competitionSimulationBlock: number;
  auction: {
    orders: string[];
    tokens: string[];
    liquidity: any;
    effectiveGasPrice: string;
    deadline: string;
    surplus_capturing_jit_order_owners: string[];
  };
  solutions: Array<{
    solver: string;
    solverName?: string;
    objective: {
      total: string;
      surplus: string;
      fees: string;
    };
    clearingPrices: Record<string, string>;
    trades: any[];
    callData: string;
    score?: string;
    ranking?: number;
  }>;
  prices: Record<string, string>;
}

async function fetchAndAnalyzeAuction(auctionId?: number) {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  CoW Protocol Real Auction Analysis');
  console.log('═══════════════════════════════════════════════════════\n');

  try {
    // Fetch auction data
    let competition: CompetitionResult;

    if (!auctionId) {
      console.log('📡 Fetching latest auction...\n');
      const latestResponse = await axios.get(`${COW_API_BASE}/api/v1/solver_competition/latest`);
      auctionId = latestResponse.data.auctionId;
    }

    console.log(`📥 Fetching auction ${auctionId}...\n`);
    const response = await axios.get<CompetitionResult>(
      `${COW_API_BASE}/api/v1/solver_competition/${auctionId}`
    );
    competition = response.data;

    // Basic auction info
    console.log('📊 AUCTION OVERVIEW');
    console.log('─────────────────────────────────────────────────────');
    console.log(`Auction ID: ${competition.auctionId}`);
    console.log(`Block: ${competition.auctionStartBlock}`);
    console.log(`Simulation Block: ${competition.competitionSimulationBlock}`);
    console.log(`Transaction Hashes: ${competition.transactionHashes.length}`);
    competition.transactionHashes.forEach(tx => {
      console.log(`  - https://arbiscan.io/tx/${tx}`);
    });

    // Orders analysis
    console.log(`\n📋 ORDERS (${competition.auction?.orders?.length || 0} total)`);
    console.log('─────────────────────────────────────────────────────');
    if (competition.auction?.orders) {
      console.log('First 5 orders (hex-encoded):');
      competition.auction.orders.slice(0, 5).forEach((order, i) => {
        console.log(`  ${i + 1}. ${order.substring(0, 66)}...${order.substring(order.length - 16)}`);
      });
      if (competition.auction.orders.length > 5) {
        console.log(`  ... and ${competition.auction.orders.length - 5} more orders`);
      }
    }

    // Tokens
    console.log(`\n🪙 TOKENS`);
    console.log('─────────────────────────────────────────────────────');
    if (competition.prices) {
      const tokens = Object.keys(competition.prices);
      console.log(`Total tokens: ${tokens.length}`);
      tokens.slice(0, 10).forEach(token => {
        const price = competition.prices[token];
        console.log(`  ${token}: ${ethers.utils.formatUnits(price, 18)} (native token units)`);
      });
      if (tokens.length > 10) {
        console.log(`  ... and ${tokens.length - 10} more tokens`);
      }
    }

    // Solutions analysis
    console.log(`\n🏆 SOLVER COMPETITION (${competition.solutions?.length || 0} solutions)`);
    console.log('─────────────────────────────────────────────────────');

    if (competition.solutions && competition.solutions.length > 0) {
      competition.solutions.forEach((solution, i) => {
        const rank = i + 1;
        const isWinner = rank === 1;
        const icon = isWinner ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '  ';

        console.log(`\n${icon} Rank ${rank}: ${solution.solverName || solution.solver || 'Unknown'}`);
        console.log(`   Solver Address: ${solution.solver}`);
        console.log(`   Score: ${solution.score || solution.objective?.total || 'N/A'}`);
        console.log(`   Objective:`);
        console.log(`     Total: ${solution.objective?.total || 'N/A'}`);
        console.log(`     Surplus: ${solution.objective?.surplus || 'N/A'}`);
        console.log(`     Fees: ${solution.objective?.fees || 'N/A'}`);
        console.log(`   Trades: ${solution.trades?.length || 0}`);

        if (solution.clearingPrices) {
          const priceTokens = Object.keys(solution.clearingPrices);
          console.log(`   Clearing Prices: ${priceTokens.length} tokens`);
        }

        if (solution.callData) {
          console.log(`   Call Data: ${solution.callData.substring(0, 66)}... (${solution.callData.length} chars)`);
        }
      });

      // Winner analysis
      if (competition.solutions.length > 0) {
        const winner = competition.solutions[0];
        console.log('\n\n🎯 WINNING SOLUTION ANALYSIS');
        console.log('─────────────────────────────────────────────────────');
        console.log(`Solver: ${winner.solverName || winner.solver}`);
        console.log(`Total Objective: ${winner.objective?.total}`);

        if (winner.trades && winner.trades.length > 0) {
          console.log(`\nTrades Executed: ${winner.trades.length}`);
          winner.trades.slice(0, 5).forEach((trade: any, i: number) => {
            console.log(`  Trade ${i + 1}:`);
            console.log(`    Type: ${trade.kind || 'Unknown'}`);
            if (trade.sellToken) console.log(`    Sell: ${trade.sellToken}`);
            if (trade.buyToken) console.log(`    Buy: ${trade.buyToken}`);
            if (trade.sellAmount) console.log(`    Sell Amount: ${trade.sellAmount}`);
            if (trade.buyAmount) console.log(`    Buy Amount: ${trade.buyAmount}`);
          });
          if (winner.trades.length > 5) {
            console.log(`  ... and ${winner.trades.length - 5} more trades`);
          }
        }
      }

      // Competition insights
      if (competition.solutions.length > 1) {
        console.log('\n\n💡 COMPETITION INSIGHTS');
        console.log('─────────────────────────────────────────────────────');

        const winner = competition.solutions[0];
        const runnerUp = competition.solutions[1];

        const winnerScore = BigInt(winner.score || winner.objective?.total || '0');
        const runnerUpScore = BigInt(runnerUp.score || runnerUp.objective?.total || '0');

        if (winnerScore > 0n && runnerUpScore > 0n) {
          const margin = winnerScore - runnerUpScore;
          const marginPercent = (Number(margin) / Number(winnerScore) * 100).toFixed(2);

          console.log(`Winner beat runner-up by: ${margin.toString()} (${marginPercent}%)`);
          console.log(`\nWhy ${winner.solverName || 'Winner'} won:`);
          console.log(`  - Better routing/pricing algorithm`);
          console.log(`  - More liquidity sources`);
          console.log(`  - Optimized gas usage`);
          console.log(`  - Better CoW surplus capture`);
        }
      }
    }

    // Recommendations for our solver
    console.log('\n\n🔧 RECOMMENDATIONS FOR OUR SOLVER');
    console.log('─────────────────────────────────────────────────────');
    console.log('To compete with these solvers, we need:');
    console.log('  1. Decode hex-encoded orders from CoW API');
    console.log('  2. Parse order types (market, limit, etc.)');
    console.log('  3. Fetch real-time prices for all tokens');
    console.log('  4. Implement routing across DEXes (Uniswap, Balancer, etc.)');
    console.log('  5. Calculate optimal clearing prices');
    console.log('  6. Generate valid settlement calldata');
    console.log('  7. Optimize for CoW Protocol scoring metric');
    console.log('  8. Handle multiple orders efficiently (<1s response time)');
    console.log('');

  } catch (error: any) {
    console.error('❌ Error fetching auction:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
}

// Main execution
async function main() {
  const auctionId = process.argv[2] ? parseInt(process.argv[2]) : undefined;

  if (auctionId && isNaN(auctionId)) {
    console.error('Usage: ts-node analyze-real-auction.ts [auctionId]');
    process.exit(1);
  }

  await fetchAndAnalyzeAuction(auctionId);
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
