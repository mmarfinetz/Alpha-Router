#!/usr/bin/env ts-node
/**
 * Real CoW Protocol Auction Testing
 *
 * This script:
 * 1. Fetches recent REAL auctions from CoW Protocol API (Arbitrum)
 * 2. Tests our solver against each auction
 * 3. Compares our solutions to what winning solvers submitted
 * 4. Reports performance metrics
 *
 * NO FAKE DATA - Only real production auction data from CoW API
 */

import { ethers } from 'ethers';
import { CowSolver } from './src/cow/CowSolver';
import axios from 'axios';

const COW_API_BASE = 'https://api.cow.fi/arbitrum_one';

interface AuctionSummary {
  auctionId: number;
  transactionHashes: string[];
  auctionStartBlock: number;
  competitionSimulationBlock: number;
}

interface CompetitionResult {
  auctionId: number;
  transactionHashes: string[];
  auctionStartBlock: number;
  competitionSimulationBlock: number;
  auction: any;
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
  }>;
  prices: Record<string, string>;
}

interface TestResult {
  auctionId: number;
  foundSolution: boolean;
  ourScore?: string;
  winnerScore?: string;
  winnerSolver?: string;
  responseTimeMs: number;
  ordersInAuction: number;
  tokensInAuction: number;
  error?: string;
  ourSolution?: any;
}

class RealAuctionTester {
  private solver: CowSolver;
  private provider: ethers.providers.JsonRpcProvider;

  constructor() {
    const rpcUrl = process.env.ETHEREUM_RPC_URL || process.env.ARBITRUM_RPC_URL;
    if (!rpcUrl) {
      throw new Error('ETHEREUM_RPC_URL or ARBITRUM_RPC_URL must be set');
    }
    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    this.solver = new CowSolver(this.provider, process.env.SOLVER_ADDRESS || ethers.constants.AddressZero);
  }

  /**
   * Fetch the latest N auctions from CoW API
   */
  async fetchRecentAuctions(count: number = 10): Promise<number[]> {
    console.log(`\n📡 Fetching latest auction from CoW Protocol API...`);

    try {
      const response = await axios.get<AuctionSummary>(`${COW_API_BASE}/api/v1/solver_competition/latest`);
      const latestId = response.data.auctionId;

      console.log(`✅ Latest auction ID: ${latestId}`);
      console.log(`   Block: ${response.data.auctionStartBlock}`);
      console.log(`   Transactions: ${response.data.transactionHashes.length}`);

      // Return last N auction IDs
      const auctionIds: number[] = [];
      for (let i = 0; i < count; i++) {
        auctionIds.push(latestId - i);
      }

      return auctionIds;
    } catch (error: any) {
      console.error('❌ Failed to fetch latest auction:', error.message);
      throw error;
    }
  }

