import { BigNumber } from "@ethersproject/bignumber";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";
import { EthMarket, MarketType, BuyCalls } from "../EthMarket";
import { logInfo, logError, logDebug, logWarn } from "../utils/logger";

// Uniswap V3 Pool ABI - minimal interface
const UNISWAP_V3_POOL_ABI = [
    "function token0() external view returns (address)",
    "function token1() external view returns (address)",
    "function fee() external view returns (uint24)",
    "function tickSpacing() external view returns (int24)",
    "function liquidity() external view returns (uint128)",
    "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
    "function observe(uint32[] secondsAgos) external view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
    "function positions(bytes32 key) external view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
    "function ticks(int24 tick) external view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)",
    "function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes data) external returns (int256 amount0, int256 amount1)",
    "function flash(address recipient, uint256 amount0, uint256 amount1, bytes data) external"
];

// Uniswap V3 Quoter ABI for simulating swaps
const UNISWAP_V3_QUOTER_ABI = [
    "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
    "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut)",
    "function quoteExactOutputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountOut, uint160 sqrtPriceLimitX96) external returns (uint256 amountIn)",
    "function quoteExactOutput(bytes path, uint256 amountOut) external returns (uint256 amountIn)"
];

// Uniswap V3 Factory ABI
const UNISWAP_V3_FACTORY_ABI = [
    "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
    "function feeAmountTickSpacing(uint24 fee) external view returns (int24)"
];

interface Slot0Data {
    sqrtPriceX96: BigNumber;
    tick: number;
    observationIndex: number;
    observationCardinality: number;
    observationCardinalityNext: number;
    feeProtocol: number;
    unlocked: boolean;
}

interface TickInfo {
    liquidityGross: BigNumber;
    liquidityNet: BigNumber;
    initialized: boolean;
}

interface UniswapV3PoolInfo {
    token0: string;
    token1: string;
    fee: number; // Fee tier in hundredths of a bip (e.g., 3000 = 0.3%)
    tickSpacing: number;
    liquidity: BigNumber;
    slot0: Slot0Data;
    tickData: Map<number, TickInfo>; // Cached tick data
    volatility24h?: BigNumber; // 24-hour price volatility
    volume24h?: BigNumber; // 24-hour volume
}

export class UniswapV3Pool extends EthMarket implements MarketType {
    private contract: Contract;
    private quoterContract: Contract;
    private poolInfo?: UniswapV3PoolInfo;
    private _reserves: BigNumber[] = [];
    private provider: Provider;
    
    // Uniswap V3 constants
    private readonly Q96 = BigNumber.from(2).pow(96);
    private readonly Q128 = BigNumber.from(2).pow(128);
    private readonly Q192 = BigNumber.from(2).pow(192);
    private readonly QUOTER_ADDRESS = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6"; // Mainnet Quoter V2
    private readonly MIN_SQRT_RATIO = BigNumber.from("4295128739");
    private readonly MAX_SQRT_RATIO = BigNumber.from("1461446703485210103287273052203988822378723970342");
    
    // Price history for volatility calculation
    private priceHistory: Array<{ timestamp: number; price: BigNumber }> = [];
    private readonly PRICE_HISTORY_LENGTH = 24; // Track 24 data points
    
    constructor(
        poolAddress: string,
        token0: string,
        token1: string,
        provider: Provider,
        fee: number = 3000 // Default to 0.3% tier
    ) {
        super(poolAddress, [token0, token1], "UniswapV3", token0);
        this.contract = new Contract(poolAddress, UNISWAP_V3_POOL_ABI, provider);
        this.quoterContract = new Contract(this.QUOTER_ADDRESS, UNISWAP_V3_QUOTER_ABI, provider);
        this.provider = provider;
    }

