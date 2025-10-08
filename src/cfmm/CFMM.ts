import { BigNumber, Contract, providers } from "ethers";
import { UNISWAP_PAIR_ABI } from "../abi";

export interface CFMM {
    reserves: BigNumber[];
    fee: number;
    A: number[][]; // Matrix to map local to global indices
    marketAddress: string;
    tradingFunction: (reserves: BigNumber[]) => BigNumber;
    tradingFunctionGradient: (reserves: BigNumber[]) => BigNumber[];
    arbitrage: (prices: BigNumber[]) => Promise<{ delta: BigNumber[], value: BigNumber }>;
    updateReserves(): Promise<void>;
}

// Example: Uniswap V2 CFMM Implementation
export class UniswapV2CFMM implements CFMM {
    reserves: BigNumber[];
    fee: number;
    A: number[][];
    marketAddress: string;

    constructor(
        marketAddress: string, 
        reserves: BigNumber[], 
        fee: number, 
        A: number[][], 
        private provider: providers.Provider
    ) {
        this.marketAddress = marketAddress;
        this.reserves = reserves;
        this.fee = fee;
        this.A = A;
    }

    async updateReserves() {
        const contract = new Contract(this.marketAddress, UNISWAP_PAIR_ABI, this.provider);
        const reserves = await contract.getReserves();
        this.reserves = [reserves._reserve0, reserves._reserve1];
    }

    tradingFunction(reserves: BigNumber[]): BigNumber {
        // Constant product formula: k = x*y
        return reserves[0].mul(reserves[1]);
    }

    tradingFunctionGradient(reserves: BigNumber[]): BigNumber[] {
        // Gradient of the constant product formula
        return [reserves[1], reserves[0]];
    }

    private sqrtBigNumber(value: BigNumber): BigNumber {
        // Newton's method for square root approximation with BigNumber
        if (value.eq(0)) return BigNumber.from(0);
        if (value.eq(1)) return BigNumber.from(1);
        
        let x = value;
        let y = value.add(1).div(2);
        
        // Limit iterations to prevent infinite loops with proper convergence check
        const tolerance = BigNumber.from('1000000000000'); // 1e-6 ETH tolerance
        for (let i = 0; i < 50; i++) {
            const prev = x;
            x = y;
            y = x.add(value.div(x)).div(2);
            
            // Check for convergence with tolerance
            if (x.sub(y).abs().lte(tolerance)) {
                break;
            }
        }
        
        return x;
    }

