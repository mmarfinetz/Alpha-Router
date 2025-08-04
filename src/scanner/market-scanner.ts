import { providers, Wallet, ethers, BigNumber } from 'ethers';
import { UniswapV2EthPair } from '../UniswapV2EthPair.js';
import { FACTORY_ADDRESSES, WETH_ADDRESS } from '../addresses.js';
import { DEFAULT_THRESHOLDS } from '../config/thresholds.js';
import { MarketsByToken } from '../types.js';
import * as dotenv from 'dotenv';
import { logInfo, logError, logDebug } from '../utils/logger.js';
import { formatEther, formatUnits } from 'ethers/lib/utils.js';

dotenv.config();

// Configuration
const ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/your-api-key';
const SCAN_INTERVAL_MS = 10000; // 10 seconds
const MIN_PRICE_DIFFERENCE_THRESHOLD = 0.001; // 0.1% minimum price difference to display
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

// Interface for price data
interface PriceData {
  marketAddress: string;
  dexName: string;
  token0Symbol: string;
  token1Symbol: string;
  token0Address: string;
  token1Address: string;
  token0Reserve: string;
  token1Reserve: string;
  price01: number; // token0/token1
  price10: number; // token1/token0
}

// Interface for price difference data
interface PriceDifferenceData {
  token0Symbol: string;
  token1Symbol: string;
  market1: PriceData;
  market2: PriceData;
  priceDifferencePercent: number;
}

/**
 * Main function to start the market scanner
 */
async function main() {
  console.log('\n=== MEV Market Scanner ===');
  console.log('Initializing...\n');

  try {
    // Initialize provider
    const provider = new providers.StaticJsonRpcProvider(ETHEREUM_RPC_URL);
    
    // Get network information
    const network = await provider.getNetwork();
    console.log(`Connected to network: ${network.name}\n`);

    // Start continuous scanning
    await startContinuousScanning(provider);
  } catch (error) {
    console.error('Error initializing market scanner:', error);
    process.exit(1);
  }
}

/**
 * Start continuous scanning of markets
 */
async function startContinuousScanning(provider: providers.StaticJsonRpcProvider) {
  console.log('Starting continuous market scanning...');
  console.log(`Scanning interval: ${SCAN_INTERVAL_MS / 1000} seconds\n`);

  // Initial scan
  await scanMarkets(provider);

  // Set up interval for continuous scanning
  setInterval(async () => {
    await scanMarkets(provider);
  }, SCAN_INTERVAL_MS);
}

/**
 * Scan markets for price differences
 */
async function scanMarkets(provider: providers.StaticJsonRpcProvider) {
  try {
    console.log('\nScanning markets for arbitrage opportunities...\n');

    // Fetch markets
    const markets = await UniswapV2EthPair.getUniswapMarketsByToken(
      provider,
      FACTORY_ADDRESSES,
      UniswapV2EthPair.impactAndFeeFuncs
    );

    // Update reserves for all pairs
    if (markets.allMarketPairs.length > 0) {
      await UniswapV2EthPair.updateReserves(
        provider as ethers.providers.JsonRpcProvider,
        markets.allMarketPairs,
        WETH_ADDRESS
      );
    }

    // Process markets and find price differences
    const priceDifferences = await findPriceDifferences(markets.marketsByToken);

    // Display results
    displayResults(priceDifferences);

    console.log('\nArbitrage scan completed!');
  } catch (error) {
    console.error('Error scanning markets:', error);
  }
}

/**
 * Find price differences between markets
 */
