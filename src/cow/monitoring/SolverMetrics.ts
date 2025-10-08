import { BigNumber } from 'ethers';
import { EventEmitter } from 'events';
import logger from '../../utils/logger';

/**
 * Detailed metrics for a single auction
 */
export interface AuctionMetrics {
  auctionId: string;
  timestamp: number;
  orderCount: number;
  liquidityCount: number;
  solveTimeMs: number;
  success: boolean;
  error?: string;

  // Solution details (if found)
  solutionFound: boolean;
  surplus?: string; // In ETH
  score?: string;
  gasEstimate?: number;
  routeCount?: number;
  cowMatchCount?: number;

  // Protocol breakdown
  protocolsUsed?: string[];

  // Outcome
  submitted?: boolean;
  won?: boolean;
  competitorCount?: number;
}

/**
 * Aggregated statistics
 */
export interface SolverStats {
  // Auction stats
  totalAuctions: number;
  successfulSolves: number;
  failedSolves: number;
  timeouts: number;

  // Win rate
  solutionsSubmitted: number;
  auctionsWon: number;
  winRate: number; // %

  // Performance
  avgSolveTimeMs: number;
  p50SolveTimeMs: number;
  p95SolveTimeMs: number;
  p99SolveTimeMs: number;

  // Financial
  totalSurplusGenerated: string; // ETH
  avgSurplusPerAuction: string; // ETH
  totalGasCost: string; // ETH
  netProfit: string; // ETH

  // Routing
  totalCoWMatches: number;
  totalLiquidityRoutes: number;
  avgRoutesPerAuction: number;

  // Protocol breakdown
  protocolUsage: { [protocol: string]: number };

  // Oracle health
  oracleSuccessRate: number;
  oracleFallbackRate: number;

  // Error tracking
  errorCounts: { [errorType: string]: number };

  // Timing
  uptime: number; // seconds
  lastAuctionTime?: number;
}

/**
 * Time-series data point
 */
export interface TimeSeriesPoint {
  timestamp: number;
  winRate: number;
  surplus: string;
  solveTime: number;
  auctionCount: number;
}

/**
 * Oracle metrics
 */
export interface OracleMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  fallbackUsed: number;
  avgLatencyMs: number;
}

/**
 * Professional-grade metrics tracker for CoW Protocol solver
 * Tracks comprehensive performance data for competitive analysis
 */
export class SolverMetrics extends EventEmitter {
  private auctions: AuctionMetrics[] = [];
  private readonly MAX_STORED_AUCTIONS = 1000;
  private readonly MAX_TIMESERIES_POINTS = 500;

