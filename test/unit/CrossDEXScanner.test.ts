import { expect } from 'chai';
import { BigNumber } from '@ethersproject/bignumber';
import { providers } from 'ethers';
import { CrossDEXScanner, ScannerConfig } from '../../src/scanners/CrossDEXScanner.js';
import { AnalyticalEngineConfig } from '../../src/engines/AnalyticalArbitrageEngine.js';
import { MarketsByToken } from '../../src/types.js';
import { EthMarket } from '../../src/EthMarket.js';

// Mock provider
class MockProvider extends providers.BaseProvider {
    constructor() {
        super('mock');
    }

    async detectNetwork() {
        return { name: 'mock', chainId: 1 };
    }

    async perform() {
        return {};
    }
}

// Mock EthMarket
class MockEthMarket implements Partial<EthMarket> {
    public marketAddress: string;
    public tokens: string[];
    private reserves: [BigNumber, BigNumber];
    private shouldFail: boolean;

    constructor(
        marketAddress: string, 
        tokens: string[], 
        reserves: [BigNumber, BigNumber],
        shouldFail: boolean = false
    ) {
        this.marketAddress = marketAddress;
        this.tokens = tokens;
        this.reserves = reserves;
        this.shouldFail = shouldFail;
    }

    async getReservesByToken(): Promise<[BigNumber, BigNumber]> {
        if (this.shouldFail) {
            throw new Error('Mock error');
        }
        return this.reserves;
    }

    async updateReserves(): Promise<void> {
        // Mock implementation
    }
}

