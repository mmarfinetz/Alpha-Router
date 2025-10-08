import React from 'react';
import { Box, Typography, LinearProgress, Alert } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import { OracleMetrics } from '../../hooks/useSolverMetrics';

interface OracleHealthProps {
  oracleMetrics: OracleMetrics | null;
}

export const OracleHealth: React.FC<OracleHealthProps> = ({ oracleMetrics }) => {
  if (!oracleMetrics) {
    return (
      <Box>
        <Typography variant="h6" gutterBottom>
          Oracle Health
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
          <Typography>No oracle data available</Typography>
        </Box>
      </Box>
    );
  }

  const successRate = oracleMetrics.totalRequests > 0
    ? (oracleMetrics.successfulRequests / oracleMetrics.totalRequests) * 100
    : 0;

  const fallbackRate = oracleMetrics.totalRequests > 0
    ? (oracleMetrics.fallbackUsed / oracleMetrics.totalRequests) * 100
    : 0;

  const isHealthy = successRate >= 95 && fallbackRate < 10;

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Oracle Health
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Price feed reliability
      </Typography>

      {!isHealthy && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {successRate < 95 && 'Oracle success rate below 95%. '}
          {fallbackRate >= 10 && 'High fallback usage detected.'}
        </Alert>
      )}

      <Box sx={{ mb: 3 }}>
        <Box display="flex" alignItems="center" gap={1} sx={{ mb: 1 }}>
          {successRate >= 95 ? (
            <CheckCircleIcon fontSize="small" color="success" />
          ) : (
            <WarningIcon fontSize="small" color="warning" />
          )}
          <Typography variant="body2">
            Success Rate: {successRate.toFixed(1)}%
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={successRate}
          sx={{
            height: 8,
            borderRadius: 4,
            bgcolor: 'rgba(255,255,255,0.1)',
            '& .MuiLinearProgress-bar': {
              bgcolor: successRate >= 95 ? 'success.main' : 'warning.main',
            },
          }}
        />
      </Box>

      <Box sx={{ mb: 3 }}>
        <Box display="flex" alignItems="center" gap={1} sx={{ mb: 1 }}>
          {fallbackRate < 10 ? (
            <CheckCircleIcon fontSize="small" color="success" />
          ) : (
            <WarningIcon fontSize="small" color="warning" />
          )}
          <Typography variant="body2">
            Fallback Usage: {fallbackRate.toFixed(1)}%
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={fallbackRate}
          sx={{
            height: 8,
            borderRadius: 4,
            bgcolor: 'rgba(255,255,255,0.1)',
            '& .MuiLinearProgress-bar': {
              bgcolor: fallbackRate < 10 ? 'success.main' : 'warning.main',
            },
          }}
        />
      </Box>

      <Box sx={{ p: 2, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 1 }}>
        <Typography variant="caption" color="text.secondary" display="block">
          Total Requests
        </Typography>
        <Typography variant="h6" fontWeight="medium">
          {oracleMetrics.totalRequests}
        </Typography>

        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
          Avg Latency
        </Typography>
        <Typography variant="h6" fontWeight="medium">
          {Math.round(oracleMetrics.avgLatencyMs)}ms
        </Typography>
      </Box>
    </Box>
  );
};
