import { BigNumber } from "@ethersproject/bignumber";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";
import { EthMarket, MarketType, BuyCalls } from "../EthMarket.js";
import { logInfo, logError, logDebug, logWarn } from "../utils/logger.js";

// Balancer V2 Vault ABI - minimal interface
const BALANCER_VAULT_ABI = [
    "function getPoolTokens(bytes32 poolId) view returns (address[] tokens, uint256[] balances, uint256 lastChangeBlock)",
    "function getPool(bytes32 poolId) view returns (address pool, uint8 specialization)",
    "function queryBatchSwap(uint8 kind, tuple(bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[] swaps, address[] assets, tuple(address sender, bool fromInternalBalance, address recipient, bool toInternalBalance) funds) returns (int256[] assetDeltas)",
    "function swap(tuple(bytes32 poolId, uint8 kind, address assetIn, address assetOut, uint256 amount, bytes userData) singleSwap, tuple(address sender, bool fromInternalBalance, address payable recipient, bool toInternalBalance) funds, uint256 limit, uint256 deadline) payable returns (uint256 amountCalculated)",
    "function batchSwap(uint8 kind, tuple(bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[] swaps, address[] assets, tuple(address sender, bool fromInternalBalance, address payable recipient, bool toInternalBalance) funds, int256[] limits, uint256 deadline) payable returns (int256[] assetDeltas)"
];

// Balancer Pool ABIs for different pool types
const WEIGHTED_POOL_ABI = [
    "function getSwapFeePercentage() view returns (uint256)",
    "function getNormalizedWeights() view returns (uint256[])",
    "function getInvariant() view returns (uint256)",
    "function getPoolId() view returns (bytes32)",
    "function totalSupply() view returns (uint256)",
    "function getActualSupply() view returns (uint256)",
    "function getRate() view returns (uint256)"
];

const STABLE_POOL_ABI = [
    "function getSwapFeePercentage() view returns (uint256)",
    "function getAmplificationParameter() view returns (uint256 value, bool isUpdating, uint256 precision)",
    "function getPoolId() view returns (bytes32)",
    "function getRate() view returns (uint256)"
];

export enum BalancerPoolType {
    WEIGHTED = "WEIGHTED",
    STABLE = "STABLE",
    META_STABLE = "META_STABLE",
    LINEAR = "LINEAR",
    ELEMENT = "ELEMENT"
}

interface BalancerPoolInfo {
    poolId: string;
    poolType: BalancerPoolType;
    tokens: string[];
    balances: BigNumber[];
    weights?: BigNumber[]; // For weighted pools
    amplification?: BigNumber; // For stable pools
    swapFee: BigNumber;
    lastChangeBlock: number;
    totalSupply?: BigNumber;
}

export class BalancerV2Pool extends EthMarket implements MarketType {
    private vaultContract: Contract;
    private poolContract?: Contract;
    private poolInfo?: BalancerPoolInfo;
    private _reserves: BigNumber[] = [];
    
    // Balancer constants
    private readonly VAULT_ADDRESS = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
    private readonly ONE = BigNumber.from("1000000000000000000"); // 1e18
    private readonly MAX_IN_RATIO = BigNumber.from("300000000000000000"); // 0.3 (30%)
    private readonly MAX_OUT_RATIO = BigNumber.from("300000000000000000"); // 0.3 (30%)
    
    constructor(
        poolAddress: string,
        poolId: string,
        tokens: string[],
        provider: Provider,
        poolType: BalancerPoolType = BalancerPoolType.WEIGHTED
    ) {
        super(poolAddress, tokens, "BalancerV2", tokens[0]);
        this.vaultContract = new Contract(this.VAULT_ADDRESS, BALANCER_VAULT_ABI, provider);
        
        // Store poolId in poolInfo temporarily
        this.poolInfo = {
            poolId,
            poolType,
            tokens,
            balances: [],
            swapFee: BigNumber.from(0),
            lastChangeBlock: 0
        };
    }