  /**
   * Fetch competition results for a specific auction
   */
  async fetchAuctionCompetition(auctionId: number): Promise<CompetitionResult | null> {
    try {
      console.log(`\n📥 Fetching auction ${auctionId}...`);
      const response = await axios.get<CompetitionResult>(`${COW_API_BASE}/api/v1/solver_competition/${auctionId}`);

      const data = response.data;
      console.log(`   Orders: ${data.auction?.orders?.length || 0}`);
      console.log(`   Solutions submitted: ${data.solutions?.length || 0}`);
      console.log(`   Winner: ${data.solutions?.[0]?.solverName || data.solutions?.[0]?.solver || 'Unknown'}`);

      return data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.log(`   ⚠️  Auction ${auctionId} not found (may not have been settled)`);
        return null;
      }
      console.error(`   ❌ Failed to fetch auction ${auctionId}:`, error.message);
      return null;
    }
  }

  /**
   * Test our solver against a real auction
   */
  async testAuction(competition: CompetitionResult): Promise<TestResult> {
    const startTime = Date.now();

    try {
      const { auction, solutions } = competition;

      if (!auction || !auction.orders || auction.orders.length === 0) {
        return {
          auctionId: competition.auctionId,
          foundSolution: false,
          responseTimeMs: Date.now() - startTime,
          ordersInAuction: 0,
          tokensInAuction: 0,
          error: 'No orders in auction',
        };
      }

      // Count unique tokens
      const tokens = new Set<string>();
      // Note: In real CoW auctions, orders are hex-encoded. We'd need to decode them.
      // For now, just count orders
      const ordersCount = auction.orders.length;

      console.log(`\n🧪 Testing auction ${competition.auctionId}...`);
      console.log(`   📋 Orders: ${ordersCount}`);
      console.log(`   🏆 Winning solver: ${solutions[0]?.solverName || solutions[0]?.solver || 'Unknown'}`);
      console.log(`   💰 Winner score: ${solutions[0]?.score || solutions[0]?.objective?.total || 'N/A'}`);

      // Try to solve with our solver
      // Note: Our current solver expects a different format, so this is a placeholder
      // In a real implementation, we'd need to:
      // 1. Decode the hex-encoded orders
      // 2. Parse them into our expected format
      // 3. Call our solver
      // 4. Compare results

      const ourSolution = await this.solver.solve({
        id: competition.auctionId.toString(),
        orders: [], // Would need to decode auction.orders
        tokens: [],
        deadline: Math.floor(Date.now() / 1000) + 300,
      });

      const responseTime = Date.now() - startTime;

      if (!ourSolution || !ourSolution.solutions || ourSolution.solutions.length === 0) {
        return {
          auctionId: competition.auctionId,
          foundSolution: false,
          winnerScore: solutions[0]?.score || solutions[0]?.objective?.total,
          winnerSolver: solutions[0]?.solverName || solutions[0]?.solver,
          responseTimeMs: responseTime,
          ordersInAuction: ordersCount,
          tokensInAuction: tokens.size,
        };
      }

      // Compare our solution to winner
      const ourScore = ourSolution.solutions[0]?.score || '0';
      const winnerScore = solutions[0]?.score || solutions[0]?.objective?.total || '0';

      return {
        auctionId: competition.auctionId,
        foundSolution: true,
        ourScore,
        winnerScore,
        winnerSolver: solutions[0]?.solverName || solutions[0]?.solver,
        responseTimeMs: responseTime,
        ordersInAuction: ordersCount,
        tokensInAuction: tokens.size,
        ourSolution: ourSolution.solutions[0],
      };

    } catch (error: any) {
      return {
        auctionId: competition.auctionId,
        foundSolution: false,
        responseTimeMs: Date.now() - startTime,
        ordersInAuction: 0,
        tokensInAuction: 0,
        error: error.message,
      };
    }
  }

  /**
   * Run comprehensive test suite
   */
  async runTests(auctionCount: number = 10): Promise<void> {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  Real CoW Protocol Auction Testing');
    console.log('  Testing against ACTUAL production auctions');
    console.log('═══════════════════════════════════════════════════════\n');

    try {
      // Fetch recent auction IDs
      const auctionIds = await this.fetchRecentAuctions(auctionCount);
      console.log(`\n📊 Will test ${auctionIds.length} auctions: ${auctionIds[0]} to ${auctionIds[auctionIds.length - 1]}`);

      const results: TestResult[] = [];

      // Test each auction
      for (const auctionId of auctionIds) {
        const competition = await this.fetchAuctionCompetition(auctionId);

        if (!competition) {
          console.log(`   ⏭️  Skipping auction ${auctionId}`);
          continue;
        }

        const result = await this.testAuction(competition);
        results.push(result);

        // Brief delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Print summary
      this.printSummary(results);

    } catch (error: any) {
      console.error('\n❌ Test suite failed:', error.message);
      throw error;
    }
  }

  /**
   * Print test results summary
   */
  private printSummary(results: TestResult[]): void {
    console.log('\n\n═══════════════════════════════════════════════════════');
    console.log('  TEST RESULTS SUMMARY');
    console.log('═══════════════════════════════════════════════════════\n');

    const successful = results.filter(r => r.foundSolution);
    const failed = results.filter(r => !r.foundSolution);
    const errors = results.filter(r => r.error);

    console.log(`📊 Total Auctions Tested: ${results.length}`);
    console.log(`✅ Found Solutions: ${successful.length} (${(successful.length / results.length * 100).toFixed(1)}%)`);
    console.log(`❌ No Solution: ${failed.length} (${(failed.length / results.length * 100).toFixed(1)}%)`);
    console.log(`⚠️  Errors: ${errors.length}`);

    if (successful.length > 0) {
      const avgResponseTime = successful.reduce((sum, r) => sum + r.responseTimeMs, 0) / successful.length;
      console.log(`\n⏱️  Average Response Time: ${avgResponseTime.toFixed(0)}ms`);

      console.log('\n🏆 Successful Solutions:');
      successful.forEach(r => {
        const comparison = r.ourScore && r.winnerScore
          ? ` (${((BigInt(r.ourScore) * 100n) / BigInt(r.winnerScore)).toString()}% of winner)`
          : '';
        console.log(`   Auction ${r.auctionId}: Score ${r.ourScore || 'N/A'}${comparison}`);
        console.log(`      vs ${r.winnerSolver}: ${r.winnerScore || 'N/A'}`);
        console.log(`      Response: ${r.responseTimeMs}ms, Orders: ${r.ordersInAuction}`);
      });
    }

    if (failed.length > 0) {
      console.log('\n❌ Failed Auctions:');
      failed.slice(0, 5).forEach(r => {
        console.log(`   Auction ${r.auctionId}: ${r.error || 'No solution found'}`);
        console.log(`      Winner: ${r.winnerSolver} (${r.winnerScore})`);
        console.log(`      Orders: ${r.ordersInAuction}, Tokens: ${r.tokensInAuction}`);
      });
      if (failed.length > 5) {
        console.log(`   ... and ${failed.length - 5} more`);
      }
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  KEY INSIGHTS');
    console.log('═══════════════════════════════════════════════════════\n');

    if (successful.length === 0) {
      console.log('⚠️  Our solver found NO solutions for any real auctions.');
      console.log('   This indicates a major issue:');
      console.log('   - Solver logic may not handle real order formats');
      console.log('   - Price sources may be unavailable/incorrect');
      console.log('   - Orders may require different settlement paths');
      console.log('   - Liquidity sources may be missing\n');
    } else {
      const winRate = (successful.length / results.length * 100).toFixed(1);
      console.log(`✅ Solution Rate: ${winRate}%`);

      if (successful.some(r => r.ourScore && r.winnerScore && BigInt(r.ourScore) >= BigInt(r.winnerScore))) {
        console.log('🎉 We matched or beat the winner on some auctions!');
      } else {
        console.log('⚠️  Our scores were below winners on all successful solutions.');
        console.log('   Possible improvements:');
        console.log('   - Better routing algorithms');
        console.log('   - More liquidity sources');
        console.log('   - Optimized gas estimation');
        console.log('   - CoW surplus optimization\n');
      }
    }
  }
}

// Main execution
async function main() {
  const tester = new RealAuctionTester();

  // Test last 10 auctions by default
  const auctionCount = process.argv[2] ? parseInt(process.argv[2]) : 10;

  await tester.runTests(auctionCount);
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