    /**
     * Initialize pool information from contract
     */
    private async initializePoolInfo(): Promise<void> {
        try {
            const [
                token0,
                token1,
                fee,
                tickSpacing,
                liquidity,
                slot0Data
            ] = await Promise.all([
                this.contract.token0(),
                this.contract.token1(),
                this.contract.fee(),
                this.contract.tickSpacing(),
                this.contract.liquidity(),
                this.contract.slot0()
            ]);

            const slot0: Slot0Data = {
                sqrtPriceX96: slot0Data[0],
                tick: slot0Data[1],
                observationIndex: slot0Data[2],
                observationCardinality: slot0Data[3],
                observationCardinalityNext: slot0Data[4],
                feeProtocol: slot0Data[5],
                unlocked: slot0Data[6]
            };

            this.poolInfo = {
                token0,
                token1,
                fee: fee.toNumber(),
                tickSpacing: tickSpacing.toNumber(),
                liquidity,
                slot0,
                tickData: new Map()
            };

            // Calculate reserves from sqrt price and liquidity
            this._reserves = this.calculateReservesFromPrice(
                slot0.sqrtPriceX96,
                liquidity
            );
            
            // Initialize price history
            const currentPrice = this.calculatePriceFromSqrtPrice(slot0.sqrtPriceX96);
            this.priceHistory.push({
                timestamp: Date.now(),
                price: currentPrice
            });
            
            logDebug("Initialized Uniswap V3 pool", {
                token0,
                token1,
                fee: fee.toNumber(),
                liquidity: liquidity.toString(),
                tick: slot0.tick
            });
            
        } catch (error) {
            logError("Failed to initialize Uniswap V3 pool info", {
                error: error as Error
            });
            throw error;
        }
    }

    /**
     * Calculate reserves from sqrt price and liquidity
     * Concentrated liquidity means reserves are virtual and depend on current tick
     */
    private calculateReservesFromPrice(
        sqrtPriceX96: BigNumber,
        liquidity: BigNumber
    ): BigNumber[] {
        if (liquidity.isZero()) {
            return [BigNumber.from(0), BigNumber.from(0)];
        }

        // Calculate amount0 (token0 reserves)
        // amount0 = liquidity * (sqrtPriceB - sqrtPriceA) / (sqrtPriceA * sqrtPriceB)
        // Simplified for current price: amount0 ≈ liquidity / sqrtPrice
        const amount0 = liquidity.mul(this.Q96).div(sqrtPriceX96);

        // Calculate amount1 (token1 reserves)
        // amount1 = liquidity * (sqrtPriceB - sqrtPriceA)
        // Simplified for current price: amount1 ≈ liquidity * sqrtPrice
        const amount1 = liquidity.mul(sqrtPriceX96).div(this.Q96);

        return [amount0, amount1];
    }

    /**
     * Calculate price from sqrt price X96 format
     * price = (sqrtPriceX96 / 2^96)^2
     */
    private calculatePriceFromSqrtPrice(sqrtPriceX96: BigNumber): BigNumber {
        // price = (sqrtPriceX96)^2 / 2^192
        const numerator = sqrtPriceX96.mul(sqrtPriceX96);
        return numerator.div(this.Q192);
    }

    /**
     * Calculate sqrt price from normal price
     * sqrtPriceX96 = sqrt(price) * 2^96
     */
    private calculateSqrtPriceFromPrice(price: BigNumber): BigNumber {
        // This is a simplified approximation
        // In production, use proper sqrt calculation
        return this.sqrt(price.mul(this.Q192));
    }

    /**
     * Calculate output amount for a swap using V3's concentrated liquidity
     * This is more complex than V2 due to ticks and concentrated liquidity
     */
    private calculateSwapOutput(
        amountIn: BigNumber,
        zeroForOne: boolean,
        currentSqrtPrice: BigNumber,
        currentLiquidity: BigNumber,
        fee: number
    ): BigNumber {
        // Apply fee
        const amountInAfterFee = amountIn.mul(1000000 - fee).div(1000000);

        if (currentLiquidity.isZero()) {
            return BigNumber.from(0);
        }

        // Simplified calculation assuming we stay within current tick
        // Real implementation would need to handle tick crossings
        if (zeroForOne) {
            // Swapping token0 for token1
            const amountOut = amountInAfterFee.mul(currentSqrtPrice).mul(currentSqrtPrice).div(this.Q192);
            return amountOut;
        } else {
            // Swapping token1 for token0
            const amountOut = amountInAfterFee.mul(this.Q192).div(currentSqrtPrice).div(currentSqrtPrice);
            return amountOut;
        }
    }

