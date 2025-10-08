#!/usr/bin/env ts-node
/**
 * Fetch and summarize recent CoW Protocol auctions
 * Shows real competition data without trying to solve (yet)
 */

import axios from 'axios';

const COW_API_BASE = 'https://api.cow.fi/arbitrum_one';

interface AuctionSummary {
  auctionId: number;
  numOrders: number;
  numSolutions: number;
  winner: {
    solver: string;
    score: string;
  };
  runner_up?: {
    solver: string;
    score: string;
  };
  margin?: string;
  marginPercent?: string;
}

async function fetchAuctionSummary(auctionId: number): Promise<AuctionSummary | null> {
  try {
    const response = await axios.get(`${COW_API_BASE}/api/v1/solver_competition/${auctionId}`, {
      timeout: 5000,
    });

    const data = response.data;
    const numOrders = data.auction?.orders?.length || 0;
    const solutions = data.solutions || [];

    if (solutions.length === 0) {
      return null;
    }

    const winner = solutions[0];
    const runnerUp = solutions[1];

    const summary: AuctionSummary = {
      auctionId,
      numOrders,
      numSolutions: solutions.length,
      winner: {
        solver: winner.solver || winner.solverName || 'Unknown',
        score: winner.score || winner.objective?.total || '0',
      },
    };

    if (runnerUp) {
      summary.runner_up = {
        solver: runnerUp.solver || runnerUp.solverName || 'Unknown',
        score: runnerUp.score || runnerUp.objective?.total || '0',
      };

      try {
        const winnerScore = BigInt(summary.winner.score);
        const runnerUpScore = BigInt(summary.runner_up.score);
        const margin = winnerScore - runnerUpScore;
        summary.margin = margin.toString();
        if (winnerScore > 0n) {
          summary.marginPercent = ((Number(margin) / Number(winnerScore)) * 100).toFixed(2);
        }
      } catch (e) {
        // Ignore if scores aren't valid numbers
      }
    }

    return summary;
  } catch (error: any) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      console.error(`   ⏱️  Timeout for auction ${auctionId}`);
    } else if (error.response?.status === 404) {
      // Auction not found, skip
    } else {
      console.error(`   ❌ Error fetching auction ${auctionId}: ${error.message}`);
    }
    return null;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  CoW Protocol Arbitrum - Recent Auctions');
  console.log('═══════════════════════════════════════════════════════\n');

  try {
    // Fetch latest auction ID
    console.log('📡 Fetching latest auction...\n');
    const latestResponse = await axios.get(`${COW_API_BASE}/api/v1/solver_competition/latest`);
    const latestId = latestResponse.data.auctionId;

    console.log(`✅ Latest auction: ${latestId}\n`);
    console.log('📊 Fetching last 20 auctions...\n');

    const summaries: AuctionSummary[] = [];

    for (let i = 0; i < 20; i++) {
      const auctionId = latestId - i;
      process.stdout.write(`   Fetching auction ${auctionId}...`);

      const summary = await fetchAuctionSummary(auctionId);
      if (summary) {
        summaries.push(summary);
        console.log(` ✓`);
      } else {
        console.log(` (skipped)`);
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Display results
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  RESULTS');
    console.log('═══════════════════════════════════════════════════════\n');

    console.log(`Found ${summaries.length} auctions with settlements\n`);

    // Solver win counts
    const winCounts = new Map<string, number>();
    summaries.forEach(s => {
      const count = winCounts.get(s.winner.solver) || 0;
      winCounts.set(s.winner.solver, count + 1);
    });

    console.log('🏆 SOLVER LEADERBOARD (Last 20 auctions)');
    console.log('─────────────────────────────────────────────────────');
    const sortedSolvers = Array.from(winCounts.entries())
      .sort((a, b) => b[1] - a[1]);

    sortedSolvers.forEach(([solver, wins], index) => {
      const rank = index + 1;
      const icon = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '  ';
      const winRate = ((wins / summaries.length) * 100).toFixed(1);
      console.log(`${icon} ${solver}: ${wins} wins (${winRate}%)`);
    });

    // Average competition stats
    const avgOrders = summaries.reduce((sum, s) => sum + s.numOrders, 0) / summaries.length;
    const avgSolutions = summaries.reduce((sum, s) => sum + s.numSolutions, 0) / summaries.length;

    console.log('\n📈 AVERAGE STATISTICS');
    console.log('─────────────────────────────────────────────────────');
    console.log(`Orders per auction: ${avgOrders.toFixed(0)}`);
    console.log(`Solutions per auction: ${avgSolutions.toFixed(1)}`);

    // Competition margins
    const margins = summaries
      .filter(s => s.marginPercent)
      .map(s => parseFloat(s.marginPercent!));

    let avgMargin: number | undefined;
    if (margins.length > 0) {
      avgMargin = margins.reduce((sum, m) => sum + m, 0) / margins.length;
      const maxMargin = Math.max(...margins);
      const minMargin = Math.min(...margins);

      console.log(`\n🎯 WINNING MARGINS`);
      console.log('─────────────────────────────────────────────────────');
      console.log(`Average: ${avgMargin.toFixed(2)}%`);
      console.log(`Max: ${maxMargin.toFixed(2)}%`);
      console.log(`Min: ${minMargin.toFixed(2)}%`);
    }

    // Detailed auction list
    console.log('\n\n📋 DETAILED AUCTION LIST');
    console.log('─────────────────────────────────────────────────────');

    summaries.slice(0, 10).forEach(s => {
      console.log(`\nAuction ${s.auctionId}:`);
      console.log(`  Orders: ${s.numOrders}, Solutions: ${s.numSolutions}`);
      console.log(`  🥇 Winner: ${s.winner.solver}`);
      console.log(`     Score: ${s.winner.score}`);
      if (s.runner_up) {
        console.log(`  🥈 Runner-up: ${s.runner_up.solver}`);
        console.log(`     Score: ${s.runner_up.score}`);
        if (s.marginPercent) {
          console.log(`     Margin: ${s.marginPercent}%`);
        }
      }
    });

    if (summaries.length > 10) {
      console.log(`\n... and ${summaries.length - 10} more auctions`);
    }

    console.log('\n\n═══════════════════════════════════════════════════════');
    console.log('  KEY INSIGHTS FOR OUR SOLVER');
    console.log('═══════════════════════════════════════════════════════\n');
    console.log('To compete in CoW Protocol auctions, we need to:');
    console.log(`  1. Handle ~${avgOrders.toFixed(0)} orders per auction`);
    console.log(`  2. Compete against ${sortedSolvers.length} other solvers`);
    console.log(`  3. Beat scores in the range of 10^10 to 10^14`);
    if (avgMargin) {
      console.log(`  4. Match within ${avgMargin.toFixed(1)}% of winner to be competitive`);
    }
    console.log('\nNext steps:');
    console.log('  • Implement order decoding from hex format');
    console.log('  • Build routing engine for multi-hop trades');
    console.log('  • Integrate with DEX liquidity sources');
    console.log('  • Calculate CoW Protocol scoring metric correctly');
    console.log('  • Test against real auction data (not fake data!)');
    console.log('');

  } catch (error: any) {
    console.error('❌ Fatal error:', error.message);
    throw error;
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