    /**
     * Initialize pool information from Vault and pool contract
     */
    private async initializePoolInfo(): Promise<void> {
        try {
            const poolId = this.poolInfo!.poolId;
            
            // Get pool tokens and balances from Vault
            const [tokens, balances, lastChangeBlock] = await this.vaultContract.getPoolTokens(poolId);
            
            // Get pool contract address
            const [poolAddress] = await this.vaultContract.getPool(poolId);
            
            // Initialize pool contract based on type
            const poolAbi = this.poolInfo!.poolType === BalancerPoolType.WEIGHTED 
                ? WEIGHTED_POOL_ABI 
                : STABLE_POOL_ABI;
            
            this.poolContract = new Contract(poolAddress, poolAbi, this.vaultContract.provider);
            
            // Get swap fee
            const swapFee = await this.poolContract.getSwapFeePercentage();
            
            // Get pool-specific parameters
            let weights: BigNumber[] | undefined;
            let amplification: BigNumber | undefined;
            
            if (this.poolInfo!.poolType === BalancerPoolType.WEIGHTED) {
                try {
                    weights = await this.poolContract.getNormalizedWeights();
                } catch {
                    // Some pools might not have this method
                    weights = tokens.map(() => this.ONE.div(tokens.length)); // Equal weights fallback
                }
            } else if (this.poolInfo!.poolType === BalancerPoolType.STABLE || 
                       this.poolInfo!.poolType === BalancerPoolType.META_STABLE) {
                try {
                    const ampData = await this.poolContract.getAmplificationParameter();
                    amplification = ampData.value;
                } catch {
                    amplification = BigNumber.from("200"); // Default amplification
                }
            }
            
            this.poolInfo = {
                poolId,
                poolType: this.poolInfo!.poolType,
                tokens,
                balances,
                weights,
                amplification,
                swapFee,
                lastChangeBlock
            };
            
            this._reserves = balances;
            
            logDebug("Initialized Balancer V2 pool");
            
        } catch (error) {
            logError("Failed to initialize Balancer pool info");
            throw error;
        }
    }

    /**
     * Calculate output for weighted pools
     * Formula: outAmount = balanceOut * (1 - (balanceIn / (balanceIn + inAmount * (1 - fee))) ^ (weightIn / weightOut))
     */
    private calculateWeightedOutGivenIn(
        balanceIn: BigNumber,
        balanceOut: BigNumber,
        weightIn: BigNumber,
        weightOut: BigNumber,
        amountIn: BigNumber,
        swapFee: BigNumber
    ): BigNumber {
        // Apply swap fee to input
        const adjustedIn = amountIn.mul(this.ONE.sub(swapFee)).div(this.ONE);
        
        // Calculate the weight ratio
        const weightRatio = weightIn.mul(this.ONE).div(weightOut);
        
        // Calculate base = (balanceIn / (balanceIn + adjustedIn))
        const base = balanceIn.mul(this.ONE).div(balanceIn.add(adjustedIn));
        
        // For simplicity, using linear approximation for power function
        // In production, would use more accurate power calculation
        const power = this.ONE.sub(base.mul(weightRatio).div(this.ONE));
        
        return balanceOut.mul(power).div(this.ONE);
    }

    /**
     * Calculate output for stable pools (simplified)
     * Uses similar math to Curve but with Balancer's implementation
     */
    private calculateStableOutGivenIn(
        balances: BigNumber[],
        tokenIndexIn: number,
        tokenIndexOut: number,
        amountIn: BigNumber,
        amplification: BigNumber,
        swapFee: BigNumber
    ): BigNumber {
        // Apply fee
        const adjustedIn = amountIn.mul(this.ONE.sub(swapFee)).div(this.ONE);
        
        // Update balance with input
        const newBalances = [...balances];
        newBalances[tokenIndexIn] = newBalances[tokenIndexIn].add(adjustedIn);
        
        // Calculate invariant before and after
        const invariantBefore = this.calculateStableInvariant(balances, amplification);
        const invariantAfter = this.calculateStableInvariant(newBalances, amplification);
        
        // If invariant didn't change much, use simple ratio
        if (invariantAfter.sub(invariantBefore).lt(this.ONE.div(1000))) {
            return adjustedIn.mul(balances[tokenIndexOut]).div(balances[tokenIndexIn]);
        }
        
        // Calculate new balance for output token
        const newBalanceOut = this.calculateTokenBalanceGivenInvariant(
            amplification,
            balances,
            invariantAfter,
            tokenIndexOut
        );
        
        return balances[tokenIndexOut].sub(newBalanceOut);
    }

    /**
     * Calculate stable pool invariant (simplified version)
     */
    private calculateStableInvariant(balances: BigNumber[], amp: BigNumber): BigNumber {
        const sum = balances.reduce((acc, balance) => acc.add(balance), BigNumber.from(0));
        const numTokens = BigNumber.from(balances.length);
        
        // Simplified invariant calculation
        // Real implementation would use iterative convergence
        let invariant = sum;
        const ampTimesN = amp.mul(numTokens);
        
        for (let i = 0; i < 3; i++) {
            let P_D = balances[0].mul(numTokens);
            for (let j = 1; j < balances.length; j++) {
                P_D = P_D.mul(balances[j]).mul(numTokens).div(invariant);
            }
            
            const prevInvariant = invariant;
            invariant = invariant.mul(invariant).div(invariant.add(P_D)).mul(ampTimesN.add(invariant)).div(ampTimesN);
            
            if (invariant.gt(prevInvariant)) {
                if (invariant.sub(prevInvariant).lte(this.ONE.div(10000))) break;
            } else {
                if (prevInvariant.sub(invariant).lte(this.ONE.div(10000))) break;
            }
        }
        
        return invariant;
    }

