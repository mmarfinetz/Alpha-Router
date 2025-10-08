import { BigNumber } from "@ethersproject/bignumber";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";
import { formatUnits, parseUnits } from "@ethersproject/units";
import { EthMarket, MarketType, CallDetails, BuyCalls } from "../EthMarket";
import { logInfo, logError, logDebug, logWarn } from "../utils/logger";

// Curve Pool ABIs - minimal interfaces needed
const CURVE_POOL_ABI = [
    "function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)",
    "function get_dy_underlying(int128 i, int128 j, uint256 dx) view returns (uint256)",
    "function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)",
    "function exchange_underlying(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)",
    "function get_balances() view returns (uint256[])",
    "function balances(uint256 i) view returns (uint256)",
    "function coins(uint256 i) view returns (address)",
    "function A() view returns (uint256)",
    "function fee() view returns (uint256)",
    "function get_virtual_price() view returns (uint256)",
    "function calc_token_amount(uint256[] amounts, bool is_deposit) view returns (uint256)",
    "function N_COINS() view returns (uint256)"
];

const CURVE_REGISTRY_ABI = [
    "function get_pool_from_lp_token(address lp_token) view returns (address)",
    "function get_n_coins(address pool) view returns (uint256[2])",
    "function get_coins(address pool) view returns (address[8])",
    "function get_decimals(address pool) view returns (uint256[8])",
    "function get_balances(address pool) view returns (uint256[8])",
    "function get_underlying_balances(address pool) view returns (uint256[8])",
    "function get_rates(address pool) view returns (uint256[8])",
    "function get_gauges(address pool) view returns (address[10], int128[10])",
    "function get_pool_name(address pool) view returns (string)",
    "function get_coin_indices(address pool, address from, address to) view returns (int128, int128, bool)"
];

interface CurvePoolInfo {
    nCoins: number;
    coins: string[];
    decimals: number[];
    balances: BigNumber[];
    amplificationParameter: BigNumber;
    fee: BigNumber;
    isMetaPool: boolean;
    underlyingCoins?: string[];
}

export class CurvePool extends EthMarket implements MarketType {
    private contract: Contract;
    private registryContract: Contract;
    private poolInfo?: CurvePoolInfo;
    private lastUpdateBlock: number = 0;
    private readonly UPDATE_FREQUENCY = 10; // Update every 10 blocks
    private _reserves: BigNumber[] = [];
    
    // Curve-specific constants
    private readonly FEE_DENOMINATOR = BigNumber.from("10000000000"); // 1e10
    private readonly PRECISION = BigNumber.from("1000000000000000000"); // 1e18
    private readonly A_PRECISION = BigNumber.from("100");
    
    constructor(
        marketAddress: string,
        tokens: string[],
        provider: Provider,
        registryAddress: string = "0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5"
    ) {
        super(marketAddress, tokens, "Curve", tokens[0]); // Using first token as primary
        this.contract = new Contract(marketAddress, CURVE_POOL_ABI, provider);
        this.registryContract = new Contract(registryAddress, CURVE_REGISTRY_ABI, provider);
    }

    /**
     * Initialize pool information from registry
     */
    private async initializePoolInfo(): Promise<void> {
        try {
            // Get basic pool information from registry
            const [nCoinsRaw, coins, decimals, balances] = await Promise.all([
                this.registryContract.get_n_coins(this.marketAddress),
                this.registryContract.get_coins(this.marketAddress),
                this.registryContract.get_decimals(this.marketAddress),
                this.registryContract.get_balances(this.marketAddress)
            ]);

            const nCoins = nCoinsRaw[0].toNumber();
            
            // Get amplification parameter and fee from pool directly
            const [amplification, fee] = await Promise.all([
                this.contract.A().catch(() => BigNumber.from("2000")), // Default A value
                this.contract.fee().catch(() => BigNumber.from("4000000")) // Default 0.04% fee
            ]);

            // Filter out zero addresses and create arrays
            const validCoins: string[] = [];
            const validDecimals: number[] = [];
            const validBalances: BigNumber[] = [];
            
            for (let i = 0; i < nCoins; i++) {
                if (coins[i] !== "0x0000000000000000000000000000000000000000") {
                    validCoins.push(coins[i]);
                    validDecimals.push(decimals[i].toNumber());
                    validBalances.push(balances[i]);
                }
            }

            // Check if it's a metapool by trying to get underlying coins
            let underlyingCoins: string[] | undefined;
            try {
                const underlyingBalances = await this.registryContract.get_underlying_balances(this.marketAddress);
                if (underlyingBalances[0].gt(0)) {
                    underlyingCoins = validCoins; // Simplified - would need proper underlying coin fetching
                }
            } catch {
                // Not a metapool
            }

            this.poolInfo = {
                nCoins,
                coins: validCoins,
                decimals: validDecimals,
                balances: validBalances,
                amplificationParameter: amplification,
                fee,
                isMetaPool: !!underlyingCoins,
                underlyingCoins
            };

            this._reserves = validBalances;
            
            logDebug("Initialized Curve pool");

        } catch (error) {
            logError("Failed to initialize Curve pool info");
            throw error;
        }
    }

