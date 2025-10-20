import { useEffect, useState } from 'react';
import io, { Socket } from 'socket.io-client';

// Types matching backend metrics
export interface AuctionMetrics {
  auctionId: string;
  timestamp: number;
  orderCount: number;
  liquidityCount: number;
  solveTimeMs: number;
  success: boolean;
  error?: string;

  solutionFound: boolean;
  surplus?: string;
  score?: string;
  gasEstimate?: number;
  routeCount?: number;
  cowMatchCount?: number;

  protocolsUsed?: string[];

  submitted?: boolean;
  won?: boolean;
  competitorCount?: number;
}

export interface SolverStats {
  totalAuctions: number;
  successfulSolves: number;
  failedSolves: number;
  timeouts: number;

  solutionsSubmitted: number;
  auctionsWon: number;
  winRate: number;

  avgSolveTimeMs: number;
  p50SolveTimeMs: number;
  p95SolveTimeMs: number;
  p99SolveTimeMs: number;

  totalSurplusGenerated: string;
  avgSurplusPerAuction: string;
  totalGasCost: string;
  netProfit: string;

  totalCoWMatches: number;
  totalLiquidityRoutes: number;
  avgRoutesPerAuction: number;

  protocolUsage: { [protocol: string]: number };

  oracleSuccessRate: number;
  oracleFallbackRate: number;

  errorCounts: { [errorType: string]: number };

  uptime: number;
  lastAuctionTime?: number;
}

export interface TimeSeriesPoint {
  timestamp: number;
  winRate: number;
  surplus: string;
  solveTime: number;
  auctionCount: number;
}

export interface OracleMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  fallbackUsed: number;
  avgLatencyMs: number;
}

interface SolverMetricsData {
  stats: SolverStats | null;
  recentAuctions: AuctionMetrics[];
  timeSeries: TimeSeriesPoint[];
  oracleMetrics: OracleMetrics | null;
  connected: boolean;
  loading: boolean;
}

// WebSocket URL - Use Railway in production, localhost for development
const SOLVER_WS_URL = process.env.REACT_APP_SOLVER_WS_URL || 
  (process.env.NODE_ENV === 'production' 
    ? 'https://arbitrage-bot-production.up.railway.app'  // Update with your Railway URL
    : 'http://localhost:8000');

export function useSolverMetrics(): SolverMetricsData {
  const [stats, setStats] = useState<SolverStats | null>(null);
  const [recentAuctions, setRecentAuctions] = useState<AuctionMetrics[]>([]);
  const [timeSeries, setTimeSeries] = useState<TimeSeriesPoint[]>([]);
  const [oracleMetrics, setOracleMetrics] = useState<OracleMetrics | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('Connecting to Solver WebSocket:', SOLVER_WS_URL);

    const socket: Socket = io(SOLVER_WS_URL, {
      path: '/solver-ws',
      transports: ['polling', 'websocket'],
      timeout: 10000,
      forceNew: true,
      autoConnect: true,
    });

    socket.on('connect', () => {
      console.log('Connected to Solver WebSocket:', socket.id);
      setConnected(true);
      setLoading(false);
    });

    socket.on('disconnect', (reason) => {
      console.log('Disconnected from Solver WebSocket:', reason);
      setConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.error('Solver WebSocket connection error:', error);
      setConnected(false);
      setLoading(false);
    });

    // Listen for stats updates
    socket.on('stats', (data: SolverStats) => {
      setStats(data);
    });

    // Listen for auction history
    socket.on('auctionHistory', (data: AuctionMetrics[]) => {
      setRecentAuctions(data);
    });

    // Listen for new auction updates
    socket.on('auctionUpdate', (data: AuctionMetrics) => {
      setRecentAuctions(prev => [...prev.slice(-99), data]);
    });

    // Listen for time series data
    socket.on('timeSeries', (data: TimeSeriesPoint[]) => {
      setTimeSeries(data);
    });

    // Listen for time series updates
    socket.on('timeSeriesUpdate', (point: TimeSeriesPoint) => {
      setTimeSeries(prev => [...prev.slice(-499), point]);
    });

    // Listen for oracle metrics
    socket.on('oracleMetrics', (data: OracleMetrics) => {
      setOracleMetrics(data);
    });

    // Listen for metrics reset
    socket.on('metricsReset', () => {
      setStats(null);
      setRecentAuctions([]);
      setTimeSeries([]);
      setOracleMetrics(null);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return {
    stats,
    recentAuctions,
    timeSeries,
    oracleMetrics,
    connected,
    loading
  };
}
