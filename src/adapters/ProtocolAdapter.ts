import { BigNumber } from "@ethersproject/bignumber";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";
import { EthMarket, MarketType, BuyCalls } from "../EthMarket";
import { CurvePool } from "../markets/CurvePool";
import { BalancerV2Pool } from "../markets/BalancerV2Pool";
import { DODOV2Pool } from "../markets/DODOV2Pool";
import { KyberDMMPool } from "../markets/KyberDMMPool";
import { logInfo, logError, logDebug } from "../utils/logger";

export interface SwapParams {
    protocol: string;
    poolAddress: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: BigNumber;
    minAmountOut: BigNumber;
    recipient: string;
    deadline?: number;
    metadata?: any;
}

export interface EncodedSwap {
    target: string;
    calldata: string;
    value: BigNumber;
    estimatedGas?: BigNumber;
}

/**
 * Protocol adapter for standardizing swap encoding across different DEX protocols
 */
export class ProtocolAdapter {
    private provider: Provider;
    
    // Protocol-specific gas estimates (in gas units)
    private readonly GAS_ESTIMATES: Record<string, BigNumber> = {
        'uniswap-v2': BigNumber.from(150000),
        'curve': BigNumber.from(200000),
        'balancer-v2': BigNumber.from(180000),
        'dodo-v2': BigNumber.from(170000),
        'kyber-dmm': BigNumber.from(160000)
    };
    
    // Protocol-specific slippage tolerances (in basis points)
    private readonly DEFAULT_SLIPPAGE: Record<string, number> = {
        'uniswap-v2': 50,   // 0.5%
        'curve': 30,        // 0.3% (stable pools)
        'balancer-v2': 50,  // 0.5%
        'dodo-v2': 100,     // 1% (PMM can be more volatile)
        'kyber-dmm': 50     // 0.5%
    };
    
    constructor(provider: Provider) {
        this.provider = provider;
    }

    /**
     * Encode a swap for any supported protocol
     */
    async encodeSwap(params: SwapParams): Promise<EncodedSwap> {
        const protocol = params.protocol.toLowerCase();
        
        switch (protocol) {
            case 'uniswap-v2':
                return this.encodeUniswapV2Swap(params);
            case 'curve':
                return this.encodeCurveSwap(params);
            case 'balancer-v2':
                return this.encodeBalancerSwap(params);
            case 'dodo-v2':
                return this.encodeDODOSwap(params);
            case 'kyber-dmm':
                return this.encodeKyberSwap(params);
            default:
                throw new Error(`Unsupported protocol: ${protocol}`);
        }
    }

    /**
     * Encode Uniswap V2 style swap
     */
    private async encodeUniswapV2Swap(params: SwapParams): Promise<EncodedSwap> {
        const routerAbi = [
            "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)"
        ];
        
        // Assuming standard router address - would need to get from params.metadata
        const routerAddress = params.metadata?.router || '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
        const router = new Contract(routerAddress, routerAbi, this.provider);
        
        const deadline = params.deadline || Math.floor(Date.now() / 1000) + 60 * 20;
        const path = [params.tokenIn, params.tokenOut];
        
        const calldata = router.interface.encodeFunctionData('swapExactTokensForTokens', [
            params.amountIn,
            params.minAmountOut,
            path,
            params.recipient,
            deadline
        ]);
        
        return {
            target: routerAddress,
            calldata,
            value: BigNumber.from(0),
            estimatedGas: this.GAS_ESTIMATES['uniswap-v2']
        };
    }

    /**
     * Encode Curve swap
     */
    private async encodeCurveSwap(params: SwapParams): Promise<EncodedSwap> {
        const poolAbi = [
            "function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)"
        ];
        
        const pool = new Contract(params.poolAddress, poolAbi, this.provider);
        
        // Get token indices from metadata or calculate
        const i = params.metadata?.tokenIndexIn || 0;
        const j = params.metadata?.tokenIndexOut || 1;
        
        const calldata = pool.interface.encodeFunctionData('exchange', [
            i,
            j,
            params.amountIn,
            params.minAmountOut
        ]);
        
        return {
            target: params.poolAddress,
            calldata,
            value: BigNumber.from(0),
            estimatedGas: this.GAS_ESTIMATES['curve']
        };
    }

    /**
     * Encode Balancer V2 swap
     */
    private async encodeBalancerSwap(params: SwapParams): Promise<EncodedSwap> {
        const vaultAbi = [
            "function swap(tuple(bytes32 poolId, uint8 kind, address assetIn, address assetOut, uint256 amount, bytes userData) singleSwap, tuple(address sender, bool fromInternalBalance, address payable recipient, bool toInternalBalance) funds, uint256 limit, uint256 deadline) payable returns (uint256 amountCalculated)"
        ];
        
        const vaultAddress = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';
        const vault = new Contract(vaultAddress, vaultAbi, this.provider);
        
        const poolId = params.metadata?.poolId || '0x';
        const deadline = params.deadline || Math.floor(Date.now() / 1000) + 60 * 20;
        
        const singleSwap = {
            poolId,
            kind: 0, // GIVEN_IN
            assetIn: params.tokenIn,
            assetOut: params.tokenOut,
            amount: params.amountIn,
            userData: '0x'
        };
        
        const funds = {
            sender: params.recipient,
            fromInternalBalance: false,
            recipient: params.recipient,
            toInternalBalance: false
        };
        
        const calldata = vault.interface.encodeFunctionData('swap', [
            singleSwap,
            funds,
            params.minAmountOut,
            deadline
        ]);
        
        return {
            target: vaultAddress,
            calldata,
            value: BigNumber.from(0),
            estimatedGas: this.GAS_ESTIMATES['balancer-v2']
        };
    }

