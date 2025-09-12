export const UNISWAP_LOOKUP_CONTRACT_ADDRESS = '0x5EF1009b9FCD4fec3094a5564047e190D72Bd511'
//mainnet ^^  goerli vv
//export const UNISWAP_LOOKUP_CONTRACT_ADDRESS = '0xF52FE911458C6a3279832b764cDF0189e49f073A'
export const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

// Uniswap V2
export const UNISWAP_FACTORY_ADDRESS = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
export const UNISWAP_ROUTER_ADDRESS = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';

// SushiSwap
export const SUSHISWAP_FACTORY_ADDRESS = '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac';
export const SUSHISWAP_ROUTER_ADDRESS = '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F';

// PancakeSwap V2 (on Ethereum)
export const PANCAKESWAP_FACTORY_ADDRESS = '0x1097053Fd2ea711dad45caCcc45EfF7548fCB362';
export const PANCAKESWAP_ROUTER_ADDRESS = '0xEfF92A263d31888d860bD50809A8D171709b7b1c';

// Shibaswap
export const SHIBASWAP_FACTORY_ADDRESS = '0x115934131916C8b277DD010Ee02de363c09d037c';
export const SHIBASWAP_ROUTER_ADDRESS = '0x03f7724180AA6b939894B5Ca4314783B0b36b329';

// 1inch Liquidity Protocol
export const ONEINCH_FACTORY_ADDRESS = '0xbAF9A5d4b0052359326A6CDAb54BABAa3a3A9643';

// Kyber DMM
export const KYBER_DMM_FACTORY_ADDRESS = '0x833e4083B7ae46CeA85695c4f7ed25CDAd8886dE';

// DODO V2
export const DODO_V2_FACTORY_ADDRESS = '0x6B4Fa0bc61Eddc928e0Df9c7f01e407BfcD3e5EF';

// Fraxswap
export const FRAXSWAP_FACTORY_ADDRESS = '0x43eC799eAdd63848443E2347C49f5f52e8Fe0F6f';

// Curve Finance - Main 3Pool (most liquid stablecoin pool)
export const CURVE_3POOL_ADDRESS = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7';
export const CURVE_REGISTRY_ADDRESS = '0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5';

// Balancer V2
export const BALANCER_VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';

// Legacy addresses (commented out)
//export const CRO_FACTORY_ADDRESS = "0x9DEB29c9a4c7A88a3C0257393b7f3335338D9A9D";
//export const ZEUS_FACTORY_ADDRESS = "0xbdda21dd8da31d5bee0c9bb886c044ebb9b8906a";
//export const LUA_FACTORY_ADDRESS = "0x0388c1e0f210abae597b7de712b9510c6c36c857";

// Uniswap V2 compatible factory addresses (support allPairsLength() and getPair() methods)
export const UNISWAP_V2_COMPATIBLE_FACTORIES = [
  UNISWAP_FACTORY_ADDRESS,
  SUSHISWAP_FACTORY_ADDRESS,
  PANCAKESWAP_FACTORY_ADDRESS,
  SHIBASWAP_FACTORY_ADDRESS,
  FRAXSWAP_FACTORY_ADDRESS,
];

// Non-compatible DEX factories (different interfaces, need specialized handlers)
export const NON_COMPATIBLE_FACTORIES = [
  ONEINCH_FACTORY_ADDRESS,   // 1inch uses different interface
  KYBER_DMM_FACTORY_ADDRESS, // Kyber DMM has different factory methods
  DODO_V2_FACTORY_ADDRESS,   // DODO V2 doesn't implement allPairsLength()
];

// Main factory addresses for cross-DEX arbitrage (currently only compatible ones)
export const FACTORY_ADDRESSES = [
  ...UNISWAP_V2_COMPATIBLE_FACTORIES,
  // TODO: Add specialized handlers for non-compatible factories
  // ...NON_COMPATIBLE_FACTORIES,
];

// Protocol-specific registry and helper contracts
export const PROTOCOL_REGISTRIES = {
  CURVE: {
    REGISTRY: '0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5',
    POOL_INFO: '0x928237401124e58105FC82Bd8E538b5Ef1ff7b29',
    METAPOOL_FACTORY: '0xB9fC157394Af804a3578134A6585C0dc9cc990d4',
    CRYPTO_REGISTRY: '0x4AacF35761d06Aa7142B9326612A42A2b9170E33',
    GAUGE_CONTROLLER: '0x2F50D538606Fa9EDD2B11E2446BEb18C9D5846bB'
  },
  BALANCER: {
    VAULT: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
    HELPERS: '0x5aDDCCa35b7A0D07C74063c48700C8590E87864E',
    WEIGHTED_POOL_FACTORY: '0x8E9aa87E45e92bad84D5F8DD1bff34Fb92637dE9',
    STABLE_POOL_FACTORY: '0xc66Ba2B6595D3613CCab350C886aCE23866EDe24'
  },
  DODO: {
    DODOApprove: '0x6D310348d5c12009854DFCf72e0DF9027e8cb4f4',
    DODOProxy: '0xa356867fDCEa8e71AEaF87805808803806231FdC',
    REGISTRY: '0x3A97247DF274a17C59A3bd12735ea3FcDFb49950',
    V2_FACTORY: '0x6B4Fa0bc61Eddc928e0Df9c7f01e407BfcD3e5EF',
    STABLE_FACTORY: '0x0fb17dB61d5e8fF2fD8e821f2C41D3651A76569E'
  },
  KYBER: {
    DMM_FACTORY: '0x833e4083B7ae46CeA85695c4f7ed25CDAd8886dE',
    ELASTIC_FACTORY: '0xC7a590291e07B9fe9E64b86c58fD8fC764308C4A',
    ROUTER: '0x1c87257F5e8609940Bc751a07BB085Bb7f8cDBE6'
  }
};