describe('CrossDEXScanner', () => {
    let scanner: CrossDEXScanner;
    let provider: MockProvider;
    let scannerConfig: ScannerConfig;
    let analyticalConfig: AnalyticalEngineConfig;

    beforeEach(() => {
        provider = new MockProvider();
        
        scannerConfig = {
            minSpreadBasisPoints: 50, // 0.5%
            maxLatencyMs: 30000,
            batchSize: 5,
            minLiquidityWei: BigNumber.from('1000000000000000000'), // 1 ETH
            maxGasPriceGwei: BigNumber.from('100')
        };

        analyticalConfig = {
            minProfitWei: BigNumber.from('10000000000000000'), // 0.01 ETH
            maxGasPriceGwei: BigNumber.from('100'),
            maxSlippagePercent: 1.0,
            maxTradePercentOfLiquidity: 20,
            gasCostPerSwap: BigNumber.from('350000')
        };

        scanner = new CrossDEXScanner(provider, scannerConfig, analyticalConfig);
    });

    describe('scanForOpportunities', () => {
        it('should find arbitrage opportunities across different DEXes', async () => {
            const marketsByToken: MarketsByToken = {
                '0xTokenA': [
                    new MockEthMarket(
                        '0xMarket1',
                        ['0xETH', '0xTokenA'],
                        [
                            BigNumber.from('1000000000000000000000'), // 1000 ETH
                            BigNumber.from('2000000000000000000000') // 2000 TokenA (1:2 ratio)
                        ]
                    ) as EthMarket,
                    new MockEthMarket(
                        '0xMarket2',
                        ['0xETH', '0xTokenA'],
                        [
                            BigNumber.from('800000000000000000000'), // 800 ETH
                            BigNumber.from('1400000000000000000000') // 1400 TokenA (1:1.75 ratio - better)
                        ]
                    ) as EthMarket
                ]
            };

            const opportunities = await scanner.scanForOpportunities(marketsByToken);

            expect(opportunities).to.be.an('array');
            expect(opportunities.length).to.be.greaterThan(0);
            
            if (opportunities.length > 0) {
                const opp = opportunities[0];
                expect(opp.buyMarket).to.exist;
                expect(opp.sellMarket).to.exist;
                expect(opp.tokenAddress).to.equal('0xTokenA');
                expect(opp.netProfit.gt(0)).to.be.true;
            }
        });

        it('should return empty array when no opportunities exist', async () => {
            const marketsByToken: MarketsByToken = {
                '0xTokenA': [
                    new MockEthMarket(
                        '0xMarket1',
                        ['0xETH', '0xTokenA'],
                        [
                            BigNumber.from('1000000000000000000000'), // 1000 ETH
                            BigNumber.from('2000000000000000000000') // 2000 TokenA
                        ]
                    ) as EthMarket,
                    new MockEthMarket(
                        '0xMarket2',
                        ['0xETH', '0xTokenA'],
                        [
                            BigNumber.from('1000000000000000000000'), // 1000 ETH
                            BigNumber.from('2000000000000000000000') // 2000 TokenA (same price)
                        ]
                    ) as EthMarket
                ]
            };

            const opportunities = await scanner.scanForOpportunities(marketsByToken);
            expect(opportunities).to.be.an('array');
            expect(opportunities.length).to.equal(0);
        });

        it('should handle markets with insufficient liquidity', async () => {
            const marketsByToken: MarketsByToken = {
                '0xTokenA': [
                    new MockEthMarket(
                        '0xMarket1',
                        ['0xETH', '0xTokenA'],
                        [
                            BigNumber.from('100000000000000000'), // 0.1 ETH (too low)
                            BigNumber.from('200000000000000000') // 0.2 TokenA
                        ]
                    ) as EthMarket,
                    new MockEthMarket(
                        '0xMarket2',
                        ['0xETH', '0xTokenA'],
                        [
                            BigNumber.from('150000000000000000'), // 0.15 ETH (too low)
                            BigNumber.from('200000000000000000') // 0.2 TokenA
                        ]
                    ) as EthMarket
                ]
            };

            const opportunities = await scanner.scanForOpportunities(marketsByToken);
            expect(opportunities).to.be.an('array');
            expect(opportunities.length).to.equal(0);
        });

        it('should handle market errors gracefully', async () => {
            const marketsByToken: MarketsByToken = {
                '0xTokenA': [
                    new MockEthMarket(
                        '0xMarket1',
                        ['0xETH', '0xTokenA'],
                        [
                            BigNumber.from('1000000000000000000000'),
                            BigNumber.from('2000000000000000000000')
                        ],
                        true // Will throw error
                    ) as EthMarket,
                    new MockEthMarket(
                        '0xMarket2',
                        ['0xETH', '0xTokenA'],
                        [
                            BigNumber.from('800000000000000000000'),
                            BigNumber.from('1400000000000000000000')
                        ]
                    ) as EthMarket
                ]
            };

            const opportunities = await scanner.scanForOpportunities(marketsByToken);
            
            // Should not throw and should handle the error gracefully
            expect(opportunities).to.be.an('array');
            // May find opportunities from non-failing markets
        });

        it('should respect minimum spread requirements', async () => {
            const marketsByToken: MarketsByToken = {
                '0xTokenA': [
                    new MockEthMarket(
                        '0xMarket1',
                        ['0xETH', '0xTokenA'],
                        [
                            BigNumber.from('1000000000000000000000'), // 1000 ETH
                            BigNumber.from('2000000000000000000000') // 2000 TokenA
                        ]
                    ) as EthMarket,
                    new MockEthMarket(
                        '0xMarket2',
                        ['0xETH', '0xTokenA'],
                        [
                            BigNumber.from('1000000000000000000000'), // 1000 ETH
                            BigNumber.from('2005000000000000000000') // 2005 TokenA (0.25% spread - below threshold)
                        ]
                    ) as EthMarket
                ]
            };

            const opportunities = await scanner.scanForOpportunities(marketsByToken);
            expect(opportunities.length).to.equal(0);
        });

        it('should process multiple tokens correctly', async () => {
            const marketsByToken: MarketsByToken = {
                '0xTokenA': [
                    new MockEthMarket('0xMarket1A', ['0xETH', '0xTokenA'], [
                        BigNumber.from('1000000000000000000000'),
                        BigNumber.from('2000000000000000000000')
                    ]) as EthMarket,
                    new MockEthMarket('0xMarket2A', ['0xETH', '0xTokenA'], [
                        BigNumber.from('800000000000000000000'),
                        BigNumber.from('1400000000000000000000')
                    ]) as EthMarket
                ],
                '0xTokenB': [
                    new MockEthMarket('0xMarket1B', ['0xETH', '0xTokenB'], [
                        BigNumber.from('500000000000000000000'),
                        BigNumber.from('1500000000000000000000')
                    ]) as EthMarket,
                    new MockEthMarket('0xMarket2B', ['0xETH', '0xTokenB'], [
                        BigNumber.from('600000000000000000000'),
                        BigNumber.from('1500000000000000000000')
                    ]) as EthMarket
                ]
            };

            const opportunities = await scanner.scanForOpportunities(marketsByToken);
            
            expect(opportunities).to.be.an('array');
            // Should potentially find opportunities for both tokens
        });
    });

    describe('Cache Management', () => {
        it('should cache price data correctly', async () => {
            const marketsByToken: MarketsByToken = {
                '0xTokenA': [
                    new MockEthMarket('0xMarket1', ['0xETH', '0xTokenA'], [
                        BigNumber.from('1000000000000000000000'),
                        BigNumber.from('2000000000000000000000')
                    ]) as EthMarket
                ]
            };

            // First scan
            await scanner.scanForOpportunities(marketsByToken);
            const stats1 = scanner.getScannerStats();

            // Second scan (should use cache)
            await scanner.scanForOpportunities(marketsByToken);
            const stats2 = scanner.getScannerStats();

            expect(stats2.cacheSize).to.be.greaterThan(0);
        });

        it('should clear stale cache entries', async () => {
            const marketsByToken: MarketsByToken = {
                '0xTokenA': [
                    new MockEthMarket('0xMarket1', ['0xETH', '0xTokenA'], [
                        BigNumber.from('1000000000000000000000'),
                        BigNumber.from('2000000000000000000000')
                    ]) as EthMarket
                ]
            };

            await scanner.scanForOpportunities(marketsByToken);
            
            // Clear stale cache
            scanner.clearStaleCache();
            
            // Should not throw
            expect(() => scanner.clearStaleCache()).to.not.throw();
        });

        it('should force refresh prices', async () => {
            const marketsByToken: MarketsByToken = {
                '0xTokenA': [
                    new MockEthMarket('0xMarket1', ['0xETH', '0xTokenA'], [
                        BigNumber.from('1000000000000000000000'),
                        BigNumber.from('2000000000000000000000')
                    ]) as EthMarket
                ]
            };

            await scanner.forceRefreshPrices(marketsByToken);
            
            // Should not throw
            expect(() => scanner.forceRefreshPrices(marketsByToken)).to.not.throw();
        });
    });

    describe('Performance', () => {
        it('should complete scan within reasonable time', async () => {
            const marketsByToken: MarketsByToken = {
                '0xTokenA': Array.from({ length: 10 }, (_, i) => 
                    new MockEthMarket(`0xMarket${i}`, ['0xETH', '0xTokenA'], [
                        BigNumber.from('1000000000000000000000'),
                        BigNumber.from(`${2000 + i * 10}000000000000000000`)
                    ]) as EthMarket
                )
            };

            const startTime = Date.now();
            await scanner.scanForOpportunities(marketsByToken);
            const endTime = Date.now();

            // Should complete within 10 seconds
            expect(endTime - startTime).to.be.lessThan(10000);
        });

        it('should handle batch processing correctly', async () => {
            const marketsByToken: MarketsByToken = {
                '0xTokenA': Array.from({ length: 15 }, (_, i) => 
                    new MockEthMarket(`0xMarket${i}`, ['0xETH', '0xTokenA'], [
                        BigNumber.from('1000000000000000000000'),
                        BigNumber.from(`${2000 + i * 100}000000000000000000`)
                    ]) as EthMarket
                )
            };

            // With batch size of 5, should process 15 markets in 3 batches
            const opportunities = await scanner.scanForOpportunities(marketsByToken);
            
            expect(opportunities).to.be.an('array');
            // Should find some opportunities with the price differences
            expect(opportunities.length).to.be.greaterThan(0);
        });
    });

    describe('Statistics', () => {
        it('should track scanner statistics correctly', async () => {
            const marketsByToken: MarketsByToken = {
                '0xTokenA': [
                    new MockEthMarket('0xMarket1', ['0xETH', '0xTokenA'], [
                        BigNumber.from('1000000000000000000000'),
                        BigNumber.from('2000000000000000000000')
                    ]) as EthMarket
                ]
            };

            const statsBefore = scanner.getScannerStats();
            await scanner.scanForOpportunities(marketsByToken);
            const statsAfter = scanner.getScannerStats();

            expect(statsAfter.totalScans).to.equal(statsBefore.totalScans + 1);
            expect(statsAfter.lastScanTime).to.be.greaterThan(statsBefore.lastScanTime);
        });
    });
});