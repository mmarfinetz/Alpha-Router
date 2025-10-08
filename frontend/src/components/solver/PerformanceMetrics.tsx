import React from 'react';
import { Box, Typography, Grid, LinearProgress, Chip } from '@mui/material';
import SpeedIcon from '@mui/icons-material/Speed';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { SolverStats } from '../../hooks/useSolverMetrics';

interface PerformanceMetricsProps {
  stats: SolverStats | null;
}

export const PerformanceMetrics: React.FC<PerformanceMetricsProps> = ({ stats }) => {
  if (!stats) {
    return (
      <Box>
        <Typography variant="h6" gutterBottom>
          Performance Metrics
        </Typography>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 250,
            color: 'text.secondary',
          }}
        >
          <Typography>No data available</Typography>
        </Box>
      </Box>
    );
  }

  const solveRate = stats.totalAuctions > 0
    ? (stats.successfulSolves / stats.totalAuctions) * 100
    : 0;

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Performance Metrics
      </Typography>

      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid item xs={6}>
          <Box sx={{ p: 2, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Total Auctions
            </Typography>
            <Typography variant="h5" fontWeight="bold">
              {stats.totalAuctions}
            </Typography>
          </Box>
        </Grid>

        <Grid item xs={6}>
          <Box sx={{ p: 2, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Successful Solves
            </Typography>
            <Typography variant="h5" fontWeight="bold" color="success.main">
              {stats.successfulSolves}
            </Typography>
          </Box>
        </Grid>

        <Grid item xs={12}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Solve Rate: {solveRate.toFixed(1)}%
          </Typography>
          <LinearProgress
            variant="determinate"
            value={solveRate}
            sx={{
              height: 8,
              borderRadius: 4,
              bgcolor: 'rgba(255,255,255,0.1)',
              '& .MuiLinearProgress-bar': {
                bgcolor: solveRate > 80 ? 'success.main' : 'warning.main',
              },
            }}
          />
        </Grid>

        <Grid item xs={12} sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Solve Time Percentiles
          </Typography>
          <Box display="flex" gap={1} flexWrap="wrap">
            <Chip
              label={`P50: ${Math.round(stats.p50SolveTimeMs)}ms`}
              size="small"
              color="primary"
              variant="outlined"
            />
            <Chip
              label={`P95: ${Math.round(stats.p95SolveTimeMs)}ms`}
              size="small"
              color="primary"
              variant="outlined"
            />
            <Chip
              label={`P99: ${Math.round(stats.p99SolveTimeMs)}ms`}
              size="small"
              color="primary"
              variant="outlined"
            />
          </Box>
        </Grid>

        <Grid item xs={6}>
          <Box display="flex" alignItems="center" gap={1}>
            <CheckCircleIcon fontSize="small" color="success" />
            <Box>
              <Typography variant="caption" color="text.secondary">
                Success Rate
              </Typography>
              <Typography variant="body1" fontWeight="medium">
                {stats.totalAuctions > 0
                  ? ((stats.successfulSolves / stats.totalAuctions) * 100).toFixed(1)
                  : '0'}%
              </Typography>
            </Box>
          </Box>
        </Grid>

        <Grid item xs={6}>
          <Box display="flex" alignItems="center" gap={1}>
            <ErrorIcon fontSize="small" color="error" />
            <Box>
              <Typography variant="caption" color="text.secondary">
                Failures
              </Typography>
              <Typography variant="body1" fontWeight="medium">
                {stats.failedSolves}
              </Typography>
            </Box>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
};