// DEX metadata for better tracking and logging
export interface DEXInfo {
  name: string;
  factory: string;
  router?: string;
  fee: number; // Fee in basis points (300 = 0.3%)
  type: 'uniswap-v2' | 'balancer-v2' | 'curve' | 'dodo-v2' | 'kyber-dmm';
  compatible: boolean; // Whether it supports standard Uniswap V2 interface
  protocolSpecific?: {
    registry?: string;
    vault?: string;
    proxy?: string;
    router?: string;
  };
}

export const DEX_INFO: { [key: string]: DEXInfo } = {
  [UNISWAP_FACTORY_ADDRESS]: {
    name: 'Uniswap V2',
    factory: UNISWAP_FACTORY_ADDRESS,
    router: UNISWAP_ROUTER_ADDRESS,
    fee: 300,
    type: 'uniswap-v2',
    compatible: true
  },
  [SUSHISWAP_FACTORY_ADDRESS]: {
    name: 'SushiSwap',
    factory: SUSHISWAP_FACTORY_ADDRESS,
    router: SUSHISWAP_ROUTER_ADDRESS,
    fee: 300,
    type: 'uniswap-v2',
    compatible: true
  },
  [PANCAKESWAP_FACTORY_ADDRESS]: {
    name: 'PancakeSwap V2',
    factory: PANCAKESWAP_FACTORY_ADDRESS,
    router: PANCAKESWAP_ROUTER_ADDRESS,
    fee: 250, // 0.25% fee
    type: 'uniswap-v2',
    compatible: true
  },
  [SHIBASWAP_FACTORY_ADDRESS]: {
    name: 'ShibaSwap',
    factory: SHIBASWAP_FACTORY_ADDRESS,
    router: SHIBASWAP_ROUTER_ADDRESS,
    fee: 300,
    type: 'uniswap-v2',
    compatible: true
  },
  [ONEINCH_FACTORY_ADDRESS]: {
    name: '1inch Liquidity Protocol',
    factory: ONEINCH_FACTORY_ADDRESS,
    fee: 0, // Variable fee
    type: 'uniswap-v2',
    compatible: false // Different interface
  },
  [FRAXSWAP_FACTORY_ADDRESS]: {
    name: 'Fraxswap',
    factory: FRAXSWAP_FACTORY_ADDRESS,
    fee: 300,
    type: 'uniswap-v2',
    compatible: true
  },
  // Curve Finance
  [CURVE_REGISTRY_ADDRESS]: {
    name: 'Curve Finance',
    factory: CURVE_REGISTRY_ADDRESS,
    fee: 40, // 0.04% typical for stablecoins
    type: 'curve',
    compatible: false,
    protocolSpecific: {
      registry: CURVE_REGISTRY_ADDRESS
    }
  },
  // Balancer V2
  [BALANCER_VAULT_ADDRESS]: {
    name: 'Balancer V2',
    factory: BALANCER_VAULT_ADDRESS,
    fee: 100, // Variable, 0.1% typical
    type: 'balancer-v2',
    compatible: false,
    protocolSpecific: {
      vault: BALANCER_VAULT_ADDRESS
    }
  },
  // DODO V2 (update existing entry)
  [DODO_V2_FACTORY_ADDRESS]: {
    name: 'DODO V2',
    factory: DODO_V2_FACTORY_ADDRESS,
    fee: 300,
    type: 'dodo-v2',
    compatible: false,
    protocolSpecific: {
      registry: PROTOCOL_REGISTRIES.DODO.REGISTRY,
      proxy: PROTOCOL_REGISTRIES.DODO.DODOProxy
    }
  },
  // Kyber DMM (update existing entry)
  [KYBER_DMM_FACTORY_ADDRESS]: {
    name: 'Kyber DMM',
    factory: KYBER_DMM_FACTORY_ADDRESS,
    fee: 200, // Variable fee, 0.2% average
    type: 'kyber-dmm',
    compatible: false,
    protocolSpecific: {
      router: PROTOCOL_REGISTRIES.KYBER.ROUTER
    }
  }
};