    /**
     * Calculate token balance given invariant (for stable pools)
     */
    private calculateTokenBalanceGivenInvariant(
        amp: BigNumber,
        balances: BigNumber[],
        invariant: BigNumber,
        tokenIndex: number
    ): BigNumber {
        const numTokens = balances.length;
        const ampTimesN = amp.mul(numTokens);
        
        let sum = BigNumber.from(0);
        let P_D = invariant;
        
        for (let i = 0; i < numTokens; i++) {
            if (i !== tokenIndex) {
                sum = sum.add(balances[i]);
                P_D = P_D.mul(invariant).div(balances[i].mul(numTokens));
            }
        }
        
        // Solve for balances[tokenIndex]
        // Simplified calculation
        const b = sum.add(invariant.div(ampTimesN));
        const c = invariant.mul(invariant).div(P_D.mul(ampTimesN));
        
        // Quadratic formula (simplified)
        const discriminant = b.mul(b).add(c.mul(4));
        const sqrtDiscriminant = this.sqrt(discriminant);
        
        return sqrtDiscriminant.sub(b).div(2);
    }

    /**
     * Simple square root implementation for BigNumber
     */
    private sqrt(value: BigNumber): BigNumber {
        if (value.isZero()) return value;
        
        let z = value.add(BigNumber.from(1)).div(2);
        let y = value;
        
        while (z.lt(y)) {
            y = z;
            z = value.div(z).add(z).div(2);
        }
        
        return y;
    }