    /**
     * Get active tick liquidity within a range
     * Critical for accurate arbitrage calculations in V3
     */
    private async getTickLiquidity(tickLower: number, tickUpper: number): Promise<BigNumber> {
        try {
            let totalLiquidity = BigNumber.from(0);
            
            // Sample key ticks in the range
            for (let tick = tickLower; tick <= tickUpper; tick += this.poolInfo!.tickSpacing) {
                if (this.poolInfo!.tickData.has(tick)) {
                    const tickInfo = this.poolInfo!.tickData.get(tick)!;
                    totalLiquidity = totalLiquidity.add(tickInfo.liquidityGross);
                } else {
                    // Fetch from chain and cache
                    const tickData = await this.contract.ticks(tick);
                    const tickInfo: TickInfo = {
                        liquidityGross: tickData.liquidityGross,
                        liquidityNet: tickData.liquidityNet,
                        initialized: tickData.initialized
                    };
                    this.poolInfo!.tickData.set(tick, tickInfo);
                    totalLiquidity = totalLiquidity.add(tickInfo.liquidityGross);
                }
            }
            
            return totalLiquidity;
        } catch (error) {
            logWarn("Failed to fetch tick liquidity, using current liquidity", {
                error: error as Error
            });
            return this.poolInfo!.liquidity;
        }
    }

    /**
     * Calculate price volatility from historical data
     * Essential for statistical arbitrage
     */
    private calculateVolatility(): BigNumber {
        if (this.priceHistory.length < 2) {
            return BigNumber.from(500); // Default 5% volatility
        }

        // Calculate returns
        const returns: BigNumber[] = [];
        for (let i = 1; i < this.priceHistory.length; i++) {
            const prevPrice = this.priceHistory[i - 1].price;
            const currentPrice = this.priceHistory[i].price;
            
            if (prevPrice.isZero()) continue;
            
            // return = (currentPrice - prevPrice) / prevPrice * 10000 (in basis points)
            const returnBps = currentPrice.sub(prevPrice).mul(10000).div(prevPrice).abs();
            returns.push(returnBps);
        }

        if (returns.length === 0) {
            return BigNumber.from(500);
        }

        // Calculate standard deviation of returns (simplified)
        const mean = returns.reduce((sum, r) => sum.add(r), BigNumber.from(0)).div(returns.length);
        const squaredDiffs = returns.map(r => {
            const diff = r.sub(mean);
            return diff.mul(diff);
        });
        const variance = squaredDiffs.reduce((sum, sd) => sum.add(sd), BigNumber.from(0)).div(returns.length);
        const volatility = this.sqrt(variance);

        return volatility;
    }

    /**
     * Update price history for volatility tracking
     */
    private updatePriceHistory(currentPrice: BigNumber): void {
        this.priceHistory.push({
            timestamp: Date.now(),
            price: currentPrice
        });

        // Keep only recent history
        if (this.priceHistory.length > this.PRICE_HISTORY_LENGTH) {
            this.priceHistory.shift();
        }
    }

    /**
     * Simple square root implementation
     */
    private sqrt(value: BigNumber): BigNumber {
        if (value.isZero()) return value;
        
        let z = value.add(BigNumber.from(1)).div(2);
        let y = value;
        
        for (let i = 0; i < 100; i++) {
            if (z.gte(y)) break;
            y = z;
            z = value.div(z).add(z).div(2);
        }
        
        return y;
    }