    async arbitrage(prices: BigNumber[]): Promise<{ delta: BigNumber[], value: BigNumber }> {
        // Map global prices to local prices using A
        const localPrices = this.A.map(row => {
            let sum = BigNumber.from(0);
            for (let i = 0; i < row.length; i++) {
                if (row[i] !== 0) {
                    sum = sum.add(BigNumber.from(row[i]).mul(prices[i]));
                }
            }
            return sum;
        });

        const v1 = localPrices[0];
        const v2 = localPrices[1];

        if (v1.isZero() || v2.isZero()) {
            return { delta: [BigNumber.from(0), BigNumber.from(0)], value: BigNumber.from(0) };
        }

        const R1 = this.reserves[0];
        const R2 = this.reserves[1];
        const gamma = 1 - this.fee;
        const eta = 1; // For Uniswap V2, η = 1

        // Proper Uniswap V2 arbitrage calculations using optimal trade sizing
        // For Uniswap V2, optimal arbitrage occurs when: v1/v2 = (R1 + δ1)/(R2 - δ2) * (1-fee)
        
        const ONE_ETH = BigNumber.from('1000000000000000000');
        const FEE_NUMERATOR = BigNumber.from('997'); // 0.3% fee
        const FEE_DENOMINATOR = BigNumber.from('1000');
        
        let delta1 = BigNumber.from(0);
        let f1delta1 = BigNumber.from(0);
        let delta2_alt = BigNumber.from(0);
        let f2delta2 = BigNumber.from(0);
        
        // Calculate optimal trade size using proper Uniswap V2 formula
        // δ_optimal = (√(R1*R2*v2/v1) - R1) / (1 + fee)
        
        try {
            // Direction 1: Buy token1 with token2 (if v1/v2 < current_price)
            // Check if v2*R1 > v1*R2 (price discrepancy exists)
            if (v2.mul(R1).gt(v1.mul(R2))) {
                // Calculate optimal input amount using square root approximation
                // We use Newton's method to approximate square root for BigNumber
                const target = R1.mul(R2).mul(v2).div(v1); // R1*R2*v2/v1
                const sqrtTarget = this.sqrtBigNumber(target);
                
                if (sqrtTarget.gt(R1)) {
                    delta1 = sqrtTarget.sub(R1).mul(FEE_DENOMINATOR).div(FEE_DENOMINATOR.add(FEE_NUMERATOR));
                    
                    // Limit trade size to prevent excessive slippage
                    const maxTradeSize = R1.div(5); // Max 20% of liquidity
                    if (delta1.gt(maxTradeSize)) {
                        delta1 = maxTradeSize;
                    }
                    
                    if (delta1.gt(0)) {
                        // Calculate output using Uniswap formula: dy = y*dx*997/(x*1000 + dx*997)
                        f1delta1 = R2.mul(delta1).mul(FEE_NUMERATOR).div(
                            R1.mul(FEE_DENOMINATOR).add(delta1.mul(FEE_NUMERATOR))
                        );
                    }
                }
            }
            
            // Direction 2: Buy token2 with token1 (if v2/v1 < current_price)
            if (v1.mul(R2).gt(v2.mul(R1))) {
                const target = R2.mul(R1).mul(v1).div(v2); // R2*R1*v1/v2
                const sqrtTarget = this.sqrtBigNumber(target);
                
                if (sqrtTarget.gt(R2)) {
                    delta2_alt = sqrtTarget.sub(R2).mul(FEE_DENOMINATOR).div(FEE_DENOMINATOR.add(FEE_NUMERATOR));
                    
                    // Limit trade size
                    const maxTradeSize = R2.div(5); // Max 20% of liquidity
                    if (delta2_alt.gt(maxTradeSize)) {
                        delta2_alt = maxTradeSize;
                    }
                    
                    if (delta2_alt.gt(0)) {
                        f2delta2 = R1.mul(delta2_alt).mul(FEE_NUMERATOR).div(
                            R2.mul(FEE_DENOMINATOR).add(delta2_alt.mul(FEE_NUMERATOR))
                        );
                    }
                }
            }
        } catch (error) {
            // If any mathematical operation fails, return zero values
            delta1 = BigNumber.from(0);
            f1delta1 = BigNumber.from(0);
            delta2_alt = BigNumber.from(0);
            f2delta2 = BigNumber.from(0);
        }

        // Calculate profit for each direction and choose the best
        let value1 = BigNumber.from(0);
        let value2 = BigNumber.from(0);
        
        if (delta1.gt(0) && f1delta1.gt(0)) {
            // Profit = output_value - input_value
            value1 = v2.mul(f1delta1).sub(v1.mul(delta1));
        }
        
        if (delta2_alt.gt(0) && f2delta2.gt(0)) {
            value2 = v1.mul(f2delta2).sub(v2.mul(delta2_alt));
        }
        
        // Return the most profitable trade direction
        if (value1.gt(value2) && value1.gt(BigNumber.from('10000000000000000'))) { // Min 0.01 ETH profit
            return { 
                delta: [delta1.mul(-1), f1delta1], // Negative delta1 = sell token1, positive f1delta1 = buy token2
                value: value1 
            };
        } else if (value2.gt(BigNumber.from('10000000000000000'))) { // Min 0.01 ETH profit
            return { 
                delta: [f2delta2, delta2_alt.mul(-1)], // Positive f2delta2 = buy token1, negative delta2 = sell token2
                value: value2 
            };
        } else {
            return { 
                delta: [BigNumber.from(0), BigNumber.from(0)], 
                value: BigNumber.from(0) 
            };
        }
    }
} 