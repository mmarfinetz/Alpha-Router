import React from 'react';
import {
  Box,
  Container,
  Grid,
  Paper,
  Typography,
  Alert,
  CircularProgress,
  Chip
} from '@mui/material';
import { useSolverMetrics } from '../hooks/useSolverMetrics';
import { AuctionFeed } from '../components/solver/AuctionFeed';
import { WinRateChart } from '../components/solver/WinRateChart';
import { SurplusMetrics } from '../components/solver/SurplusMetrics';
import { RouteBreakdown } from '../components/solver/RouteBreakdown';
import { PerformanceMetrics } from '../components/solver/PerformanceMetrics';
import { OracleHealth } from '../components/solver/OracleHealth';

export const CoWSolverDashboard: React.FC = () => {
  const { stats, recentAuctions, timeSeries, oracleMetrics, connected, loading } = useSolverMetrics();

  if (loading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
      >
        <CircularProgress size={60} />
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#0a1929', width: '100%', overflow: 'auto' }}>
      <Container maxWidth={false} sx={{ px: 3, py: 4 }}>
        {/* Header */}
        <Box sx={{ mb: 4 }}>
          <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
            <Typography variant="h4" component="h1" color="white" fontWeight="bold">
              🐮 CoW Protocol Solver Dashboard
            </Typography>
            <Chip
              label={connected ? 'Live' : 'Disconnected'}
              color={connected ? 'success' : 'error'}
              sx={{ fontSize: '1rem', height: 36 }}
            />
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Professional-grade monitoring for competitive solver performance
          </Typography>
        </Box>

        {/* Connection Warning */}
        {!connected && (
          <Alert severity="warning" sx={{ mb: 3 }}>
            WebSocket disconnected. Attempting to reconnect...
          </Alert>
        )}

        {/* Key Metrics Row */}
        <Grid container spacing={3} sx={{ mb: 3 }}>
          {/* Win Rate */}
          <Grid item xs={12} sm={6} md={3}>
            <Paper
              sx={{
                p: 3,
                background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
                color: 'white'
              }}
            >
              <Typography variant="body2" sx={{ opacity: 0.9, mb: 1 }}>
                Win Rate
              </Typography>
              <Typography variant="h3" fontWeight="bold">
                {stats ? `${stats.winRate.toFixed(1)}%` : '-'}
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.8 }}>
                {stats ? `${stats.auctionsWon}/${stats.solutionsSubmitted} auctions` : 'No data'}
              </Typography>
            </Paper>
          </Grid>

          {/* Total Surplus */}
          <Grid item xs={12} sm={6} md={3}>
            <Paper
              sx={{
                p: 3,
                background: 'linear-gradient(135deg, #15803d 0%, #22c55e 100%)',
                color: 'white'
              }}
            >
              <Typography variant="body2" sx={{ opacity: 0.9, mb: 1 }}>
                Total Surplus
              </Typography>
              <Typography variant="h3" fontWeight="bold">
                {stats ? parseFloat(stats.totalSurplusGenerated).toFixed(4) : '-'}
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.8 }}>
                ETH generated
              </Typography>
            </Paper>
          </Grid>

          {/* Solve Rate */}
          <Grid item xs={12} sm={6} md={3}>
            <Paper
              sx={{
                p: 3,
                background: 'linear-gradient(135deg, #7e22ce 0%, #a855f7 100%)',
                color: 'white'
              }}
            >
              <Typography variant="body2" sx={{ opacity: 0.9, mb: 1 }}>
                Solve Rate
              </Typography>
              <Typography variant="h3" fontWeight="bold">
                {stats
                  ? `${((stats.successfulSolves / stats.totalAuctions) * 100).toFixed(1)}%`
                  : '-'}
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.8 }}>
                {stats ? `${stats.successfulSolves}/${stats.totalAuctions} auctions` : 'No data'}
              </Typography>
            </Paper>
          </Grid>

          {/* Avg Solve Time */}
          <Grid item xs={12} sm={6} md={3}>
            <Paper
              sx={{
                p: 3,
                background: 'linear-gradient(135deg, #c2410c 0%, #f97316 100%)',
                color: 'white'
              }}
            >
              <Typography variant="body2" sx={{ opacity: 0.9, mb: 1 }}>
                Avg Solve Time
              </Typography>
              <Typography variant="h3" fontWeight="bold">
                {stats ? `${Math.round(stats.avgSolveTimeMs)}` : '-'}
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.8 }}>
                milliseconds
              </Typography>
            </Paper>
          </Grid>
        </Grid>

        {/* Main Content Grid */}
        <Grid container spacing={3}>
          {/* Win Rate Chart */}
          <Grid item xs={12} lg={8}>
            <Paper sx={{ p: 3, minHeight: 400, height: '100%' }}>
              <WinRateChart timeSeries={timeSeries} />
            </Paper>
          </Grid>

          {/* Surplus Metrics */}
          <Grid item xs={12} lg={4}>
            <Paper sx={{ p: 3, minHeight: 400, height: '100%' }}>
              <SurplusMetrics stats={stats} />
            </Paper>
          </Grid>

          {/* Performance Metrics */}
          <Grid item xs={12} lg={6}>
            <Paper sx={{ p: 3, minHeight: 350 }}>
              <PerformanceMetrics stats={stats} />
            </Paper>
          </Grid>

          {/* Oracle Health */}
          <Grid item xs={12} lg={6}>
            <Paper sx={{ p: 3, minHeight: 350 }}>
              <OracleHealth oracleMetrics={oracleMetrics} />
            </Paper>
          </Grid>

          {/* Route Breakdown */}
          <Grid item xs={12} lg={6}>
            <Paper sx={{ p: 3, minHeight: 400 }}>
              <RouteBreakdown stats={stats} />
            </Paper>
          </Grid>

          {/* Auction Feed */}
          <Grid item xs={12} lg={6}>
            <Paper sx={{ p: 3, minHeight: 400 }}>
              <AuctionFeed auctions={recentAuctions} />
            </Paper>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
};
