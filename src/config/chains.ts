/**
 * Multi-chain configuration for CoW Protocol Solver
 * Supports Ethereum Mainnet and Arbitrum
 */

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  tokens: {
    WETH: string;
    USDC: string;
    USDT: string;
    DAI: string;
  };
  dexes: {
    [dexName: string]: {
      factory: string;
      router: string;
      fee: number; // basis points
    };
  };
}

// Ethereum Mainnet Configuration
export const MAINNET_CONFIG: ChainConfig = {
  chainId: 1,
  name: 'mainnet',
  rpcUrl: process.env.ETHEREUM_RPC_URL || '',
  tokens: {
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F'
  },
  dexes: {
    UniswapV2: {
      factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
      router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
      fee: 300
    },
    SushiSwap: {
      factory: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
      router: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
      fee: 300
    }
  }
};

// Arbitrum One Configuration
export const ARBITRUM_CONFIG: ChainConfig = {
  chainId: 42161,
  name: 'arbitrum',
  rpcUrl: process.env.ARBITRUM_RPC_URL || process.env.ETHEREUM_RPC_URL || '',
  tokens: {
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',    // USDC (native)
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1'
  },
  dexes: {
    UniswapV2: {
      factory: '0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9',  // Uniswap V2 on Arbitrum
      router: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
      fee: 300
    },
    SushiSwap: {
      factory: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',  // SushiSwap on Arbitrum
      router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
      fee: 300
    },
    Camelot: {
      factory: '0x6EcCab422D763aC031210895C81787E87B43A652',  // Camelot (Arbitrum native)
      router: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
      fee: 300
    }
  }
};

// Get current chain config based on CHAIN_ID env variable
export function getChainConfig(): ChainConfig {
  const chainId = parseInt(process.env.CHAIN_ID || '1');
  
  switch (chainId) {
    case 42161:
      console.log('🌐 Configured for Arbitrum One');
      return ARBITRUM_CONFIG;
    case 1:
      console.log('🌐 Configured for Ethereum Mainnet');
      return MAINNET_CONFIG;
    default:
      console.warn(`⚠️  Unknown CHAIN_ID: ${chainId}, defaulting to mainnet`);
      return MAINNET_CONFIG;
  }
}

// Export current chain config
export const CURRENT_CHAIN = getChainConfig();

// Helper to get token address for current chain
export function getTokenAddress(symbol: 'WETH' | 'USDC' | 'USDT' | 'DAI'): string {
  return CURRENT_CHAIN.tokens[symbol];
}

// Helper to check if we're on Arbitrum
export function isArbitrum(): boolean {
  return CURRENT_CHAIN.chainId === 42161;
}

// Helper to check if we're on mainnet
export function isMainnet(): boolean {
  return CURRENT_CHAIN.chainId === 1;
}