    /**
     * StableSwap invariant calculation (simplified for 2-asset pools)
     * D calculation: An^n * sum(x_i) + D = An^n * D + D^(n+1) / (n^n * prod(x_i))
     */
    private calculateStableSwapInvariant(balances: BigNumber[], amp: BigNumber): BigNumber {
        const n = BigNumber.from(balances.length);
        const ann = amp.mul(n);
        
        // Initial guess for D
        let d = balances.reduce((sum, balance) => sum.add(balance), BigNumber.from(0));
        let dPrev = BigNumber.from(0);
        
        // Newton's method iteration
        for (let i = 0; i < 255; i++) {
            let dProduct = d;
            let s = BigNumber.from(0);
            
            for (const balance of balances) {
                s = s.add(balance);
                dProduct = dProduct.mul(d).div(balance.mul(n));
            }
            
            dPrev = d;
            const numerator = d.mul(ann.mul(s).add(dProduct.mul(n)));
            const denominator = d.mul(ann.sub(BigNumber.from(1))).add(dProduct.mul(n.add(BigNumber.from(1))));
            
            d = numerator.div(denominator);
            
            // Check convergence
            const diff = d.gt(dPrev) ? d.sub(dPrev) : dPrev.sub(d);
            if (diff.lte(1)) {
                return d;
            }
        }
        
        return d;
    }

    /**
     * Calculate output amount for a swap using StableSwap formula
     */
    private calculateSwapOutput(
        tokenIndexIn: number,
        tokenIndexOut: number,
        amountIn: BigNumber,
        balances: BigNumber[],
        amp: BigNumber,
        fee: BigNumber
    ): BigNumber {
        const n = balances.length;
        
        // Calculate D (invariant) before swap
        const d = this.calculateStableSwapInvariant(balances, amp);
        
        // Apply fee to input amount
        const feeMultiplier = this.FEE_DENOMINATOR.sub(fee);
        const amountInAfterFee = amountIn.mul(feeMultiplier).div(this.FEE_DENOMINATOR);
        
        // New balance of input token
        const newBalanceIn = balances[tokenIndexIn].add(amountInAfterFee);
        
        // Calculate new balance of output token to maintain invariant
        const ann = amp.mul(n);
        let y = d;
        let yPrev = BigNumber.from(0);
        
        // Calculate sum of balances excluding output token
        let s = BigNumber.from(0);
        let c = d;
        
        for (let i = 0; i < n; i++) {
            if (i === tokenIndexOut) continue;
            const balance = i === tokenIndexIn ? newBalanceIn : balances[i];
            s = s.add(balance);
            c = c.mul(d).div(balance.mul(n));
        }
        
        // Newton's method to find new balance of output token
        for (let i = 0; i < 255; i++) {
            yPrev = y;
            const numerator = y.mul(y).add(c);
            const denominator = y.mul(BigNumber.from(2)).add(ann.mul(s).div(d).sub(d));
            y = numerator.div(denominator);
            
            const diff = y.gt(yPrev) ? y.sub(yPrev) : yPrev.sub(y);
            if (diff.lte(1)) break;
        }
        
        // Calculate output amount
        const dy = balances[tokenIndexOut].sub(y);
        
        // Apply output fee
        const dyFee = dy.mul(fee).div(this.FEE_DENOMINATOR);
        
        return dy.sub(dyFee);
    }

