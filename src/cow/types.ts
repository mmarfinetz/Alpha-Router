import { BigNumber } from 'ethers';

export interface CoWAuction {
  id: string;
  orders: CoWOrder[];
  liquidity: CoWLiquidity[];
  effectiveGasPrice: string;
  deadline: string;
  surplus_capturing_jit_order_owners: string[];
}

export interface CoWOrder {
  uid: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  kind: 'sell' | 'buy';
  partiallyFillable: boolean;
  validTo: number;
  appData: string;
  feeAmount: string;
  receiver?: string;
  owner: string;
  sellTokenBalance: 'erc20' | 'internal' | 'external';
  buyTokenBalance: 'erc20' | 'internal';
}

export interface CoWLiquidity {
  kind: string; // "UniswapV2", "ConstantProduct", "WeightedProduct", "Stable"
  tokens: string[];
  reserves: string[];
  router: string;
  gasEstimate: string;
  address?: string;
  fee?: string;
  weights?: string[]; // For Balancer
  amplificationParameter?: string; // For Curve
}

export interface CoWSolution {
  id: number;
  prices: { [token: string]: string };
  trades: CoWTrade[];
  interactions: CoWInteraction[];
  score?: string;
  gas?: number;
}

export interface CoWTrade {
  kind: 'fulfillment' | 'jit';
  order: string; // UID
  executedAmount: string;
  fee?: string;
}

export interface CoWInteraction {
  kind: 'liquidity' | 'custom';
  internalize: boolean;
  id?: string;
  inputToken: string;
  outputToken: string;
  inputAmount: string;
  outputAmount: string;
}

export interface SolverResponse {
  solutions: CoWSolution[];
}