import { providers, Wallet, ethers, BigNumber } from 'ethers';
import { UniswapV2EthPair } from '../UniswapV2EthPair';
import { FACTORY_ADDRESSES, WETH_ADDRESS } from '../addresses';
import { DEFAULT_THRESHOLDS } from '../config/thresholds';
import { MarketsByToken, CrossedMarketDetails } from '../types';
import { Arbitrage } from '../Arbitrage';
import * as dotenv from 'dotenv';
import { logInfo, logError } from '../utils/logger';
import { formatEther, formatUnits } from 'ethers/lib/utils';
import { Contract } from '@ethersproject/contracts';
import { BUNDLE_EXECUTOR_ABI } from '../abi';
import { CircuitBreaker } from '../utils/CircuitBreaker';
import { GasPriceManager } from '../utils/GasPriceManager';

dotenv.config();

// Configuration
const ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/your-api-key';
const SCAN_INTERVAL_MS = 30000; // 30 seconds
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
const BUNDLE_EXECUTOR_ADDRESS = process.env.BUNDLE_EXECUTOR_ADDRESS || '';
const MIN_PROFIT_THRESHOLD = ethers.utils.parseEther('0.01'); // 0.01 ETH
const MAX_ATTEMPTS = 3;

// Token symbols for better display
const TOKEN_SYMBOLS: { [address: string]: string } = {
  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': 'WETH',
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 'USDC',
  '0xdAC17F958D2ee523a2206206994597C13D831ec7': 'USDT',
  '0x6B175474E89094C44Da98b954EedeAC495271d0F': 'DAI',
  '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599': 'WBTC',
  // Add more token symbols as needed
};

// Token decimals for proper formatting
const TOKEN_DECIMALS: { [address: string]: number } = {
  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': 18, // WETH
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 6,  // USDC
  '0xdAC17F958D2ee523a2206206994597C13D831ec7': 6,  // USDT
  '0x6B175474E89094C44Da98b954EedeAC495271d0F': 18, // DAI
  '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599': 8,  // WBTC
  // Add more token decimals as needed
};

// DEX names for better display
const DEX_NAMES: { [factoryAddress: string]: string } = {
  '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f': 'Uniswap V2',
  '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac': 'SushiSwap',
  // Add more DEX names as needed
};

// Circuit breaker configuration
const circuitBreakerConfig = {
  maxFailures: 3,
  resetTimeoutMs: 60000, // 1 minute
  cooldownPeriodMs: 300000 // 5 minutes
};

/**
 * Main function to start the advanced market scanner
 */
async function main() {
  console.log('\n=== Advanced MEV Market Scanner ===');
  console.log('Initializing...\n');

  try {
    // Check for required environment variables
    if (!PRIVATE_KEY) {
      console.error('Error: PRIVATE_KEY environment variable is required');
      process.exit(1);
    }

    if (!BUNDLE_EXECUTOR_ADDRESS) {
      console.error('Error: BUNDLE_EXECUTOR_ADDRESS environment variable is required');
      process.exit(1);
    }

    // Initialize provider
    const provider = new providers.StaticJsonRpcProvider(ETHEREUM_RPC_URL);
    
    // Get network information
    const network = await provider.getNetwork();
    console.log(`Connected to network: ${network.name}\n`);

    // Initialize wallet
    const wallet = new Wallet(PRIVATE_KEY, provider);
    console.log(`Using wallet address: ${wallet.address}\n`);

    // Initialize circuit breaker and gas price manager
    const circuitBreaker = new CircuitBreaker(circuitBreakerConfig);
    const gasPriceManager = new GasPriceManager(provider);

    // Initialize bundle executor contract
    const bundleExecutorContract = new Contract(
      BUNDLE_EXECUTOR_ADDRESS,
      BUNDLE_EXECUTOR_ABI,
      provider
    );

    // Initialize arbitrage instance
    const arbitrage = new Arbitrage(
      wallet,
      provider,
      bundleExecutorContract,
      DEFAULT_THRESHOLDS,
      circuitBreaker,
      gasPriceManager
    );

    // Start continuous scanning
    await startContinuousScanning(provider, arbitrage);
  } catch (error) {
    console.error('Error initializing advanced market scanner:', error);
    process.exit(1);
  }
}

/**
 * Start continuous scanning of markets
 */
async function startContinuousScanning(
  provider: providers.StaticJsonRpcProvider,
  arbitrage: Arbitrage
) {
  console.log('Starting continuous market scanning...');
  console.log(`Scanning interval: ${SCAN_INTERVAL_MS / 1000} seconds\n`);

  // Initial scan
  await scanMarkets(provider, arbitrage);

  // Set up interval for continuous scanning
  setInterval(async () => {
    await scanMarkets(provider, arbitrage);
  }, SCAN_INTERVAL_MS);
}

