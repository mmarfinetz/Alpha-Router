#!/usr/bin/env ts-node
/**
 * Decode a real CoW Protocol order from hex format
 *
 * CoW Protocol orders are encoded as hex strings. This script:
 * 1. Fetches a real auction
 * 2. Decodes the hex-encoded orders
 * 3. Shows the order structure
 * 4. Explains what each field means
 *
 * Order format (from CoW Protocol docs):
 * https://docs.cow.fi/cow-protocol/reference/core/signing-schemes
 */

import axios from 'axios';
import { ethers } from 'ethers';

const COW_API_BASE = 'https://api.cow.fi/arbitrum_one';

/**
 * CoW Protocol Order structure
 * See: https://github.com/cowprotocol/contracts/blob/main/src/contracts/libraries/GPv2Order.sol
 */
interface DecodedOrder {
  sellToken: string;
  buyToken: string;
  receiver: string;
  sellAmount: string;
  buyAmount: string;
  validTo: number;
  appData: string;
  feeAmount: string;
  kind: string; // 'sell' or 'buy'
  partiallyFillable: boolean;
  sellTokenBalance: string;
  buyTokenBalance: string;
}

/**
 * Decode a hex-encoded CoW Protocol order
 *
 * Order structure (from CoW Protocol contracts):
 * struct Order {
 *   address sellToken;      // 20 bytes
 *   address buyToken;       // 20 bytes
 *   address receiver;       // 20 bytes
 *   uint256 sellAmount;     // 32 bytes
 *   uint256 buyAmount;      // 32 bytes
 *   uint32 validTo;         // 4 bytes
 *   bytes32 appData;        // 32 bytes
 *   uint256 feeAmount;      // 32 bytes
 *   bytes32 kind;           // 32 bytes (encoded as bytes32)
 *   bool partiallyFillable; // 32 bytes (encoded as bytes32)
 *   bytes32 sellTokenBalance; // 32 bytes
 *   bytes32 buyTokenBalance;  // 32 bytes
 * }
 *
 * Total: 20+20+20+32+32+4+32+32+32+32+32+32 = 320 bytes
 */
