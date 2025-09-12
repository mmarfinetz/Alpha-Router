import { BigNumber } from "@ethersproject/bignumber";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";
import { EthMarket, MarketType, BuyCalls } from "../EthMarket.js";
import { logInfo, logError, logDebug, logWarn } from "../utils/logger.js";

// Kyber DMM Pool ABI - Dynamic Market Maker interface
const KYBER_DMM_POOL_ABI = [
    "function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)",
    "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function getTradeInfo() view returns (uint112 reserve0, uint112 reserve1, uint112 vReserve0, uint112 vReserve1, uint256 feeInPrecision)",
    "function token0() view returns (address)",
    "function token1() view returns (address)",
    "function ampBps() view returns (uint32)",
    "function factory() view returns (address)",
    "function kLast() view returns (uint256)",
    "function sync()",
    "function skim(address to)",
    "function mint(address to) returns (uint256 liquidity)",
    "function burn(address to) returns (uint256 amount0, uint256 amount1)",
    "function swapFeeUnits() view returns (uint256)",
    "function domainSeparator() view returns (bytes32)"
];

// Kyber Factory ABI
const KYBER_FACTORY_ABI = [
    "function allPools(uint256) view returns (address)",
    "function allPoolsLength() view returns (uint256)",
    "function getPools(address token0, address token1) view returns (address[] pools)",
    "function getUnamplifiedPool(address token0, address token1) view returns (address)",
    "function isPool(address token0, address token1, address pool) view returns (bool)",
    "function feeToSetter() view returns (address)",
    "function getFeeConfiguration() view returns (address feeTo, uint16 governmentFeeUnits)"
];

interface KyberPoolInfo {
    token0: string;
    token1: string;
    reserve0: BigNumber;
    reserve1: BigNumber;
    vReserve0: BigNumber;  // Virtual reserves for amplified liquidity
    vReserve1: BigNumber;
    ampBps: number;  // Amplification in basis points
    feeInPrecision: BigNumber;
    swapFeeUnits: BigNumber;
}

export class KyberDMMPool extends EthMarket implements MarketType {
    private contract: Contract;
    private poolInfo?: KyberPoolInfo;
    private _reserves: BigNumber[] = [];
    private provider: Provider;
    
    // Kyber DMM constants
    private readonly PRECISION = BigNumber.from("1000000000000000000"); // 1e18
    private readonly BPS = BigNumber.from("10000"); // Basis points
    private readonly FEE_UNITS_BASE = BigNumber.from("100000"); // 1e5
    
    constructor(
        poolAddress: string,
        tokens: string[],
        provider: Provider
    ) {
        super(poolAddress, tokens, "KyberDMM", tokens[0]);
        this.contract = new Contract(poolAddress, KYBER_DMM_POOL_ABI, provider);
        this.provider = provider;
    }

    /**
     * Initialize pool information from contract
     */
    private async initializePoolInfo(): Promise<void> {
        try {
            // Fetch pool data
            const [
                token0,
                token1,
                tradeInfo,
                ampBps,
                swapFeeUnits
            ] = await Promise.all([
                this.contract.token0(),
                this.contract.token1(),
                this.contract.getTradeInfo(),
                this.contract.ampBps(),
                this.contract.swapFeeUnits()
            ]);

            this.poolInfo = {
                token0,
                token1,
                reserve0: tradeInfo.reserve0,
                reserve1: tradeInfo.reserve1,
                vReserve0: tradeInfo.vReserve0,
                vReserve1: tradeInfo.vReserve1,
                ampBps: ampBps.toNumber(),
                feeInPrecision: tradeInfo.feeInPrecision,
                swapFeeUnits
            };

            this._reserves = [tradeInfo.reserve0, tradeInfo.reserve1];
            // tokens is already set in constructor
            
            logDebug("Initialized Kyber DMM pool");
            
        } catch (error) {
            logError("Failed to initialize Kyber DMM pool info");
            throw error;
        }
    }