  private startTime: number = Date.now();
  private oracleMetrics: OracleMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    fallbackUsed: 0,
    avgLatencyMs: 0
  };

  private timeSeriesData: TimeSeriesPoint[] = [];
  private errorCounts: Map<string, number> = new Map();

  constructor() {
    super();
    logger.info('SolverMetrics initialized');
  }

  /**
   * Record a new auction attempt
   */
  recordAuction(metrics: AuctionMetrics): void {
    // Store auction
    this.auctions.push(metrics);

    // Maintain ring buffer
    if (this.auctions.length > this.MAX_STORED_AUCTIONS) {
      this.auctions.shift();
    }

    // Track errors
    if (metrics.error) {
      const count = this.errorCounts.get(metrics.error) || 0;
      this.errorCounts.set(metrics.error, count + 1);
    }

    // Update time series
    this.updateTimeSeries();

    // Emit event for real-time monitoring
    this.emit('auction', metrics);

    logger.debug('Auction recorded', {
      id: metrics.auctionId,
      success: metrics.success,
      solveTime: `${metrics.solveTimeMs}ms`,
      surplus: metrics.surplus
    });
  }

  /**
   * Record oracle performance
   */
  recordOracleRequest(success: boolean, latencyMs: number, fallback: boolean = false): void {
    this.oracleMetrics.totalRequests++;

    if (success) {
      this.oracleMetrics.successfulRequests++;
    } else {
      this.oracleMetrics.failedRequests++;
    }

    if (fallback) {
      this.oracleMetrics.fallbackUsed++;
    }

    // Update rolling average latency
    const total = this.oracleMetrics.totalRequests;
    const prevAvg = this.oracleMetrics.avgLatencyMs;
    this.oracleMetrics.avgLatencyMs = (prevAvg * (total - 1) + latencyMs) / total;
  }

  /**
   * Update time series data for charting
   */
  private updateTimeSeries(): void {
    const now = Date.now();
    const recentAuctions = this.auctions.slice(-100); // Last 100 auctions

    if (recentAuctions.length === 0) return;

    const successful = recentAuctions.filter(a => a.solutionFound);
    const won = successful.filter(a => a.won);

    const totalSurplus = successful.reduce((sum, a) => {
      return sum + (parseFloat(a.surplus || '0'));
    }, 0);

    const avgSolveTime = recentAuctions.reduce((sum, a) => sum + a.solveTimeMs, 0) / recentAuctions.length;

    const point: TimeSeriesPoint = {
      timestamp: now,
      winRate: successful.length > 0 ? (won.length / successful.length) * 100 : 0,
      surplus: totalSurplus.toFixed(6),
      solveTime: avgSolveTime,
      auctionCount: recentAuctions.length
    };

    this.timeSeriesData.push(point);

    // Maintain ring buffer
    if (this.timeSeriesData.length > this.MAX_TIMESERIES_POINTS) {
      this.timeSeriesData.shift();
    }

    this.emit('timeseries', point);
  }

  /**
   * Get comprehensive solver statistics
   */
  getStats(): SolverStats {
    const total = this.auctions.length;
    const successful = this.auctions.filter(a => a.solutionFound);
    const submitted = successful.filter(a => a.submitted);
    const won = successful.filter(a => a.won);
    const failed = this.auctions.filter(a => !a.success);
    const timeouts = failed.filter(a => a.error?.includes('timeout'));

    // Calculate percentiles for solve time
    const solveTimes = this.auctions.map(a => a.solveTimeMs).sort((a, b) => a - b);
    const p50 = this.percentile(solveTimes, 0.5);
    const p95 = this.percentile(solveTimes, 0.95);
    const p99 = this.percentile(solveTimes, 0.99);
    const avgSolveTime = solveTimes.length > 0
      ? solveTimes.reduce((a, b) => a + b, 0) / solveTimes.length
      : 0;

    // Financial metrics
    const totalSurplus = successful.reduce((sum, a) => {
      return sum + parseFloat(a.surplus || '0');
    }, 0);

    const totalGas = successful.reduce((sum, a) => {
      // Estimate: ~150k gas per solution at 1 gwei = 0.00015 ETH
      return sum + (a.gasEstimate || 150000) * 1e-9;
    }, 0);

    // Routing stats
    const totalCoWMatches = successful.reduce((sum, a) => sum + (a.cowMatchCount || 0), 0);
    const totalRoutes = successful.reduce((sum, a) => sum + (a.routeCount || 0), 0);

    // Protocol breakdown
    const protocolUsage: { [key: string]: number } = {};
    successful.forEach(a => {
      a.protocolsUsed?.forEach(protocol => {
        protocolUsage[protocol] = (protocolUsage[protocol] || 0) + 1;
      });
    });

    // Error counts
    const errorCounts: { [key: string]: number } = {};
    this.errorCounts.forEach((count, error) => {
      errorCounts[error] = count;
    });

    return {
      // Auction stats
      totalAuctions: total,
      successfulSolves: successful.length,
      failedSolves: failed.length,
      timeouts: timeouts.length,

      // Win rate
      solutionsSubmitted: submitted.length,
      auctionsWon: won.length,
      winRate: submitted.length > 0 ? (won.length / submitted.length) * 100 : 0,

      // Performance
      avgSolveTimeMs: avgSolveTime,
      p50SolveTimeMs: p50,
      p95SolveTimeMs: p95,
      p99SolveTimeMs: p99,

      // Financial
      totalSurplusGenerated: totalSurplus.toFixed(6),
      avgSurplusPerAuction: successful.length > 0
        ? (totalSurplus / successful.length).toFixed(6)
        : '0',
      totalGasCost: totalGas.toFixed(6),
      netProfit: (totalSurplus - totalGas).toFixed(6),

      // Routing
      totalCoWMatches: totalCoWMatches,
      totalLiquidityRoutes: totalRoutes,
      avgRoutesPerAuction: successful.length > 0
        ? totalRoutes / successful.length
        : 0,

      // Protocol breakdown
      protocolUsage,

      // Oracle health
      oracleSuccessRate: this.oracleMetrics.totalRequests > 0
        ? (this.oracleMetrics.successfulRequests / this.oracleMetrics.totalRequests) * 100
        : 0,
      oracleFallbackRate: this.oracleMetrics.totalRequests > 0
        ? (this.oracleMetrics.fallbackUsed / this.oracleMetrics.totalRequests) * 100
        : 0,

      // Error tracking
      errorCounts,

      // Timing
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      lastAuctionTime: this.auctions.length > 0
        ? this.auctions[this.auctions.length - 1].timestamp
        : undefined
    };
  }

  /**
   * Get recent auctions for live feed
   */
  getRecentAuctions(limit: number = 50): AuctionMetrics[] {
    return this.auctions.slice(-limit);
  }

  /**
   * Get time series data for charting
   */
  getTimeSeries(): TimeSeriesPoint[] {
    return [...this.timeSeriesData];
  }

  /**
   * Get oracle metrics
   */
  getOracleMetrics(): OracleMetrics {
    return { ...this.oracleMetrics };
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    this.auctions = [];
    this.timeSeriesData = [];
    this.errorCounts.clear();
    this.startTime = Date.now();
    this.oracleMetrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      fallbackUsed: 0,
      avgLatencyMs: 0
    };

    logger.info('SolverMetrics reset');
    this.emit('reset');
  }

  /**
   * Export metrics to JSON
   */
  exportToJSON(): string {
    return JSON.stringify({
      stats: this.getStats(),
      recentAuctions: this.getRecentAuctions(100),
      timeSeries: this.getTimeSeries(),
      oracle: this.getOracleMetrics(),
      exportedAt: new Date().toISOString()
    }, null, 2);
  }
}

// Singleton instance
export const solverMetrics = new SolverMetrics();
