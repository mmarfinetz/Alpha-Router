#!/usr/bin/env ts-node
/**
 * Fetch real CoW Protocol auction data from competition API
 *
 * Usage:
 *   ts-node scripts/fetch-real-auction.ts [--latest|--all]
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const COW_API_BASE = 'https://api.cow.fi/arbitrum_one/api/v1';
const AUCTIONS_ENDPOINT = `${COW_API_BASE}/solver_competition/auctions`;

interface FetchOptions {
  latest?: boolean;
  all?: boolean;
  output?: string;
}

async function fetchRealAuctions(options: FetchOptions = {}) {
  try {
    console.log('🌐 Fetching real CoW Protocol auction data...');
    console.log(`📡 Endpoint: ${AUCTIONS_ENDPOINT}`);

    const response = await axios.get(AUCTIONS_ENDPOINT, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'CoW-Solver-Bot/1.0'
      },
      timeout: 10000
    });

    if (!response.data || !Array.isArray(response.data)) {
      console.error('❌ Invalid response format');
      return null;
    }

    const auctions = response.data;
    console.log(`✅ Fetched ${auctions.length} auctions`);

    if (auctions.length === 0) {
      console.warn('⚠️  No active auctions available');
      return null;
    }

    // Validate auction data structure
    const auction = options.latest !== false ? auctions[0] : auctions;

    if (options.latest !== false) {
      validateAuction(auction);
    }

    // Save to file
    const timestamp = Date.now();
    const filename = options.output ||
      (options.latest !== false
        ? `real-auction-latest.json`
        : `real-auctions-${timestamp}.json`);

    const filepath = path.join(process.cwd(), filename);

    fs.writeFileSync(
      filepath,
      JSON.stringify(auction, null, 2),
      'utf-8'
    );

    console.log(`\n💾 Saved to: ${filepath}`);

    if (options.latest !== false) {
      printAuctionSummary(auction);
    } else {
      console.log(`\n📊 Summary: ${auctions.length} auctions saved`);
    }

    return auction;

  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ Connection refused - CoW API may be down');
    } else if (error.response) {
      console.error(`❌ API returned ${error.response.status}: ${error.response.statusText}`);
    } else {
      console.error(`❌ Error: ${error.message}`);
    }

    throw error;
  }
}

function validateAuction(auction: any) {
  const errors: string[] = [];

  // Critical validations from CLAUDE.md
  if (!auction.id) {
    errors.push('Missing auction.id');
  } else if (auction.id.startsWith('test-')) {
    errors.push('⚠️  DETECTED FAKE DATA - auction.id starts with "test-"');
  }

  if (!Array.isArray(auction.orders)) {
    errors.push('Missing or invalid auction.orders');
  }

  if (!Array.isArray(auction.liquidity)) {
    errors.push('Missing or invalid auction.liquidity');
  }

  if (!auction.effectiveGasPrice) {
    errors.push('Missing auction.effectiveGasPrice');
  }

  if (errors.length > 0) {
    console.error('\n❌ AUCTION VALIDATION FAILED:');
    errors.forEach(err => console.error(`   - ${err}`));
    throw new Error('Invalid auction data structure');
  }

  console.log('✅ Auction data validated successfully');
}

function printAuctionSummary(auction: any) {
  console.log('\n📋 Auction Summary:');
  console.log(`   ID: ${auction.id}`);
  console.log(`   Orders: ${auction.orders.length}`);
  console.log(`   Liquidity sources: ${auction.liquidity.length}`);
  console.log(`   Gas price: ${auction.effectiveGasPrice}`);

  if (auction.deadline) {
    const deadline = new Date(auction.deadline);
    console.log(`   Deadline: ${deadline.toISOString()}`);
  }

  // Token breakdown
  const tokens = new Set<string>();
  auction.orders.forEach((order: any) => {
    tokens.add(order.sellToken);
    tokens.add(order.buyToken);
  });
  console.log(`   Unique tokens: ${tokens.size}`);

  // Protocol breakdown
  const protocols: { [key: string]: number } = {};
  auction.liquidity.forEach((pool: any) => {
    protocols[pool.kind] = (protocols[pool.kind] || 0) + 1;
  });

  console.log('\n📊 Protocol Distribution:');
  Object.entries(protocols)
    .sort((a, b) => b[1] - a[1])
    .forEach(([protocol, count]) => {
      console.log(`   ${protocol}: ${count} pools`);
    });
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  const options: FetchOptions = {
    latest: !args.includes('--all'),
    all: args.includes('--all')
  };

  // Check for custom output
  const outputIndex = args.indexOf('--output');
  if (outputIndex !== -1 && args[outputIndex + 1]) {
    options.output = args[outputIndex + 1];
  }

  try {
    await fetchRealAuctions(options);
    process.exit(0);
  } catch (error) {
    console.error('\n💥 Failed to fetch auction data');
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { fetchRealAuctions };
