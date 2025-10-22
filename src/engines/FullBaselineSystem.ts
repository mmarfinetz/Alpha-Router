import { BigNumber } from '@ethersproject/bignumber';
import { MarketsByToken, CrossedMarketDetails, MarketPair } from '../types';
import { DualDecompositionOptimizer, ArbitragePath } from './DualDecompositionOptimizer';
import { logInfo, logWarn } from '../utils/logger';

export interface BaselineConfig {
    // Limit how many top paths to include in splitting
    maxPaths: number;
    // Drop paths with profit below this threshold
    minProfitWei: BigNumber;
}

export class FullBaselineSystem {
    private dual: DualDecompositionOptimizer;
    private config: BaselineConfig;

    constructor(config?: Partial<BaselineConfig>) {
        this.dual = new DualDecompositionOptimizer();
        this.config = {
            maxPaths: 8,
            minProfitWei: BigNumber.from(0),
            ...config,
        };
    }

    /**
     * End-to-end baseline optimization:
     * 1) Discover profitable paths deterministically
     * 2) Allocate a given total volume across those paths
     */
    async optimize(
        marketsByToken: MarketsByToken,
        startToken: string,
        totalVolume: BigNumber
    ): Promise<CrossedMarketDetails[]> {
        const paths = await this.findPaths(marketsByToken, startToken);
        if (paths.length === 0) return [];

        const splits = this.optimizeSplits(paths, totalVolume);
        return this.toCrossedMarkets(splits);
    }

    /**
     * Deterministic path discovery using the dual-decomposition optimizer.
     * Filters to cycles that start at the requested startToken when provided.
     */
    async findPaths(
        marketsByToken: MarketsByToken,
        startToken?: string
    ): Promise<ArbitragePath[]> {
        const res = await this.dual.optimize(marketsByToken);
        const filtered = (res.optimalPaths || [])
            .filter(p => p.expectedProfit.gte(this.config.minProfitWei))
            .filter(p => !startToken || (p.tokens[0] === startToken));

        // Take top-N most profitable
        const top = filtered.slice(0, this.config.maxPaths);
        logInfo('FullBaselineSystem.findPaths', { total: filtered.length, used: top.length } as any);
        return top;
    }

    /**
     * Simple split optimizer across discovered paths.
     * If the sum of per-path optimal volumes <= total, keep their volumes.
     * Otherwise, scale volumes proportionally and scale profits linearly (baseline approximation).
     */
    optimizeSplits(
        paths: ArbitragePath[],
        totalVolume: BigNumber
    ): Array<{ path: ArbitragePath; volume: BigNumber; profit: BigNumber }> {
        // Sum the optimizer-suggested volumes
        const sumVol = paths.reduce((acc, p) => acc.add(p.volume ?? BigNumber.from(0)), BigNumber.from(0));
        if (sumVol.isZero()) return [];

        const results: Array<{ path: ArbitragePath; volume: BigNumber; profit: BigNumber }> = [];

        if (sumVol.lte(totalVolume)) {
            // No need to scale; use suggested volumes
            for (const p of paths) {
                results.push({ path: p, volume: p.volume, profit: p.expectedProfit });
            }
            return results;
        }

        // Scale all path volumes by ratio = totalVolume / sumVol
        // profit is scaled linearly as an approximation
        for (const p of paths) {
            const vol = p.volume || BigNumber.from(0);
            if (vol.isZero()) continue;
            const scaledVol = vol.mul(totalVolume).div(sumVol);
            const scaledProfit = p.expectedProfit.mul(scaledVol).div(vol);
            results.push({ path: p, volume: scaledVol, profit: scaledProfit });
        }

        return results;
    }

    /**
     * Convert split allocation into CrossedMarketDetails for downstream execution
     */
    private toCrossedMarkets(
        splits: Array<{ path: ArbitragePath; volume: BigNumber; profit: BigNumber }>
    ): CrossedMarketDetails[] {
        return splits.map(({ path, volume, profit }) => ({
            profit,
            volume,
            tokenAddress: path.tokens[0],
            buyFromMarket: path.markets[0] as any,
            sellToMarket: path.markets[path.markets.length - 1] as any,
            marketPairs: path.markets.map((market, idx) => ({
                market,
                tokens: [path.tokens[idx], path.tokens[idx + 1]],
            })) as unknown as MarketPair[],
        }));
    }
}

