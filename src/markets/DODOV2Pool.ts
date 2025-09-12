import { BigNumber } from "@ethersproject/bignumber";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";
import { EthMarket, MarketType, BuyCalls } from "../EthMarket.js";
import { logInfo, logError, logDebug, logWarn } from "../utils/logger.js";

// DODO V2 Pool ABI - Proactive Market Maker (PMM) interface
const DODO_V2_POOL_ABI = [
    "function querySellBase(address trader, uint256 payBaseAmount) view returns (uint256 receiveQuoteAmount, uint256 mtFee)",
    "function querySellQuote(address trader, uint256 payQuoteAmount) view returns (uint256 receiveBaseAmount, uint256 mtFee)",
    "function sellBase(address to) returns (uint256 receiveQuoteAmount)",
    "function sellQuote(address to) returns (uint256 receiveBaseAmount)",
    "function flashLoan(uint256 baseAmount, uint256 quoteAmount, address assetTo, bytes data)",
    "function getExpectedTarget() view returns (uint256 baseTarget, uint256 quoteTarget)",
    "function getReserves() view returns (uint256 baseReserve, uint256 quoteReserve)",
    "function getUserFeeRate(address user) view returns (uint256 lpFeeRate, uint256 mtFeeRate)",
    "function getBaseInput() view returns (uint256 baseInput)",
    "function getQuoteInput() view returns (uint256 quoteInput)",
    "_BASE_TOKEN_() view returns (address)",
    "_QUOTE_TOKEN_() view returns (address)",
    "_BASE_RESERVE_() view returns (uint256)",
    "_QUOTE_RESERVE_() view returns (uint256)",
    "_BASE_TARGET_() view returns (uint256)",
    "_QUOTE_TARGET_() view returns (uint256)",
    "_RState_() view returns (uint256)",
    "_K_() view returns (uint256)",
    "_I_() view returns (uint256)",
    "_LP_FEE_RATE_() view returns (uint256)",
    "_MT_FEE_RATE_() view returns (uint256)"
];

// DODO Registry/Factory ABI
const DODO_REGISTRY_ABI = [
    "function getDODOPool(address baseToken, address quoteToken) view returns (address[] pools)",
    "function getDODOPoolBidirection(address token0, address token1) view returns (address[] baseToken0Pool, address[] baseToken1Pool)",
    "function getDODOPoolByFactory(address factoryAddress, address baseToken, address quoteToken) view returns (address[] pools)"
];

// R-states for DODO PMM
enum RState {
    ONE = 0,    // Quote token shortage (more base token)
    ABOVE_ONE = 1,  // Balanced
    BELOW_ONE = 2   // Base token shortage (more quote token)
}

interface DODOPoolInfo {
    baseToken: string;
    quoteToken: string;
    baseReserve: BigNumber;
    quoteReserve: BigNumber;
    baseTarget: BigNumber;
    quoteTarget: BigNumber;
    rState: RState;
    i: BigNumber;  // Oracle price
    k: BigNumber;  // Price curve parameter
    lpFeeRate: BigNumber;
    mtFeeRate: BigNumber;
}

export class DODOV2Pool extends EthMarket implements MarketType {
    private contract: Contract;
    private poolInfo?: DODOPoolInfo;
    private _reserves: BigNumber[] = [];
    private provider: Provider;
    
    // DODO constants
    private readonly ONE = BigNumber.from("1000000000000000000"); // 1e18
    private readonly FEE_BASE = BigNumber.from("1000000000000000000"); // 1e18
    
    constructor(
        poolAddress: string,
        baseToken: string,
        quoteToken: string,
        provider: Provider
    ) {
        super(poolAddress, [baseToken, quoteToken], "DODOV2", baseToken);
        this.contract = new Contract(poolAddress, DODO_V2_POOL_ABI, provider);
        this.provider = provider;
    }