    /**
     * Encode DODO swap
     */
    private async encodeDODOSwap(params: SwapParams): Promise<EncodedSwap> {
        const poolAbi = [
            "function sellBase(address to) returns (uint256 receiveQuoteAmount)",
            "function sellQuote(address to) returns (uint256 receiveBaseAmount)"
        ];
        
        const pool = new Contract(params.poolAddress, poolAbi, this.provider);
        
        // Determine if selling base or quote token
        const isSellingBase = params.metadata?.isBase || true;
        
        const calldata = isSellingBase
            ? pool.interface.encodeFunctionData('sellBase', [params.recipient])
            : pool.interface.encodeFunctionData('sellQuote', [params.recipient]);
        
        return {
            target: params.poolAddress,
            calldata,
            value: BigNumber.from(0),
            estimatedGas: this.GAS_ESTIMATES['dodo-v2']
        };
    }

    /**
     * Encode Kyber DMM swap
     */
    private async encodeKyberSwap(params: SwapParams): Promise<EncodedSwap> {
        const poolAbi = [
            "function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)"
        ];
        
        const pool = new Contract(params.poolAddress, poolAbi, this.provider);
        
        // Determine output amounts based on token indices
        const amount0Out = params.metadata?.tokenOutIndex === 0 ? params.minAmountOut : BigNumber.from(0);
        const amount1Out = params.metadata?.tokenOutIndex === 1 ? params.minAmountOut : BigNumber.from(0);
        
        const calldata = pool.interface.encodeFunctionData('swap', [
            amount0Out,
            amount1Out,
            params.recipient,
            '0x'
        ]);
        
        return {
            target: params.poolAddress,
            calldata,
            value: BigNumber.from(0),
            estimatedGas: this.GAS_ESTIMATES['kyber-dmm']
        };
    }

    /**
     * Calculate minimum output amount with slippage
     */
    calculateMinOutput(
        expectedOutput: BigNumber,
        protocol: string,
        customSlippageBps?: number
    ): BigNumber {
        const slippageBps = customSlippageBps || this.DEFAULT_SLIPPAGE[protocol] || 100;
        const slippageMultiplier = BigNumber.from(10000 - slippageBps);
        return expectedOutput.mul(slippageMultiplier).div(10000);
    }

    /**
     * Estimate gas for a specific protocol swap
     */
    estimateGas(protocol: string): BigNumber {
        return this.GAS_ESTIMATES[protocol] || BigNumber.from(200000);
    }

    /**
     * Build multicall data for atomic multi-protocol swaps
     */
    buildMulticall(swaps: EncodedSwap[]): {
        targets: string[];
        calldatas: string[];
        values: BigNumber[];
        totalGas: BigNumber;
    } {
        const targets: string[] = [];
        const calldatas: string[] = [];
        const values: BigNumber[] = [];
        let totalGas = BigNumber.from(0);
        
        for (const swap of swaps) {
            targets.push(swap.target);
            calldatas.push(swap.calldata);
            values.push(swap.value);
            totalGas = totalGas.add(swap.estimatedGas || BigNumber.from(200000));
        }
        
        // Add overhead for multicall
        totalGas = totalGas.add(BigNumber.from(50000));
        
        return {
            targets,
            calldatas,
            values,
            totalGas
        };
    }

    /**
     * Validate swap parameters
     */
    validateSwapParams(params: SwapParams): boolean {
        if (!params.poolAddress || params.poolAddress === '0x0000000000000000000000000000000000000000') {
            logError("Invalid pool address");
            return false;
        }
        
        if (!params.tokenIn || !params.tokenOut) {
            logError("Invalid token addresses");
            return false;
        }
        
        if (params.amountIn.lte(0)) {
            logError("Invalid input amount");
            return false;
        }
        
        if (params.minAmountOut.lte(0)) {
            logError("Invalid minimum output amount");
            return false;
        }
        
        return true;
    }

    /**
     * Get protocol from market instance
     */
    static getProtocolFromMarket(market: MarketType): string {
        if (market instanceof CurvePool) return 'curve';
        if (market instanceof BalancerV2Pool) return 'balancer-v2';
        if (market instanceof DODOV2Pool) return 'dodo-v2';
        if (market instanceof KyberDMMPool) return 'kyber-dmm';
        return 'uniswap-v2'; // Default
    }
}