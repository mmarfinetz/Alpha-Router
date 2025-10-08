#!/usr/bin/env ts-node
/**
 * Test CoW Solver against real auction data
 *
 * This script:
 * 1. Tests with local test-auction.json
 * 2. Optionally fetches real auction from CoW API
 * 3. Validates solution format
 * 4. Checks solver performance
 */

import { ethers } from 'ethers';
import { CoWAdapter } from './src/cow/CoWAdapter';
import { CoWAuction, CoWSolution } from './src/cow/types';
import logger from './src/utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.competition' });

// CoW Protocol API endpoints
const COW_API_BASE = 'https://api.cow.fi/mainnet/api/v1';
const ORDERBOOK_API = 'https://api.cow.fi/mainnet/api/v1/solver_competition';

interface TestResult {
  auctionId: string;
  success: boolean;
  solutionCount: number;
  executionTimeMs: number;
  error?: string;
  solutions?: CoWSolution[];
  validationErrors?: string[];
}

class CoWSolverTester {
  private adapter: CoWAdapter;
  private provider: ethers.providers.Provider;

  constructor() {
    const rpcUrl = process.env.ETHEREUM_RPC_URL || 'http://localhost:8545';
    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    this.adapter = new CoWAdapter(this.provider);
  }

  /**
   * Validate solution format according to CoW Protocol spec
   */
  private validateSolution(solution: CoWSolution, auction: CoWAuction): string[] {
    const errors: string[] = [];

    // Check required fields
    if (solution.id === undefined) {
      errors.push('Solution missing id');
    }
    if (!solution.prices || typeof solution.prices !== 'object') {
      errors.push('Solution missing or invalid prices object');
    }
    if (!Array.isArray(solution.trades)) {
      errors.push('Solution missing or invalid trades array');
    }
    if (!Array.isArray(solution.interactions)) {
      errors.push('Solution missing or invalid interactions array');
    }

    // Validate prices for all tokens in orders
    const allTokens = new Set<string>();
    auction.orders.forEach(order => {
      allTokens.add(order.sellToken.toLowerCase());
      allTokens.add(order.buyToken.toLowerCase());
    });

    for (const token of allTokens) {
      if (!solution.prices[token] && !solution.prices[token.toLowerCase()]) {
        errors.push(`Missing price for token ${token}`);
      }
    }

    // Validate trades reference valid orders
    const validOrderUids = new Set(auction.orders.map(o => o.uid));
    solution.trades.forEach((trade, idx) => {
      if (!validOrderUids.has(trade.order)) {
        errors.push(`Trade ${idx} references invalid order ${trade.order}`);
      }
      if (!trade.executedAmount) {
        errors.push(`Trade ${idx} missing executedAmount`);
      }
    });

    // Check gas estimate is reasonable
    if (solution.gas && solution.gas > 10000000) {
      errors.push(`Unreasonable gas estimate: ${solution.gas}`);
    }

    // Check score exists and is a valid number string
    if (solution.score) {
      try {
        const score = ethers.BigNumber.from(solution.score);
        if (score.lt(0)) {
          errors.push('Solution score is negative');
        }
      } catch (e) {
        errors.push(`Invalid score format: ${solution.score}`);
      }
    }

    return errors;
  }

  /**
   * Test solver with a given auction
   */
  async testAuction(auction: CoWAuction, source: string): Promise<TestResult> {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🎯 Testing Auction: ${auction.id} (${source})`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Orders: ${auction.orders.length}`);
    console.log(`Liquidity sources: ${auction.liquidity.length}`);

    const startTime = Date.now();
    let result: TestResult;

    try {
      // Run solver
      const solverResponse = await this.adapter.solve(auction);
      const executionTimeMs = Date.now() - startTime;

      console.log(`\n⏱️  Execution time: ${executionTimeMs}ms`);
      console.log(`📊 Solutions found: ${solverResponse.solutions.length}`);

      // Validate each solution
      const allValidationErrors: string[] = [];
      solverResponse.solutions.forEach((solution, idx) => {
        const errors = this.validateSolution(solution, auction);
        if (errors.length > 0) {
          console.log(`\n❌ Solution ${idx} validation errors:`);
          errors.forEach(err => console.log(`   - ${err}`));
          allValidationErrors.push(...errors);
        } else {
          console.log(`\n✅ Solution ${idx} valid`);
          console.log(`   Score: ${solution.score || 'N/A'}`);
          console.log(`   Gas: ${solution.gas || 'N/A'}`);
          console.log(`   Trades: ${solution.trades.length}`);
          console.log(`   Interactions: ${solution.interactions.length}`);
        }
      });

      result = {
        auctionId: auction.id,
        success: allValidationErrors.length === 0,
        solutionCount: solverResponse.solutions.length,
        executionTimeMs,
        solutions: solverResponse.solutions,
        validationErrors: allValidationErrors.length > 0 ? allValidationErrors : undefined
      };

    } catch (error: any) {
      const executionTimeMs = Date.now() - startTime;
      console.error(`\n❌ Solver error: ${error.message}`);
      console.error(error.stack);

      result = {
        auctionId: auction.id,
        success: false,
        solutionCount: 0,
        executionTimeMs,
        error: error.message
      };
    }

