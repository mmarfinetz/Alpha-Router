import { ethers } from 'ethers';
import { CoWSolverServer } from './server';
import logger from '../utils/logger';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env file from project root (only for local dev, Railway uses env vars)
if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.join(__dirname, '../../.env') });
  dotenv.config({ path: path.join(__dirname, '.env.competition') });
}

async function main() {
  try {
    console.log('🚀 CoW Solver starting...');
    console.log('NODE_ENV:', process.env.NODE_ENV);
    console.log('PORT:', process.env.PORT);

    // Load configuration from environment
    const rpcUrl = process.env.ETHEREUM_RPC_URL || process.env.RPC_URL;
    const privateKey = process.env.PRIVATE_KEY;
    const bundleExecutorAddress = process.env.BUNDLE_EXECUTOR_ADDRESS;
    // Railway sets PORT automatically, fallback to COW_SOLVER_PORT or 8000
    const port = parseInt(process.env.PORT || process.env.COW_SOLVER_PORT || '8000');

    console.log('Configuration loaded');
    logger.info('Starting CoW Solver with configuration:');
    logger.info(`- RPC URL: ${rpcUrl ? rpcUrl.substring(0, 30) + '...' : 'NOT SET'}`);
    logger.info(`- Private Key: ${privateKey ? 'SET' : 'NOT SET'}`);
    logger.info(`- Bundle Executor: ${bundleExecutorAddress || 'NOT SET'}`);
    logger.info(`- Port: ${port}`);
    logger.info(`- Node Environment: ${process.env.NODE_ENV || 'development'}`);

    if (!rpcUrl) {
      throw new Error('ETHEREUM_RPC_URL or RPC_URL not set');
    }

    if (!privateKey) {
      throw new Error('PRIVATE_KEY not set');
    }

    // For shadow competition, we don't execute real trades, so use dummy address if not set
    const executorAddress = bundleExecutorAddress || '0x0000000000000000000000000000000000000001';
    if (!bundleExecutorAddress) {
      logger.warn('BUNDLE_EXECUTOR_ADDRESS not set, using dummy address (shadow mode)');
    }

    // Initialize provider and wallet
    logger.info('Connecting to Ethereum network...');
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    // Check connection
    const network = await provider.getNetwork();
    logger.info(`Connected to network: ${network.name} (chainId: ${network.chainId})`);
    logger.info(`Wallet address: ${wallet.address}`);

    // Start the solver server
    const server = new CoWSolverServer(
      provider,
      wallet,
      executorAddress,
      port
    );

    await server.start();

  } catch (error: any) {
    logger.error('Failed to start CoW solver:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down CoW solver...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down CoW solver...');
  process.exit(0);
});

main();