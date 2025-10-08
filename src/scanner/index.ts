#!/usr/bin/env ts-node

/**
 * MEV Market Scanner - Unified Entry Point
 * 
 * This module provides a unified interface for both basic and advanced
 * market scanning capabilities. It serves as the main entry point for
 * all scanner operations.
 */

import { Command } from 'commander';
import { config } from 'dotenv';
import { BasicMarketScanner } from './basic-scanner';
// import { AdvancedMarketScanner } from './advanced-scanner';
// import { MarketScanner } from './market-scanner';
import { logInfo as info, logError as error } from '../utils/logger';

// Load environment variables
config();

const program = new Command();

program
  .name('mev-scanner')
  .description('MEV Market Scanner - Identify arbitrage opportunities across DEXes')
  .version('1.0.0');

program
  .command('basic')
  .description('Run basic market scanner (price difference monitoring)')
  .option('-i, --interval <seconds>', 'Scan interval in seconds', '10')
  .option('-t, --threshold <percent>', 'Minimum price difference threshold', '0.1')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options) => {
    try {
      info('Starting Basic Market Scanner...');
      
      const scanner = new BasicMarketScanner({
        scanInterval: parseInt(options.interval) * 1000,
        priceThreshold: parseFloat(options.threshold),
        verbose: options.verbose
      });
      
      await scanner.start();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      error('Failed to start basic scanner:', { error: err instanceof Error ? err : new Error(String(err)) });
      process.exit(1);
    }
  });

/*
program
  .command('advanced')
  .description('Run advanced market scanner (with arbitrage detection and execution)')
  .option('-i, --interval <seconds>', 'Scan interval in seconds', '30')
  .option('-e, --execute', 'Enable arbitrage execution (default: false)')
  .option('-p, --profit <eth>', 'Minimum profit threshold in ETH', '0.01')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options) => {
    try {
      info('Starting Advanced Market Scanner...');
      
      const scanner = new AdvancedMarketScanner({
        scanInterval: parseInt(options.interval) * 1000,
        executeArbitrage: options.execute || process.env.EXECUTE_ARBITRAGE === 'true',
        minProfitETH: parseFloat(options.profit),
        verbose: options.verbose
      });
      
      await scanner.start();
    } catch (err) {
      error('Failed to start advanced scanner:', err);
      process.exit(1);
    }
  });
*/

/*
program
  .command('legacy')
  .description('Run legacy market scanner (original implementation)')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options) => {
    try {
      info('Starting Legacy Market Scanner...');
      
      const scanner = new MarketScanner({
        verbose: options.verbose
      });
      
      await scanner.start();
    } catch (err) {
      error('Failed to start legacy scanner:', err);
      process.exit(1);
    }
  });
*/

// Default command - run basic scanner
program
  .action(async () => {
    try {
      info('Starting Default (Basic) Market Scanner...');
      
      const scanner = new BasicMarketScanner({
        scanInterval: 30000,
        priceThreshold: 0.1,
        verbose: false
      });
      
      await scanner.start();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      error('Failed to start scanner:', { error: err instanceof Error ? err : new Error(String(err)) });
      process.exit(1);
    }
  });

// Handle graceful shutdown
process.on('SIGINT', () => {
  info('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  info('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Parse command line arguments
if (require.main === module) {
  program.parse();
}

export { BasicMarketScanner };