function decodeOrder(hexOrder: string): DecodedOrder | null {
  try {
    // Remove 0x prefix if present
    const hex = hexOrder.startsWith('0x') ? hexOrder.slice(2) : hexOrder;

    // Each byte is 2 hex chars
    // Addresses are 20 bytes = 40 hex chars
    // uint256 are 32 bytes = 64 hex chars
    // uint32 are 4 bytes = 8 hex chars

    let offset = 0;

    // sellToken (20 bytes / 40 hex chars)
    const sellToken = '0x' + hex.slice(offset, offset + 40);
    offset += 40;

    // buyToken (20 bytes / 40 hex chars)
    const buyToken = '0x' + hex.slice(offset, offset + 40);
    offset += 40;

    // receiver (20 bytes / 40 hex chars)
    const receiver = '0x' + hex.slice(offset, offset + 40);
    offset += 40;

    // sellAmount (32 bytes / 64 hex chars)
    const sellAmount = ethers.BigNumber.from('0x' + hex.slice(offset, offset + 64)).toString();
    offset += 64;

    // buyAmount (32 bytes / 64 hex chars)
    const buyAmount = ethers.BigNumber.from('0x' + hex.slice(offset, offset + 64)).toString();
    offset += 64;

    // validTo (4 bytes / 8 hex chars)
    const validTo = parseInt(hex.slice(offset, offset + 8), 16);
    offset += 8;

    // appData (32 bytes / 64 hex chars)
    const appData = '0x' + hex.slice(offset, offset + 64);
    offset += 64;

    // feeAmount (32 bytes / 64 hex chars)
    const feeAmount = ethers.BigNumber.from('0x' + hex.slice(offset, offset + 64)).toString();
    offset += 64;

    // kind (32 bytes / 64 hex chars) - encoded as bytes32
    const kindBytes = hex.slice(offset, offset + 64);
    const kind = kindBytes.startsWith('f3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee346775')
      ? 'sell'
      : 'buy';
    offset += 64;

    // partiallyFillable (32 bytes / 64 hex chars) - encoded as bool in bytes32
    const partiallyFillableBytes = hex.slice(offset, offset + 64);
    const partiallyFillable = parseInt(partiallyFillableBytes, 16) !== 0;
    offset += 64;

    // sellTokenBalance (32 bytes / 64 hex chars)
    const sellTokenBalance = '0x' + hex.slice(offset, offset + 64);
    offset += 64;

    // buyTokenBalance (32 bytes / 64 hex chars)
    const buyTokenBalance = '0x' + hex.slice(offset, offset + 64);
    offset += 64;

    return {
      sellToken: ethers.utils.getAddress(sellToken),
      buyToken: ethers.utils.getAddress(buyToken),
      receiver: ethers.utils.getAddress(receiver),
      sellAmount,
      buyAmount,
      validTo,
      appData,
      feeAmount,
      kind,
      partiallyFillable,
      sellTokenBalance,
      buyTokenBalance,
    };
  } catch (error: any) {
    console.error('Error decoding order:', error.message);
    return null;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  CoW Protocol Order Decoder');
  console.log('  Decoding real hex-encoded orders from API');
  console.log('═══════════════════════════════════════════════════════\n');

  try {
    // Fetch latest auction
    console.log('📡 Fetching latest auction...\n');
    const latestResponse = await axios.get(`${COW_API_BASE}/api/v1/solver_competition/latest`);
    const auctionId = latestResponse.data.auctionId;

    console.log(`✅ Latest auction: ${auctionId}\n`);

    // Fetch full auction data
    console.log('📥 Fetching auction details...\n');
    const auctionResponse = await axios.get(`${COW_API_BASE}/api/v1/solver_competition/${auctionId}`);
    const auction = auctionResponse.data;

    const orders = auction.auction?.orders || [];
    console.log(`📋 Found ${orders.length} orders in auction\n`);

    if (orders.length === 0) {
      console.log('⚠️  No orders in this auction');
      return;
    }

    // Decode first 5 orders
    console.log('🔍 Decoding first 5 orders...\n');
    console.log('═══════════════════════════════════════════════════════\n');

    for (let i = 0; i < Math.min(5, orders.length); i++) {
      const hexOrder = orders[i];

      console.log(`\n📦 ORDER ${i + 1}`);
      console.log('─────────────────────────────────────────────────────');
      console.log(`Hex: ${hexOrder.substring(0, 66)}...${hexOrder.substring(hexOrder.length - 16)}`);
      console.log(`Length: ${hexOrder.length} characters (${(hexOrder.length - 2) / 2} bytes)\n`);

      const decoded = decodeOrder(hexOrder);

      if (decoded) {
        console.log('✅ DECODED ORDER:');
        console.log('─────────────────────────────────────────────────────');
        console.log(`Sell Token:  ${decoded.sellToken}`);
        console.log(`Buy Token:   ${decoded.buyToken}`);
        console.log(`Receiver:    ${decoded.receiver}`);
        console.log(`Sell Amount: ${decoded.sellAmount}`);
        console.log(`Buy Amount:  ${decoded.buyAmount}`);
        console.log(`Valid To:    ${decoded.validTo} (${new Date(decoded.validTo * 1000).toISOString()})`);
        console.log(`App Data:    ${decoded.appData.substring(0, 18)}...`);
        console.log(`Fee Amount:  ${decoded.feeAmount}`);
        console.log(`Kind:        ${decoded.kind}`);
        console.log(`Partially Fillable: ${decoded.partiallyFillable}`);
        console.log(`Sell Token Balance: ${decoded.sellTokenBalance}`);
        console.log(`Buy Token Balance:  ${decoded.buyTokenBalance}`);

        // Calculate price
        if (decoded.sellAmount !== '0' && decoded.buyAmount !== '0') {
          const sellBN = ethers.BigNumber.from(decoded.sellAmount);
          const buyBN = ethers.BigNumber.from(decoded.buyAmount);

          // Price = buyAmount / sellAmount
          const price = buyBN.mul(ethers.constants.WeiPerEther).div(sellBN);
          const priceFormatted = ethers.utils.formatEther(price);

          console.log(`\n💰 Price: ${priceFormatted} buy tokens per sell token`);
          console.log(`   (User wants to ${decoded.kind} at this rate or better)`);
        }

        // Explain order type
        console.log(`\n📝 Order Type: ${decoded.kind === 'sell' ? 'SELL ORDER' : 'BUY ORDER'}`);
        if (decoded.kind === 'sell') {
          console.log(`   User wants to sell exactly ${decoded.sellAmount} of ${decoded.sellToken}`);
          console.log(`   And receive at least ${decoded.buyAmount} of ${decoded.buyToken}`);
        } else {
          console.log(`   User wants to buy exactly ${decoded.buyAmount} of ${decoded.buyToken}`);
          console.log(`   And spend at most ${decoded.sellAmount} of ${decoded.sellToken}`);
        }

      } else {
        console.log('❌ Failed to decode order');
      }

      console.log('\n═══════════════════════════════════════════════════════');
    }

    // Summary
    console.log('\n\n💡 KEY INSIGHTS');
    console.log('─────────────────────────────────────────────────────');
    console.log('CoW Protocol orders contain:');
    console.log('  • Token pair (sell/buy)');
    console.log('  • Amounts (min buy or max sell)');
    console.log('  • Expiry time (validTo)');
    console.log('  • Fee information');
    console.log('  • Order type (sell vs buy)');
    console.log('  • Partial fill settings');
    console.log('');
    console.log('To solve an auction, we must:');
    console.log('  1. Decode all orders');
    console.log('  2. Find clearing prices for all tokens');
    console.log('  3. Determine which orders can be filled');
    console.log('  4. Route trades through DEXes');
    console.log('  5. Maximize user surplus + CoW opportunities');
    console.log('  6. Generate settlement calldata');
    console.log('');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
    }
    throw error;
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