async function findPriceDifferences(marketsByToken: MarketsByToken): Promise<PriceDifferenceData[]> {
  const priceDifferences: PriceDifferenceData[] = [];
  const priceDataByToken: { [tokenPair: string]: PriceData[] } = {};

  // Process each token's markets
  for (const tokenAddress in marketsByToken) {
    const markets = marketsByToken[tokenAddress];

    // Skip if less than 2 markets (need at least 2 for comparison)
    if (markets.length < 2) continue;

    // Process each market
    for (const market of markets) {
      try {
        // Skip if tokens array is invalid
        if (!market.tokens || market.tokens.length < 2) continue;

        // Get token addresses
        const token0Address = market.tokens[0].toLowerCase();
        const token1Address = market.tokens[1].toLowerCase();
        
        // Create a unique key for the token pair (sorted to ensure consistency)
        const tokenPairKey = [token0Address, token1Address].sort().join('-');

        // Get reserves
        const reserves = await Promise.all([
          market.getReservesByToken(token0Address),
          market.getReservesByToken(token1Address)
        ]);

        // Skip if reserves are arrays or zero
        if (Array.isArray(reserves[0]) || Array.isArray(reserves[1]) || 
            reserves[0].isZero() || reserves[1].isZero()) continue;

        // Get token symbols
        const token0Symbol = TOKEN_SYMBOLS[token0Address] || 
                            TOKEN_SYMBOLS[token0Address.toLowerCase()] || 
                            shortenAddress(token0Address);
        const token1Symbol = TOKEN_SYMBOLS[token1Address] || 
                            TOKEN_SYMBOLS[token1Address.toLowerCase()] || 
                            shortenAddress(token1Address);

        // Get token decimals
        const token0Decimals = TOKEN_DECIMALS[token0Address] || 
                              TOKEN_DECIMALS[token0Address.toLowerCase()] || 18;
        const token1Decimals = TOKEN_DECIMALS[token1Address] || 
                              TOKEN_DECIMALS[token1Address.toLowerCase()] || 18;

        // Format reserves
        const token0Reserve = formatUnits(reserves[0], token0Decimals);
        const token1Reserve = formatUnits(reserves[1], token1Decimals);

        // Calculate prices
        const price01 = parseFloat(token1Reserve) / parseFloat(token0Reserve);
        const price10 = parseFloat(token0Reserve) / parseFloat(token1Reserve);

        // Get DEX name
        const factoryAddress = FACTORY_ADDRESSES.find(addr => 
          market.protocol.includes(addr.substring(2, 8).toLowerCase())
        );
        const dexName = factoryAddress ? DEX_NAMES[factoryAddress] || market.protocol : market.protocol;

        // Create price data object
        const priceData: PriceData = {
          marketAddress: market.marketAddress,
          dexName,
          token0Symbol,
          token1Symbol,
          token0Address,
          token1Address,
          token0Reserve,
          token1Reserve,
          price01,
          price10
        };

        // Add to price data by token
        if (!priceDataByToken[tokenPairKey]) {
          priceDataByToken[tokenPairKey] = [];
        }
        priceDataByToken[tokenPairKey].push(priceData);

        // Log market details
        console.log(`Checking ${dexName} ${token0Symbol}-${token1Symbol} (${market.marketAddress})...`);
        console.log(`Pair: ${token0Symbol}-${token1Symbol}`);
        console.log(`Token0 (${token0Symbol}) Reserve: ${token0Reserve}`);
        console.log(`Token1 (${token1Symbol}) Reserve: ${token1Reserve}`);
        console.log(`Price ${token0Symbol}/${token1Symbol}: ${price01}`);
        console.log(`Price ${token1Symbol}/${token0Symbol}: ${price10}`);
        console.log('');
      } catch (error) {
        console.error(`Error processing market ${market.marketAddress}:`, error);
        continue;
      }
    }
  }

  console.log('Checking for arbitrage opportunities...\n');

  // Compare prices between markets for each token pair
  for (const tokenPairKey in priceDataByToken) {
    const markets = priceDataByToken[tokenPairKey];
    
    // Skip if less than 2 markets
    if (markets.length < 2) continue;

    console.log(`Analyzing token pair: ${markets[0].token0Symbol}-${markets[0].token1Symbol}`);

    // Compare each market with every other market
    for (let i = 0; i < markets.length; i++) {
      for (let j = i + 1; j < markets.length; j++) {
        const market1 = markets[i];
        const market2 = markets[j];

        // Calculate price difference percentage
        const priceDifferencePercent = Math.abs(
          (market1.price01 - market2.price01) / ((market1.price01 + market2.price01) / 2)
        ) * 100;

        // Only add if price difference is above threshold
        if (priceDifferencePercent >= MIN_PRICE_DIFFERENCE_THRESHOLD) {
          priceDifferences.push({
            token0Symbol: market1.token0Symbol,
            token1Symbol: market1.token1Symbol,
            market1,
            market2,
            priceDifferencePercent
          });
        }

        // Log price difference
        console.log(`  Price difference between ${market1.dexName} ${market1.token0Symbol}-${market1.token1Symbol} and ${market2.dexName} ${market2.token0Symbol}-${market2.token1Symbol}: ${priceDifferencePercent.toFixed(4)}%`);
      }
    }
    console.log('');
  }

  // Sort by price difference (highest first)
  return priceDifferences.sort((a, b) => b.priceDifferencePercent - a.priceDifferencePercent);
}

/**
 * Display results of price differences
 */
function displayResults(priceDifferences: PriceDifferenceData[]) {
  if (priceDifferences.length === 0) {
    console.log('No significant price differences found above threshold.');
    return;
  }

  console.log(`\n=== Found ${priceDifferences.length} Significant Price Differences ===`);
  
  priceDifferences.forEach((diff, index) => {
    console.log(`\n${index + 1}. ${diff.token0Symbol}-${diff.token1Symbol} Price Difference: ${diff.priceDifferencePercent.toFixed(4)}%`);
    console.log(`   ${diff.market1.dexName}: ${diff.market1.price01.toFixed(8)} ${diff.token1Symbol}/${diff.token0Symbol}`);
    console.log(`   ${diff.market2.dexName}: ${diff.market2.price01.toFixed(8)} ${diff.token1Symbol}/${diff.token0Symbol}`);
    
    // Calculate potential profit for a 1 ETH trade (simplified)
    const tradeAmount = 1; // 1 ETH
    const potentialProfit = tradeAmount * (diff.priceDifferencePercent / 100);
    console.log(`   Potential profit for ${tradeAmount} ETH trade: ${potentialProfit.toFixed(6)} ETH (before fees)`);
  });
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