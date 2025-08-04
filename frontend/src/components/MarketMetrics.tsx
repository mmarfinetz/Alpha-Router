import React from 'react';
import { Box, Typography, Grid } from '@mui/material';
import { useWebSocket } from '../hooks/useWebSocket';

export const MarketMetrics: React.FC = () => {
  const { marketMetrics } = useWebSocket();

  if (!marketMetrics) {
    return (
      <Box>
        <Typography variant="h6" gutterBottom>
          Market Metrics
        </Typography>
        <Typography color="text.secondary">
          Loading market metrics...
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Market Metrics
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={4}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h4" component="div">
              {marketMetrics.totalMarkets.toLocaleString()}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              Total Markets
            </Typography>
          </Box>
        </Grid>
        <Grid item xs={4}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h4" component="div">
              {marketMetrics.activeMarkets.toLocaleString()}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              Active Markets
            </Typography>
          </Box>
        </Grid>
        <Grid item xs={4}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h4" component="div">
              {marketMetrics.lastUpdate}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              Last Update
            </Typography>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}; 