/**
 * Scan markets for arbitrage opportunities
 */
async function scanMarkets(
  provider: providers.StaticJsonRpcProvider,
  arbitrage: Arbitrage
) {
  try {
    console.log('\n=== Scanning markets for arbitrage opportunities ===\n');
    console.log('Fetching markets...');

    // Fetch markets
    const markets = await UniswapV2EthPair.getUniswapMarketsByToken(
      provider,
      FACTORY_ADDRESSES,
      UniswapV2EthPair.impactAndFeeFuncs
    );

    console.log(`Found ${markets.allMarketPairs.length} market pairs across ${Object.keys(markets.marketsByToken).length} tokens\n`);

    // Update reserves for all pairs
    if (markets.allMarketPairs.length > 0) {
      console.log('Updating market reserves...');
      await UniswapV2EthPair.updateReserves(
        provider as ethers.providers.JsonRpcProvider,
        markets.allMarketPairs,
        WETH_ADDRESS
      );
      console.log('Reserves updated successfully\n');
    }

    // Use the Arbitrage class to evaluate markets
    console.log('Evaluating markets for arbitrage opportunities...');
    const opportunities = await arbitrage.evaluateMarkets(markets.marketsByToken as MarketsByToken);
    
    // Display results
    displayArbitrageOpportunities(opportunities);

    // Get current block
    const currentBlock = await provider.getBlockNumber();
    console.log(`Current block: ${currentBlock}\n`);

    // Execute arbitrage if enabled
    const executeArbitrage = process.env.EXECUTE_ARBITRAGE === 'true';
    if (executeArbitrage && opportunities.length > 0) {
      console.log('Executing arbitrage trades...');
      await arbitrage.takeCrossedMarkets(opportunities, currentBlock, MAX_ATTEMPTS);
      console.log('Arbitrage execution completed\n');
    } else if (opportunities.length > 0) {
      console.log('Arbitrage execution is disabled. Set EXECUTE_ARBITRAGE=true to enable.\n');
    }

    console.log('Scan completed!');
  } catch (error) {
    console.error('Error scanning markets:', error);
  }
}

/**
 * Display arbitrage opportunities
 */
function displayArbitrageOpportunities(opportunities: CrossedMarketDetails[]) {
  if (opportunities.length === 0) {
    console.log('No arbitrage opportunities found.\n');
    return;
  }

  console.log(`\n=== Found ${opportunities.length} Arbitrage Opportunities ===\n`);
  
  opportunities.forEach((opportunity, index) => {
    // Get token symbols
    const token0 = opportunity.buyFromMarket.tokens[0];
    const token1 = opportunity.buyFromMarket.tokens[1];
    const token0Symbol = getTokenSymbol(token0);
    const token1Symbol = getTokenSymbol(token1);
    
    // Get DEX names
    const buyFromDex = getDexName(opportunity.buyFromMarket.protocol);
    const sellToDex = getDexName(opportunity.sellToMarket.protocol);
    
    // Format profit and volume
    const profit = formatEther(opportunity.profit);
    const volume = formatEther(opportunity.volume);
    
    console.log(`Opportunity #${index + 1}:`);
    console.log(`  Pair: ${token0Symbol}-${token1Symbol}`);
    console.log(`  Buy from: ${buyFromDex} (${opportunity.buyFromMarket.marketAddress})`);
    console.log(`  Sell to: ${sellToDex} (${opportunity.sellToMarket.marketAddress})`);
    console.log(`  Volume: ${volume} ETH`);
    console.log(`  Profit: ${profit} ETH`);
    console.log(`  Gas cost: ~${(parseFloat(profit) * 0.1).toFixed(6)} ETH (estimated)`);
    console.log(`  Net profit: ~${(parseFloat(profit) * 0.9).toFixed(6)} ETH (estimated)\n`);
  });
}

/**
 * Get token symbol from address
 */
function getTokenSymbol(address: string): string {
  const normalizedAddress = address.toLowerCase();
  return TOKEN_SYMBOLS[normalizedAddress] || 
         TOKEN_SYMBOLS[address] || 
         shortenAddress(address);
}

/**
 * Get DEX name from protocol
 */
function getDexName(protocol: string): string {
  if (protocol.includes('uniswap')) return 'Uniswap V2';
  if (protocol.includes('sushi')) return 'SushiSwap';
  return protocol;
}

/**
 * Helper function to shorten an address for display
 */
function shortenAddress(address: string): string {
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

// Start the scanner
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 