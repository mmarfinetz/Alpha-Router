import { BigNumber } from 'ethers';
import { MarketThresholds } from './thresholds';

/**
 * CoW Protocol Solver Thresholds
 * 
 * Much more permissive than MEV arbitrage thresholds
 * Goal: Route user orders through whatever liquidity is available
 */
export const COW_SOLVER_THRESHOLDS: MarketThresholds = {
  // Very low liquidity filter - accept almost any pool
  MIN_LIQUIDITY_ETH: BigNumber.from('10000000000000000'), // 0.01 ETH
  
  // No volume requirement for CoW routing
  MIN_VOLUME_24H: BigNumber.from('0'),
  
  // No market cap requirement
  MIN_MARKET_CAP: BigNumber.from('0'),
  
  // Max pairs
  MAX_PAIRS: 1000000,
  
  // Lower min profit since we're maximizing user surplus, not bot profit
  minProfitThreshold: BigNumber.from('1000000000000000'), // 0.001 ETH
  minProfitWei: BigNumber.from('1000000000000000'), // 0.001 ETH
  minLiquidityWei: BigNumber.from('10000000000000000'), // 0.01 ETH
  
  // Large max trade size for user orders
  maxTradeSize: BigNumber.from('1000000000000000000000'), // 1000 ETH
};

export const COW_MARKET_FILTERS = {
  MIN_LIQUIDITY_USD: 10, // $10 minimum (very permissive)
  MIN_VOLUME_USD: 0,
  MIN_TVL_USD: 0,
  MAX_SLIPPAGE_BPS: 500, // 5%
  MAX_PRICE_IMPACT_BPS: 500, // 5%
  MIN_SPREAD_BPS: 0,
  REQUIRE_WETH_PAIR: false, // Accept non-WETH pairs
  REQUIRE_PRICE_FEED: false,
};