    async updateReserves(): Promise<void> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        try {
            const [tokens, balances, lastChangeBlock] = await this.vaultContract.getPoolTokens(
                this.poolInfo!.poolId
            );
            
            this._reserves = balances;
            this.poolInfo!.balances = balances;
            this.poolInfo!.lastChangeBlock = lastChangeBlock;
            
            logDebug("Updated Balancer pool reserves");
            
        } catch (error) {
            logError("Failed to update Balancer pool reserves");
            throw error;
        }
    }

    async getReserves(tokenAddress?: string): Promise<BigNumber> {
        if (!this.poolInfo || this._reserves.length === 0) {
            await this.updateReserves();
        }
        
        if (!tokenAddress) {
            return this._reserves.reduce((sum, reserve) => sum.add(reserve), BigNumber.from(0));
        }
        
        const tokenIndex = this.poolInfo!.tokens.indexOf(tokenAddress);
        if (tokenIndex === -1) {
            throw new Error(`Token ${tokenAddress} not found in Balancer pool`);
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
        
        // Convert from Balancer's format (1e18) to basis points
        return this.poolInfo!.swapFee.mul(10000).div(this.ONE);
    }

    async getTokensOut(tokenIn: string, tokenOut: string, amountIn: BigNumber): Promise<BigNumber> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        const tokenIndexIn = this.poolInfo!.tokens.indexOf(tokenIn);
        const tokenIndexOut = this.poolInfo!.tokens.indexOf(tokenOut);
        
        if (tokenIndexIn === -1 || tokenIndexOut === -1) {
            throw new Error("Token not found in pool");
        }
        
        // Use Balancer's queryBatchSwap for accurate calculation
        try {
            const swapSteps = [{
                poolId: this.poolInfo!.poolId,
                assetInIndex: tokenIndexIn,
                assetOutIndex: tokenIndexOut,
                amount: amountIn,
                userData: "0x"
            }];
            
            const assets = this.poolInfo!.tokens;
            
            const funds = {
                sender: this.marketAddress,
                fromInternalBalance: false,
                recipient: this.marketAddress,
                toInternalBalance: false
            };
            
            const deltas = await this.vaultContract.queryBatchSwap(
                0, // GIVEN_IN
                swapSteps,
                assets,
                funds
            );
            
            // The output amount is negative in the deltas array
            return deltas[tokenIndexOut].mul(-1);
            
        } catch (error) {
            logWarn("Failed to use queryBatchSwap, falling back to calculation");
            
            // Fallback to manual calculation based on pool type
            if (this.poolInfo!.poolType === BalancerPoolType.WEIGHTED) {
                return this.calculateWeightedOutGivenIn(
                    this._reserves[tokenIndexIn],
                    this._reserves[tokenIndexOut],
                    this.poolInfo!.weights![tokenIndexIn],
                    this.poolInfo!.weights![tokenIndexOut],
                    amountIn,
                    this.poolInfo!.swapFee
                );
            } else {
                return this.calculateStableOutGivenIn(
                    this._reserves,
                    tokenIndexIn,
                    tokenIndexOut,
                    amountIn,
                    this.poolInfo!.amplification!,
                    this.poolInfo!.swapFee
                );
            }
        }
    }

    async getPriceImpact(tokenAddress: string, tradeSize: BigNumber): Promise<BigNumber> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        const tokenIndex = this.poolInfo!.tokens.indexOf(tokenAddress);
        if (tokenIndex === -1) {
            throw new Error("Token not found in pool");
        }
        
        const reserve = this._reserves[tokenIndex];
        
        if (reserve.isZero()) {
            return BigNumber.from("10000"); // 100% impact
        }
        
        // For weighted pools, consider the weight in impact calculation
        if (this.poolInfo!.poolType === BalancerPoolType.WEIGHTED && this.poolInfo!.weights) {
            const weight = this.poolInfo!.weights[tokenIndex];
            const adjustedReserve = reserve.mul(this.ONE).div(weight);
            return tradeSize.mul(10000).div(adjustedReserve);
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
        
        const tokenIndexIn = this.poolInfo!.tokens.indexOf(tokenIn);
        const tokenIndexOut = this.poolInfo!.tokens.indexOf(this.tokenAddress);
        
        if (tokenIndexIn === -1 || tokenIndexOut === -1) {
            throw new Error("Token pair not found in pool");
        }
        
        // Prepare single swap struct
        const singleSwap = {
            poolId: this.poolInfo!.poolId,
            kind: 0, // GIVEN_IN
            assetIn: tokenIn,
            assetOut: this.tokenAddress,
            amount: amountIn,
            userData: "0x"
        };
        
        const funds = {
            sender: sellToMarket.marketAddress,
            fromInternalBalance: false,
            recipient: sellToMarket.marketAddress,
            toInternalBalance: false
        };
        
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
        
        const data = this.vaultContract.interface.encodeFunctionData('swap', [
            singleSwap,
            funds,
            0, // limit (0 for no limit on GIVEN_IN)
            deadline
        ]);
        
        return {
            targets: [this.VAULT_ADDRESS],
            data: [data],
            payloads: [data],
            values: [BigNumber.from(0)]
        };
    }

    async sellTokens(tokenIn: string, amountIn: BigNumber, recipient: string): Promise<string> {
        const singleSwap = {
            poolId: this.poolInfo!.poolId,
            kind: 0, // GIVEN_IN
            assetIn: tokenIn,
            assetOut: this.tokenAddress,
            amount: amountIn,
            userData: "0x"
        };
        
        const funds = {
            sender: recipient,
            fromInternalBalance: false,
            recipient: recipient,
            toInternalBalance: false
        };
        
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
        
        return this.vaultContract.interface.encodeFunctionData('swap', [
            singleSwap,
            funds,
            0,
            deadline
        ]);
    }

    receiveDirectly(tokenAddress: string): boolean {
        // Balancer V2 uses the Vault for all token transfers
        return false;
    }

    async getBalance(tokenAddress: string): Promise<BigNumber> {
        if (!this.poolInfo) {
            await this.initializePoolInfo();
        }
        
        const tokenIndex = this.poolInfo!.tokens.indexOf(tokenAddress);
        if (tokenIndex === -1) {
            return BigNumber.from(0);
        }
        
        return this._reserves[tokenIndex];
    }

    async getVolatility(): Promise<BigNumber> {
        // Return different volatility based on pool type
        if (this.poolInfo?.poolType === BalancerPoolType.STABLE) {
            return BigNumber.from(50); // Very low volatility
        } else if (this.poolInfo?.poolType === BalancerPoolType.WEIGHTED) {
            return BigNumber.from(500); // Medium volatility
        }
        return BigNumber.from(1000); // High volatility for other types
    }

    async getLiquidity(): Promise<BigNumber> {
        if (!this.poolInfo || this._reserves.length === 0) {
            await this.updateReserves();
        }
        
        return this._reserves.reduce((sum, reserve) => sum.add(reserve), BigNumber.from(0));
    }

    /**
     * Get pool weights (for weighted pools)
     */
    getWeights(): BigNumber[] | undefined {
        return this.poolInfo?.weights;
    }

    /**
     * Get pool type
     */
    getPoolType(): BalancerPoolType {
        return this.poolInfo?.poolType || BalancerPoolType.WEIGHTED;
    }

    /**
     * Get pool ID
     */
    getPoolId(): string {
        return this.poolInfo?.poolId || "";
    }
}