    /**
     * Initialize pool information from contract
     */
    private async initializePoolInfo(): Promise<void> {
        try {
            // Fetch all pool parameters in parallel
            const [
                baseToken,
                quoteToken,
                baseReserve,
                quoteReserve,
                [baseTarget, quoteTarget],
                rState,
                k,
                i,
                lpFeeRate,
                mtFeeRate
            ] = await Promise.all([
                this.contract._BASE_TOKEN_(),
                this.contract._QUOTE_TOKEN_(),
                this.contract._BASE_RESERVE_(),
                this.contract._QUOTE_RESERVE_(),
                this.contract.getExpectedTarget(),
                this.contract._RState_(),
                this.contract._K_(),
                this.contract._I_(),
                this.contract._LP_FEE_RATE_(),
                this.contract._MT_FEE_RATE_()
            ]);

            this.poolInfo = {
                baseToken,
                quoteToken,
                baseReserve,
                quoteReserve,
                baseTarget,
                quoteTarget,
                rState: rState as RState,
                i,
                k,
                lpFeeRate,
                mtFeeRate
            };

            this._reserves = [baseReserve, quoteReserve];
            // tokens is already set in constructor
            
            logDebug("Initialized DODO V2 pool");
            
        } catch (error) {
            logError("Failed to initialize DODO pool info");
            throw error;
        }
    }

    /**
     * PMM pricing formula - calculate output for selling base token
     * This implements DODO's Proactive Market Maker algorithm
     */
    private calculatePMMSellBase(
        amount: BigNumber,
        baseReserve: BigNumber,
        quoteReserve: BigNumber,
        baseTarget: BigNumber,
        quoteTarget: BigNumber,
        i: BigNumber,
        k: BigNumber,
        rState: RState
    ): BigNumber {
        // If no k value (no price discovery), use constant product
        if (k.isZero()) {
            return this.constantProductFormula(amount, baseReserve, quoteReserve);
        }

        // Calculate based on R state
        if (rState === RState.ONE) {
            // Quote token shortage - selling base is favorable
            return this.calculateSellBaseInROne(
                amount,
                baseReserve,
                quoteTarget,
                i,
                k
            );
        } else if (rState === RState.ABOVE_ONE) {
            // Balanced state
            const receiveQuote = this.calculateSellBaseInRAboveOne(
                amount,
                baseReserve,
                baseTarget,
                quoteReserve,
                quoteTarget,
                i,
                k
            );
            return receiveQuote;
        } else {
            // Base token shortage - selling base is less favorable
            return this.calculateSellBaseInRBelowOne(
                amount,
                quoteReserve,
                quoteTarget,
                i,
                k
            );
        }
    }

    /**
     * Calculate sell base when R = 1 (quote shortage)
     */
    private calculateSellBaseInROne(
        amount: BigNumber,
        baseReserve: BigNumber,
        quoteTarget: BigNumber,
        i: BigNumber,
        k: BigNumber
    ): BigNumber {
        // Price impact factor
        const baseReserveAfter = baseReserve.add(amount);
        const penalty = this.calculatePricePenalty(baseReserve, baseReserveAfter, k);
        
        // Adjusted price with penalty
        const adjustedPrice = i.mul(this.ONE.sub(penalty)).div(this.ONE);
        
        // Output amount
        return amount.mul(adjustedPrice).div(this.ONE);
    }

    /**
     * Calculate sell base when R > 1 (balanced)
     */
    private calculateSellBaseInRAboveOne(
        amount: BigNumber,
        baseReserve: BigNumber,
        baseTarget: BigNumber,
        quoteReserve: BigNumber,
        quoteTarget: BigNumber,
        i: BigNumber,
        k: BigNumber
    ): BigNumber {
        // Check if selling will change R state
        const baseReserveAfter = baseReserve.add(amount);
        
        if (baseReserveAfter.lte(baseTarget)) {
            // Still in R > 1 state
            const penalty = this.calculatePricePenalty(baseReserve, baseReserveAfter, k);
            const adjustedPrice = i.mul(this.ONE.sub(penalty)).div(this.ONE);
            return amount.mul(adjustedPrice).div(this.ONE);
        } else {
            // Will transition to R = 1
            const amount1 = baseTarget.sub(baseReserve);
            const amount2 = baseReserveAfter.sub(baseTarget);
            
            const quote1 = amount1.mul(i).div(this.ONE);
            const quote2 = this.calculateSellBaseInROne(amount2, baseTarget, quoteTarget, i, k);
            
            return quote1.add(quote2);
        }
    }

    /**
     * Calculate sell base when R < 1 (base shortage)
     */
    private calculateSellBaseInRBelowOne(
        amount: BigNumber,
        quoteReserve: BigNumber,
        quoteTarget: BigNumber,
        i: BigNumber,
        k: BigNumber
    ): BigNumber {
        // When base is in shortage, price is higher
        const premium = this.calculatePricePremium(quoteReserve, quoteTarget, k);
        const adjustedPrice = i.mul(this.ONE.add(premium)).div(this.ONE);
        
        return amount.mul(adjustedPrice).div(this.ONE);
    }