    return result;
  }

  /**
   * Fetch latest auction from CoW API (Arbitrum One)
   */
  async fetchLatestAuction(): Promise<CoWAuction | null> {
    try {
      console.log('\n🌐 Fetching latest auction from CoW API (Arbitrum One)...');

      // Use the solver competition endpoint which has full auction data
      const COMPETITION_ENDPOINT = 'https://api.cow.fi/arbitrum_one/api/v1/solver_competition/auctions';

      const response = await fetch(COMPETITION_ENDPOINT, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'CoW-Solver-Test/1.0'
        }
      });

      if (!response.ok) {
        console.warn(`CoW API returned ${response.status}, using local auction`);
        return null;
      }

      const auctions = await response.json() as CoWAuction[];

      if (!Array.isArray(auctions) || auctions.length === 0) {
        console.warn('⚠️  No active auctions available');
        return null;
      }

      const auction = auctions[0];

      // CRITICAL: Validate this is real data (from CLAUDE.md)
      if (!auction.id || auction.id.startsWith('test-')) {
        console.error('❌ DETECTED FAKE DATA - refusing to use synthetic auction');
        throw new Error('Synthetic auction data detected');
      }

      if (!auction.orders || auction.orders.length === 0) {
        console.warn('⚠️  Auction has no orders');
        return null;
      }

      if (!auction.liquidity || auction.liquidity.length === 0) {
        console.warn('⚠️  Auction has no liquidity');
        return null;
      }

      console.log(`✅ Fetched real auction: ${auction.id}`);
      console.log(`   Orders: ${auction.orders.length}`);
      console.log(`   Liquidity sources: ${auction.liquidity.length}`);

      // Save for later analysis
      fs.writeFileSync(
        path.join(__dirname, 'real-auction-latest.json'),
        JSON.stringify(auction, null, 2)
      );

      return auction;

    } catch (error: any) {
      console.error(`Failed to fetch auction from API: ${error.message}`);
      return null;
    }
  }

  /**
   * Run all tests
   */
  async runTests(): Promise<void> {
    console.log('\n🚀 CoW Protocol Solver Test Suite');
    console.log('='.repeat(80));

    const results: TestResult[] = [];

    // Test 1: Local test auction
    console.log('\n📁 Test 1: Local test auction (test-auction.json)');
    try {
      const testAuctionPath = path.join(__dirname, 'test-auction.json');
      const testAuction: CoWAuction = JSON.parse(fs.readFileSync(testAuctionPath, 'utf-8'));
      const result = await this.testAuction(testAuction, 'local file');
      results.push(result);
    } catch (error: any) {
      console.error(`❌ Failed to load test auction: ${error.message}`);
    }

    // Test 2: Try to fetch real auction
    console.log('\n📁 Test 2: Real auction from CoW API');
    const realAuction = await this.fetchLatestAuction();
    if (realAuction) {
      const result = await this.testAuction(realAuction, 'CoW API');
      results.push(result);
    } else {
      console.log('⚠️  Skipping real auction test (API unavailable or no active auctions)');
    }

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(80));

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalSolutions = results.reduce((sum, r) => sum + r.solutionCount, 0);
    const avgExecutionTime = results.length > 0
      ? results.reduce((sum, r) => sum + r.executionTimeMs, 0) / results.length
      : 0;

    console.log(`\nTests run: ${results.length}`);
    console.log(`✅ Passed: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📊 Total solutions: ${totalSolutions}`);
    console.log(`⏱️  Avg execution time: ${avgExecutionTime.toFixed(0)}ms`);

    results.forEach((result, idx) => {
      console.log(`\nTest ${idx + 1}: ${result.auctionId}`);
      console.log(`  Status: ${result.success ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`  Solutions: ${result.solutionCount}`);
      console.log(`  Time: ${result.executionTimeMs}ms`);
      if (result.error) {
        console.log(`  Error: ${result.error}`);
      }
      if (result.validationErrors && result.validationErrors.length > 0) {
        console.log(`  Validation errors: ${result.validationErrors.length}`);
      }
    });

    // Exit with appropriate code
    if (failed > 0) {
      console.log('\n❌ Some tests failed');
      process.exit(1);
    } else {
      console.log('\n✅ All tests passed!');
      process.exit(0);
    }
  }
}

// Run tests
const tester = new CoWSolverTester();
tester.runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
