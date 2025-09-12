import { BigNumber } from 'ethers';

export interface MarketThresholds {
    MIN_LIQUIDITY_ETH: BigNumber;
    MIN_VOLUME_24H: BigNumber;
    MIN_MARKET_CAP: BigNumber;
    MAX_PAIRS: number;
    minProfitThreshold: BigNumber;
    minProfitWei: BigNumber;
    minLiquidityWei: BigNumber;
    maxTradeSize: BigNumber;
}

export const DEFAULT_THRESHOLDS: MarketThresholds = {
    // Further reduced minimum liquidity to 0.1 ETH for maximum opportunities
    MIN_LIQUIDITY_ETH: BigNumber.from('100000000000000000'),
    // Reduced minimum 24h volume to 0.01 ETH
    MIN_VOLUME_24H: BigNumber.from('10000000000000000'),
    // Reduced minimum market cap to 1 ETH for smaller tokens
    MIN_MARKET_CAP: BigNumber.from('1000000000000000000'),
    // Set to a very high number to effectively remove the limit
    MAX_PAIRS: 1000000,
    // Significantly reduced minimum profit threshold for opportunity discovery
    minProfitThreshold: BigNumber.from('1000000000000000'), // 0.001 ETH minimum profit (100x lower)
    minProfitWei: BigNumber.from('1000000000000000'), // 0.001 ETH minimum profit
    minLiquidityWei: BigNumber.from('100000000000000000'), // 0.1 ETH minimum liquidity
    maxTradeSize: BigNumber.from('10000000000000000000') // 10 ETH maximum trade size
};