    /**
     * Calculate price penalty for excess reserves
     */
    private calculatePricePenalty(
        reserveBefore: BigNumber,
        reserveAfter: BigNumber,
        k: BigNumber
    ): BigNumber {
        // Simplified penalty calculation
        // Real DODO uses more complex integration
        const avgReserve = reserveBefore.add(reserveAfter).div(2);
        const deltaReserve = reserveAfter.sub(reserveBefore);
        
        return k.mul(deltaReserve).div(avgReserve.mul(2));
    }

    /**
     * Calculate price premium for shortage
     */
    private calculatePricePremium(
        reserve: BigNumber,
        target: BigNumber,
        k: BigNumber
    ): BigNumber {
        if (reserve.gte(target)) return BigNumber.from(0);
        
        const shortage = target.sub(reserve);
        return k.mul(shortage).div(target.mul(2));
    }

    /**
     * Fallback constant product formula
     */
    private constantProductFormula(
        amountIn: BigNumber,
        reserveIn: BigNumber,
        reserveOut: BigNumber
    ): BigNumber {
        const numerator = amountIn.mul(reserveOut);
        const denominator = reserveIn.add(amountIn);
        return numerator.div(denominator);
    }

    async updateReserves(): Promise<void> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        try {
            const [
                baseReserve,
                quoteReserve,
                [baseTarget, quoteTarget],
                rState
            ] = await Promise.all([
                this.contract._BASE_RESERVE_(),
                this.contract._QUOTE_RESERVE_(),
                this.contract.getExpectedTarget(),
                this.contract._RState_()
            ]);
            
            this.poolInfo!.baseReserve = baseReserve;
            this.poolInfo!.quoteReserve = quoteReserve;
            this.poolInfo!.baseTarget = baseTarget;
            this.poolInfo!.quoteTarget = quoteTarget;
            this.poolInfo!.rState = rState as RState;
            
            this._reserves = [baseReserve, quoteReserve];
            
            logDebug("Updated DODO pool reserves");
            
        } catch (error) {
            logError("Failed to update DODO pool reserves");
            throw error;
        }
    }

    async getReserves(tokenAddress?: string): Promise<BigNumber> {
        if (!this.poolInfo || this._reserves.length === 0) {
            await this.updateReserves();
        }
        
        if (!tokenAddress) {
            return this._reserves[0].add(this._reserves[1]);
        }
        
        if (tokenAddress === this.poolInfo!.baseToken) {
            return this._reserves[0];
        } else if (tokenAddress === this.poolInfo!.quoteToken) {
            return this._reserves[1];
        }
        
        throw new Error(`Token ${tokenAddress} not found in DODO pool`);
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
        
        // Convert DODO's fee format to basis points
        // DODO fees are in 1e18, convert to basis points (1e4)
        const totalFee = this.poolInfo!.lpFeeRate.add(this.poolInfo!.mtFeeRate);
        return totalFee.mul(10000).div(this.FEE_BASE);
    }

    async getTokensOut(tokenIn: string, tokenOut: string, amountIn: BigNumber): Promise<BigNumber> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        try {
            // Use DODO's query functions for accurate output
            if (tokenIn === this.poolInfo!.baseToken && tokenOut === this.poolInfo!.quoteToken) {
                // Selling base for quote
                const [receiveQuoteAmount] = await this.contract.querySellBase(
                    this.marketAddress,
                    amountIn
                );
                return receiveQuoteAmount;
            } else if (tokenIn === this.poolInfo!.quoteToken && tokenOut === this.poolInfo!.baseToken) {
                // Selling quote for base
                const [receiveBaseAmount] = await this.contract.querySellQuote(
                    this.marketAddress,
                    amountIn
                );
                return receiveBaseAmount;
            } else {
                throw new Error("Invalid token pair for DODO pool");
            }
        } catch (error) {
            logWarn("Failed to use query functions, falling back to PMM calculation");
            
            // Fallback to manual PMM calculation
            if (tokenIn === this.poolInfo!.baseToken) {
                const output = this.calculatePMMSellBase(
                    amountIn,
                    this.poolInfo!.baseReserve,
                    this.poolInfo!.quoteReserve,
                    this.poolInfo!.baseTarget,
                    this.poolInfo!.quoteTarget,
                    this.poolInfo!.i,
                    this.poolInfo!.k,
                    this.poolInfo!.rState
                );
                
                // Apply fees
                const feeMultiplier = this.ONE.sub(this.poolInfo!.lpFeeRate.add(this.poolInfo!.mtFeeRate));
                return output.mul(feeMultiplier).div(this.ONE);
            } else {
                // For quote to base, use inverse calculation (simplified)
                const priceRatio = this.poolInfo!.quoteReserve.mul(this.ONE).div(this.poolInfo!.baseReserve);
                return amountIn.mul(this.ONE).div(priceRatio);
            }
        }
    }

    async getPriceImpact(tokenAddress: string, tradeSize: BigNumber): Promise<BigNumber> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        // Calculate price impact based on k parameter and trade size
        const reserve = tokenAddress === this.poolInfo!.baseToken 
            ? this.poolInfo!.baseReserve 
            : this.poolInfo!.quoteReserve;
        
        if (reserve.isZero()) {
            return BigNumber.from("10000"); // 100% impact
        }
        
        // Price impact = k * (tradeSize / reserve)
        // Convert to basis points
        const impact = this.poolInfo!.k.mul(tradeSize).mul(10000).div(reserve.mul(this.ONE));
        
        return impact;
    }

    async sellTokensToNextMarket(
        tokenIn: string,
        amountIn: BigNumber,
        sellToMarket: MarketType | EthMarket
    ): Promise<BuyCalls> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        let data: string;
        
        if (tokenIn === this.poolInfo!.baseToken) {
            // Selling base token
            data = this.contract.interface.encodeFunctionData('sellBase', [
                sellToMarket.marketAddress
            ]);
        } else if (tokenIn === this.poolInfo!.quoteToken) {
            // Selling quote token
            data = this.contract.interface.encodeFunctionData('sellQuote', [
                sellToMarket.marketAddress
            ]);
        } else {
            throw new Error("Token not found in DODO pool");
        }
        
        return {
            targets: [this.marketAddress],
            data: [data],
            payloads: [data],
            values: [BigNumber.from(0)]
        };
    }

    async sellTokens(tokenIn: string, amountIn: BigNumber, recipient: string): Promise<string> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        if (tokenIn === this.poolInfo!.baseToken) {
            return this.contract.interface.encodeFunctionData('sellBase', [recipient]);
        } else if (tokenIn === this.poolInfo!.quoteToken) {
            return this.contract.interface.encodeFunctionData('sellQuote', [recipient]);
        }
        
        throw new Error("Token not found in DODO pool");
    }

    receiveDirectly(tokenAddress: string): boolean {
        // DODO pools can receive tokens directly for swaps
        return this.tokens.includes(tokenAddress);
    }

    async getBalance(tokenAddress: string): Promise<BigNumber> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        if (tokenAddress === this.poolInfo!.baseToken) {
            return this._reserves[0];
        } else if (tokenAddress === this.poolInfo!.quoteToken) {
            return this._reserves[1];
        }
        
        return BigNumber.from(0);
    }

    async getVolatility(): Promise<BigNumber> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        // Volatility based on k parameter (price curve steepness)
        // Higher k = higher volatility
        if (this.poolInfo!.k.isZero()) {
            return BigNumber.from(100); // Low volatility for constant product
        }
        
        // Convert k to basis points representation of volatility
        const volatility = this.poolInfo!.k.mul(10000).div(this.ONE);
        return volatility.gt(10000) ? BigNumber.from(10000) : volatility;
    }

    async getLiquidity(): Promise<BigNumber> {
        if (!this.poolInfo || this._reserves.length === 0) {
            await this.updateReserves();
        }
        
        return this._reserves[0].add(this._reserves[1]);
    }

    /**
     * Get the current R state of the pool
     */
    getRState(): RState | undefined {
        return this.poolInfo?.rState;
    }

    /**
     * Get the oracle price (i parameter)
     */
    getOraclePrice(): BigNumber | undefined {
        return this.poolInfo?.i;
    }

    /**
     * Get the price curve parameter (k)
     */
    getPriceCurveK(): BigNumber | undefined {
        return this.poolInfo?.k;
    }

    /**
     * Check if pool is using PMM or constant product
     */
    isPMM(): boolean {
        return this.poolInfo ? !this.poolInfo.k.isZero() : false;
    }
}