    async updateReserves(): Promise<void> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
            return;
        }
        
        try {
            const [liquidity, slot0Data] = await Promise.all([
                this.contract.liquidity(),
                this.contract.slot0()
            ]);

            this.poolInfo.liquidity = liquidity;
            this.poolInfo.slot0 = {
                sqrtPriceX96: slot0Data[0],
                tick: slot0Data[1],
                observationIndex: slot0Data[2],
                observationCardinality: slot0Data[3],
                observationCardinalityNext: slot0Data[4],
                feeProtocol: slot0Data[5],
                unlocked: slot0Data[6]
            };

            this._reserves = this.calculateReservesFromPrice(
                this.poolInfo.slot0.sqrtPriceX96,
                liquidity
            );

            // Update price history
            const currentPrice = this.calculatePriceFromSqrtPrice(this.poolInfo.slot0.sqrtPriceX96);
            this.updatePriceHistory(currentPrice);
            
            // Recalculate volatility
            this.poolInfo.volatility24h = this.calculateVolatility();
            
            logDebug("Updated Uniswap V3 pool reserves", {
                liquidity: liquidity.toString(),
                tick: this.poolInfo.slot0.tick,
                volatility: this.poolInfo.volatility24h?.toString()
            });
            
        } catch (error) {
            logError("Failed to update Uniswap V3 pool reserves", {
                error: error as Error
            });
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
        
        const tokenIndex = this.tokens.indexOf(tokenAddress);
        if (tokenIndex === -1) {
            throw new Error(`Token ${tokenAddress} not found in Uniswap V3 pool`);
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
        
        // Convert from fee tier (e.g., 3000 = 0.3%) to basis points
        // fee tier is in hundredths of a bip, so divide by 100 to get basis points
        return BigNumber.from(this.poolInfo!.fee).div(100);
    }

    async getTokensOut(tokenIn: string, tokenOut: string, amountIn: BigNumber): Promise<BigNumber> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        try {
            // Use Quoter for accurate simulation
            const amountOut = await this.quoterContract.callStatic.quoteExactInputSingle(
                tokenIn,
                tokenOut,
                this.poolInfo!.fee,
                amountIn,
                0 // No price limit
            );
            
            return amountOut;
        } catch (error) {
            logWarn("Failed to use Quoter, falling back to calculation", {
                error: error as Error
            });
            
            // Fallback to manual calculation
            const zeroForOne = tokenIn === this.poolInfo!.token0;
            return this.calculateSwapOutput(
                amountIn,
                zeroForOne,
                this.poolInfo!.slot0.sqrtPriceX96,
                this.poolInfo!.liquidity,
                this.poolInfo!.fee
            );
        }
    }

    async getPriceImpact(tokenAddress: string, tradeSize: BigNumber): Promise<BigNumber> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        // V3 price impact depends on liquidity depth at current tick
        const tokenIndex = this.tokens.indexOf(tokenAddress);
        if (tokenIndex === -1) {
            throw new Error("Token not found in pool");
        }
        
        const reserve = this._reserves[tokenIndex];
        
        if (reserve.isZero() || this.poolInfo!.liquidity.isZero()) {
            return BigNumber.from("10000"); // 100% impact
        }
        
        // Calculate impact based on concentrated liquidity
        // V3 has less liquidity spread across price range, so impact can be higher
        const baseImpact = tradeSize.mul(10000).div(reserve);
        
        // Adjust for liquidity concentration
        // If liquidity is concentrated, impact is lower within range
        const concentrationFactor = BigNumber.from(15000); // 1.5x multiplier for V3 concentration
        const adjustedImpact = baseImpact.mul(concentrationFactor).div(10000);
        
        return adjustedImpact.gt(10000) ? BigNumber.from(10000) : adjustedImpact;
    }

    async sellTokensToNextMarket(
        tokenIn: string,
        amountIn: BigNumber,
        sellToMarket: MarketType | EthMarket
    ): Promise<BuyCalls> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        const zeroForOne = tokenIn === this.poolInfo!.token0;
        
        // Calculate amount out
        const amountOut = await this.getTokensOut(
            tokenIn,
            zeroForOne ? this.poolInfo!.token1 : this.poolInfo!.token0,
            amountIn
        );
        
        // Use sqrt price limits for safety
        const sqrtPriceLimitX96 = zeroForOne ? this.MIN_SQRT_RATIO.add(1) : this.MAX_SQRT_RATIO.sub(1);
        
        // Encode swap call
        const data = this.contract.interface.encodeFunctionData('swap', [
            sellToMarket.marketAddress,
            zeroForOne,
            amountIn,
            sqrtPriceLimitX96,
            "0x" // No callback data
        ]);
        
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
        
        const zeroForOne = tokenIn === this.poolInfo!.token0;
        const sqrtPriceLimitX96 = zeroForOne ? this.MIN_SQRT_RATIO.add(1) : this.MAX_SQRT_RATIO.sub(1);
        
        return this.contract.interface.encodeFunctionData('swap', [
            recipient,
            zeroForOne,
            amountIn,
            sqrtPriceLimitX96,
            "0x"
        ]);
    }

    receiveDirectly(tokenAddress: string): boolean {
        // Uniswap V3 does not receive tokens directly in the same way as V2
        return false;
    }

    async getBalance(tokenAddress: string): Promise<BigNumber> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        const tokenIndex = this.tokens.indexOf(tokenAddress);
        if (tokenIndex === -1) {
            return BigNumber.from(0);
        }
        
        return this._reserves[tokenIndex];
    }

    async getVolatility(): Promise<BigNumber> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        // Return calculated volatility if available
        if (this.poolInfo!.volatility24h) {
            return this.poolInfo!.volatility24h;
        }
        
        return this.calculateVolatility();
    }

    async getLiquidity(): Promise<BigNumber> {
        if (!this.poolInfo || this._reserves.length === 0) {
            await this.updateReserves();
        }
        
        // V3 liquidity is the L value, not total value locked
        // For compatibility, return sum of virtual reserves
        return this._reserves[0].add(this._reserves[1]);
    }

    /**
     * Get current tick
     */
    getCurrentTick(): number | undefined {
        return this.poolInfo?.slot0.tick;
    }

    /**
     * Get sqrt price
     */
    getSqrtPrice(): BigNumber | undefined {
        return this.poolInfo?.slot0.sqrtPriceX96;
    }

    /**
     * Get current price (token1/token0)
     */
    getCurrentPrice(): BigNumber | undefined {
        if (!this.poolInfo) return undefined;
        return this.calculatePriceFromSqrtPrice(this.poolInfo.slot0.sqrtPriceX96);
    }

    /**
     * Get fee tier
     */
    getFeeTier(): number | undefined {
        return this.poolInfo?.fee;
    }

    /**
     * Get active liquidity at current tick
     */
    getActiveLiquidity(): BigNumber | undefined {
        return this.poolInfo?.liquidity;
    }

    /**
     * Check if this is a concentrated liquidity opportunity
     * Returns true if liquidity is heavily concentrated
     */
    isConcentratedLiquidity(): boolean {
        if (!this.poolInfo) return false;
        
        // Check if most liquidity is within a narrow tick range
        // This indicates concentrated liquidity and higher LVR opportunities
        return this.poolInfo.liquidity.gt(BigNumber.from(10).pow(18)); // High liquidity threshold
    }

    /**
     * Get price history for statistical analysis
     */
    getPriceHistory(): Array<{ timestamp: number; price: BigNumber }> {
        return [...this.priceHistory];
    }

    /**
     * Predict next price movement based on volatility and trend
     * Used for statistical arbitrage
     */
    predictPriceMovement(): { direction: 'up' | 'down' | 'neutral'; confidence: number } {
        if (this.priceHistory.length < 3) {
            return { direction: 'neutral', confidence: 0 };
        }

        // Simple trend analysis
        const recent = this.priceHistory.slice(-3);
        const trend = recent[2].price.sub(recent[0].price);
        
        if (trend.gt(0)) {
            const momentum = recent[2].price.sub(recent[1].price);
            const confidence = momentum.gt(0) ? 70 : 40;
            return { direction: 'up', confidence };
        } else if (trend.lt(0)) {
            const momentum = recent[1].price.sub(recent[2].price);
            const confidence = momentum.gt(0) ? 70 : 40;
            return { direction: 'down', confidence };
        }
        
        return { direction: 'neutral', confidence: 0 };
    }

    /**
     * Manually set reserves from external data
     */
    async setReservesViaOrderedBalances(balances: BigNumber[]): Promise<void> {
        if (!balances || balances.length !== 2) {
            throw new Error("Uniswap V3 requires exactly 2 balances");
        }

        this._reserves = [...balances];

        logDebug(`Set Uniswap V3 pool reserves: ${balances.map(b => b.toString()).join(', ')}`);
    }
}