    /**
     * Calculate output amount using Kyber's amplified AMM formula
     * Kyber DMM uses virtual reserves to provide concentrated liquidity
     */
    private calculateAmplifiedOutput(
        amountIn: BigNumber,
        reserveIn: BigNumber,
        reserveOut: BigNumber,
        vReserveIn: BigNumber,
        vReserveOut: BigNumber,
        fee: BigNumber
    ): BigNumber {
        // Apply fee to input
        const amountInWithFee = amountIn.mul(this.FEE_UNITS_BASE.sub(fee)).div(this.FEE_UNITS_BASE);
        
        // Use virtual reserves for calculation (amplified liquidity)
        // This provides better prices within the amplified range
        const numerator = amountInWithFee.mul(vReserveOut);
        const denominator = vReserveIn.add(amountInWithFee);
        const amountOut = numerator.div(denominator);
        
        // Check if output exceeds actual reserves
        if (amountOut.gt(reserveOut)) {
            // Fall back to actual reserves if virtual calculation exceeds limits
            return this.calculateStandardOutput(amountInWithFee, reserveIn, reserveOut);
        }
        
        return amountOut;
    }

    /**
     * Standard constant product formula fallback
     */
    private calculateStandardOutput(
        amountInWithFee: BigNumber,
        reserveIn: BigNumber,
        reserveOut: BigNumber
    ): BigNumber {
        const numerator = amountInWithFee.mul(reserveOut);
        const denominator = reserveIn.add(amountInWithFee);
        return numerator.div(denominator);
    }

    /**
     * Calculate the amplification factor's effect on liquidity
     */
    private getEffectiveReserves(): [BigNumber, BigNumber] {
        if (!this.poolInfo) {
            return [BigNumber.from(0), BigNumber.from(0)];
        }
        
        // Virtual reserves represent the effective liquidity
        // They are larger than actual reserves due to amplification
        return [this.poolInfo.vReserve0, this.poolInfo.vReserve1];
    }

