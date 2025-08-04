import * as dotenv from 'dotenv';
import { expect } from 'chai';

// Load environment variables
dotenv.config();

// Set default environment variables for testing
if (!process.env.ETH_MAINNET_URL) {
  process.env.ETH_MAINNET_URL = 'https://mainnet.infura.io/v3/test';
  console.warn('Warning: ETH_MAINNET_URL not set, using default test URL');
}

if (!process.env.PRIVATE_KEY) {
  process.env.PRIVATE_KEY = '0x' + '1'.repeat(64);
}

if (!process.env.BUNDLE_EXECUTOR_ADDRESS) {
  process.env.BUNDLE_EXECUTOR_ADDRESS = '0x' + '0'.repeat(40);
}

if (!process.env.FLASHBOTS_RELAY_SIGNING_KEY) {
  process.env.FLASHBOTS_RELAY_SIGNING_KEY = '0x' + '2'.repeat(64);
}

// Remove Jest setup that causes type errors - timeout is set in jest.config.js

// Make chai expect available globally for compatibility
declare global {
  var expect: typeof import('chai').expect;
}
(global as any).expect = expect;