    async updateReserves(): Promise<void> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        try {
            const balances = await this.registryContract.get_balances(this.marketAddress);
            const validBalances: BigNumber[] = [];
            
            for (let i = 0; i < this.poolInfo!.nCoins; i++) {
                validBalances.push(balances[i]);
            }
            
            this._reserves = validBalances;
            this.poolInfo!.balances = validBalances;
            this.lastUpdateBlock = await this.contract.provider.getBlockNumber();
            
            logDebug("Updated Curve pool reserves");
            
        } catch (error) {
            logError("Failed to update Curve pool reserves");
            throw error;
        }
    }

    async getReserves(tokenAddress?: string): Promise<BigNumber> {
        if (!this.poolInfo || this._reserves.length === 0) {
            await this.updateReserves();
        }
        
        if (!tokenAddress) {
            // Return total liquidity
            return this._reserves.reduce((sum, reserve) => sum.add(reserve), BigNumber.from(0));
        }
        
        const tokenIndex = this.poolInfo!.coins.indexOf(tokenAddress);
        if (tokenIndex === -1) {
            throw new Error(`Token ${tokenAddress} not found in Curve pool`);
        }
        
        return this._reserves[tokenIndex];
    }

    async getReservesByToken(tokenAddress?: string): Promise<BigNumber | BigNumber[]> {
        if (!this.poolInfo || this._reserves.length === 0) {
            await this.updateReserves();
        }
        
        if (tokenAddress) {
            return this.getReserves(tokenAddress);
        }
        
        return [...this._reserves];
    }

    async getTradingFee(): Promise<BigNumber> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        // Convert Curve's fee format to basis points
        // Curve fee is in 1e10, we want basis points (1e4)
        return this.poolInfo!.fee.div(BigNumber.from("1000000"));
    }

    async getTokensOut(tokenIn: string, tokenOut: string, amountIn: BigNumber): Promise<BigNumber> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        const tokenIndexIn = this.poolInfo!.coins.indexOf(tokenIn);
        const tokenIndexOut = this.poolInfo!.coins.indexOf(tokenOut);
        
        if (tokenIndexIn === -1 || tokenIndexOut === -1) {
            throw new Error("Token not found in pool");
        }
        
        try {
            // Try to use Curve's native get_dy for most accurate calculation
            const dy = await this.contract.get_dy(
                tokenIndexIn,
                tokenIndexOut,
                amountIn
            );
            
            return dy;
        } catch (error) {
            logWarn("Failed to use get_dy, falling back to manual calculation");
            
            // Fallback to manual calculation
            return this.calculateSwapOutput(
                tokenIndexIn,
                tokenIndexOut,
                amountIn,
                this._reserves,
                this.poolInfo!.amplificationParameter,
                this.poolInfo!.fee
            );
        }
    }

    async getPriceImpact(tokenAddress: string, tradeSize: BigNumber): Promise<BigNumber> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        const tokenIndex = this.poolInfo!.coins.indexOf(tokenAddress);
        if (tokenIndex === -1) {
            throw new Error("Token not found in pool");
        }
        
        // Calculate price impact based on pool's virtual price and trade size
        const virtualPrice = await this.contract.get_virtual_price();
        const reserve = this._reserves[tokenIndex];
        
        // Simple price impact calculation: (tradeSize / reserve) * 10000 (basis points)
        if (reserve.isZero()) {
            return BigNumber.from("10000"); // 100% impact if no reserves
        }
        
        return tradeSize.mul(10000).div(reserve);
    }

    async sellTokensToNextMarket(
        tokenIn: string,
        amountIn: BigNumber,
        sellToMarket: MarketType | EthMarket
    ): Promise<BuyCalls> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        const tokenIndexIn = this.poolInfo!.coins.indexOf(tokenIn);
        const tokenIndexOut = this.poolInfo!.coins.indexOf(this.tokenAddress);
        
        if (tokenIndexIn === -1 || tokenIndexOut === -1) {
            throw new Error("Token pair not found in pool");
        }
        
        // Encode the exchange function call
        const data = this.contract.interface.encodeFunctionData('exchange', [
            tokenIndexIn,
            tokenIndexOut,
            amountIn,
            0, // min_dy will be calculated by caller
        ]);
        
        return {
            targets: [this.marketAddress],
            data: [data],
            payloads: [data],
            values: [BigNumber.from(0)]
        };
    }

    async sellTokens(tokenIn: string, amountIn: BigNumber, recipient: string): Promise<string> {
        // This would execute the actual swap transaction
        // For now, return encoded data
        const tokenIndexIn = this.poolInfo!.coins.indexOf(tokenIn);
        const tokenIndexOut = this.poolInfo!.coins.indexOf(this.tokenAddress);
        
        return this.contract.interface.encodeFunctionData('exchange', [
            tokenIndexIn,
            tokenIndexOut,
            amountIn,
            0,
        ]);
    }

    receiveDirectly(tokenAddress: string): boolean {
        // Curve pools don't typically receive tokens directly
        return false;
    }

    async getBalance(tokenAddress: string): Promise<BigNumber> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        const tokenIndex = this.poolInfo!.coins.indexOf(tokenAddress);
        if (tokenIndex === -1) {
            return BigNumber.from(0);
        }
        
        return this._reserves[tokenIndex];
    }

    async getVolatility(): Promise<BigNumber> {
        // Curve pools are designed for low volatility
        // Return a low volatility score
        return BigNumber.from(100); // Low volatility in basis points
    }

    async getLiquidity(): Promise<BigNumber> {
        if (!this.poolInfo || this._reserves.length === 0) {
            await this.updateReserves();
        }
        
        // Return total value locked (sum of all balances)
        // In production, would normalize by token prices
        return this._reserves.reduce((sum, reserve) => sum.add(reserve), BigNumber.from(0));
    }

    /**
     * Get the pool's amplification parameter (A)
     */
    async getAmplificationParameter(): Promise<BigNumber> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        return this.poolInfo!.amplificationParameter;
    }

    /**
     * Check if this is a metapool (pool of pools)
     */
    isMetaPool(): boolean {
        return this.poolInfo?.isMetaPool || false;
    }

    /**
     * Get pool information for debugging/monitoring
     */
    getPoolInfo(): CurvePoolInfo | undefined {
        return this.poolInfo;
    }

    /**
     * Manually set reserves from CoW auction data (bypasses chain fetching)
     */
    async setReservesViaOrderedBalances(balances: BigNumber[]): Promise<void> {
        if (!balances || balances.length === 0) {
            throw new Error("Invalid balances provided");
        }

        this._reserves = [...balances];

        // Update poolInfo balances if it exists
        if (this.poolInfo) {
            this.poolInfo.balances = [...balances];
        }

        logDebug(`Set Curve pool reserves: ${balances.map(b => b.toString()).join(', ')}`);
    }
}