    async updateReserves(): Promise<void> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        try {
            const tradeInfo = await this.contract.getTradeInfo();
            
            this.poolInfo!.reserve0 = tradeInfo.reserve0;
            this.poolInfo!.reserve1 = tradeInfo.reserve1;
            this.poolInfo!.vReserve0 = tradeInfo.vReserve0;
            this.poolInfo!.vReserve1 = tradeInfo.vReserve1;
            this.poolInfo!.feeInPrecision = tradeInfo.feeInPrecision;
            
            this._reserves = [tradeInfo.reserve0, tradeInfo.reserve1];
            
            logDebug("Updated Kyber DMM pool reserves");
            
        } catch (error) {
            logError("Failed to update Kyber DMM pool reserves");
            throw error;
        }
    }

    async getReserves(tokenAddress?: string): Promise<BigNumber> {
        if (!this.poolInfo || this._reserves.length === 0) {
            await this.updateReserves();
        }
        
        if (!tokenAddress) {
            // Return total actual liquidity
            return this._reserves[0].add(this._reserves[1]);
        }
        
        const tokenIndex = this.tokens.indexOf(tokenAddress);
        if (tokenIndex === -1) {
            throw new Error(`Token ${tokenAddress} not found in Kyber DMM pool`);
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
        
        // Convert Kyber's fee format to basis points
        // swapFeeUnits is in 1e5, convert to basis points (1e4)
        return this.poolInfo!.swapFeeUnits.mul(10000).div(this.FEE_UNITS_BASE);
    }

    async getTokensOut(tokenIn: string, tokenOut: string, amountIn: BigNumber): Promise<BigNumber> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        const tokenInIndex = this.tokens.indexOf(tokenIn);
        const tokenOutIndex = this.tokens.indexOf(tokenOut);
        
        if (tokenInIndex === -1 || tokenOutIndex === -1) {
            throw new Error("Token not found in pool");
        }
        
        const reserveIn = tokenInIndex === 0 ? this.poolInfo!.reserve0 : this.poolInfo!.reserve1;
        const reserveOut = tokenOutIndex === 0 ? this.poolInfo!.reserve0 : this.poolInfo!.reserve1;
        const vReserveIn = tokenInIndex === 0 ? this.poolInfo!.vReserve0 : this.poolInfo!.vReserve1;
        const vReserveOut = tokenOutIndex === 0 ? this.poolInfo!.vReserve0 : this.poolInfo!.vReserve1;
        
        return this.calculateAmplifiedOutput(
            amountIn,
            reserveIn,
            reserveOut,
            vReserveIn,
            vReserveOut,
            this.poolInfo!.swapFeeUnits
        );
    }

    async getPriceImpact(tokenAddress: string, tradeSize: BigNumber): Promise<BigNumber> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        const tokenIndex = this.tokens.indexOf(tokenAddress);
        if (tokenIndex === -1) {
            throw new Error("Token not found in pool");
        }
        
        // Use virtual reserves for impact calculation (more accurate for amplified pools)
        const vReserve = tokenIndex === 0 ? this.poolInfo!.vReserve0 : this.poolInfo!.vReserve1;
        
        if (vReserve.isZero()) {
            return BigNumber.from("10000"); // 100% impact
        }
        
        // Price impact considering amplification
        const baseImpact = tradeSize.mul(10000).div(vReserve);
        
        // Adjust for amplification effect (lower impact within amplified range)
        const ampAdjustment = BigNumber.from(this.poolInfo!.ampBps);
        const adjustedImpact = baseImpact.mul(10000).div(ampAdjustment);
        
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
        
        const tokenInIndex = this.tokens.indexOf(tokenIn);
        const tokenOutIndex = tokenInIndex === 0 ? 1 : 0;
        
        if (tokenInIndex === -1) {
            throw new Error("Token not found in pool");
        }
        
        // Calculate expected output
        const expectedOut = await this.getTokensOut(
            tokenIn,
            this.tokens[tokenOutIndex],
            amountIn
        );
        
        // Encode swap function call
        const amount0Out = tokenOutIndex === 0 ? expectedOut : BigNumber.from(0);
        const amount1Out = tokenOutIndex === 1 ? expectedOut : BigNumber.from(0);
        
        const data = this.contract.interface.encodeFunctionData('swap', [
            amount0Out,
            amount1Out,
            sellToMarket.marketAddress,
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
        const tokenInIndex = this.tokens.indexOf(tokenIn);
        const tokenOutIndex = tokenInIndex === 0 ? 1 : 0;
        
        const expectedOut = await this.getTokensOut(
            tokenIn,
            this.tokens[tokenOutIndex],
            amountIn
        );
        
        const amount0Out = tokenOutIndex === 0 ? expectedOut : BigNumber.from(0);
        const amount1Out = tokenOutIndex === 1 ? expectedOut : BigNumber.from(0);
        
        return this.contract.interface.encodeFunctionData('swap', [
            amount0Out,
            amount1Out,
            recipient,
            "0x"
        ]);
    }

    receiveDirectly(tokenAddress: string): boolean {
        // Kyber DMM pools receive tokens directly like Uniswap V2
        return this.tokens.includes(tokenAddress);
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
        
        // Lower volatility for amplified pools (concentrated liquidity reduces slippage)
        // Inversely proportional to amplification
        const baseVolatility = BigNumber.from(1000); // Base 10% volatility
        const ampFactor = BigNumber.from(this.poolInfo!.ampBps);
        
        if (ampFactor.gt(10000)) {
            // High amplification = low volatility
            return baseVolatility.mul(10000).div(ampFactor);
        }
        
        return baseVolatility;
    }

    async getLiquidity(): Promise<BigNumber> {
        if (!this.poolInfo || this._reserves.length === 0) {
            await this.updateReserves();
        }
        
        // Return actual liquidity (not virtual)
        return this._reserves[0].add(this._reserves[1]);
    }

    /**
     * Get virtual reserves (amplified liquidity)
     */
    getVirtualReserves(): [BigNumber, BigNumber] | undefined {
        if (!this.poolInfo) return undefined;
        return [this.poolInfo.vReserve0, this.poolInfo.vReserve1];
    }

    /**
     * Get amplification factor in basis points
     */
    getAmplification(): number | undefined {
        return this.poolInfo?.ampBps;
    }

    /**
     * Check if pool is amplified
     */
    isAmplified(): boolean {
        return this.poolInfo ? this.poolInfo.ampBps > 10000 : false;
    }

    /**
     * Get the amplification ratio (virtual/actual reserves)
     */
    getAmplificationRatio(): BigNumber {
        if (!this.poolInfo || this._reserves[0].isZero()) {
            return BigNumber.from(10000); // 1x in basis points
        }
        
        const ratio0 = this.poolInfo.vReserve0.mul(10000).div(this.poolInfo.reserve0);
        const ratio1 = this.poolInfo.vReserve1.mul(10000).div(this.poolInfo.reserve1);
        
        // Return average ratio
        return ratio0.add(ratio1).div(2);
    }
}