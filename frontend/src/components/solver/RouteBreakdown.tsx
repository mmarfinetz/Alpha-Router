import React from 'react';
import { Box, Typography, Chip } from '@mui/material';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { SolverStats } from '../../hooks/useSolverMetrics';

ChartJS.register(ArcElement, Tooltip, Legend);

interface RouteBreakdownProps {
  stats: SolverStats | null;
}

const PROTOCOL_COLORS: { [key: string]: string } = {
  'Uniswap V2': '#FF007A',
  'Balancer V2': '#1E1E1E',
  'Curve': '#FF0000',
  'Kyber DMM': '#31CB9E',
  'DODO V2': '#FFE804',
  'CoW Matches': '#65D9FF',
};

export const RouteBreakdown: React.FC<RouteBreakdownProps> = ({ stats }) => {
  if (!stats) {
    return (
      <Box>
        <Typography variant="h6" gutterBottom>
          Route Breakdown
        </Typography>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 300,
            color: 'text.secondary',
          }}
        >
          <Typography>No routing data available</Typography>
        </Box>
      </Box>
    );
  }

  // Combine protocol usage with CoW matches
  const protocolData: Record<string, number> = {
    ...stats.protocolUsage,
    'CoW Matches': stats.totalCoWMatches,
  };

  const labels = Object.keys(protocolData).filter(key => protocolData[key] > 0);
  const values = labels.map(label => protocolData[label]);

  if (labels.length === 0) {
    return (
      <Box>
        <Typography variant="h6" gutterBottom>
          Route Breakdown
        </Typography>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 300,
            color: 'text.secondary',
          }}
        >
          <Typography>No routes found yet</Typography>
        </Box>
      </Box>
    );
  }

  const colors = labels.map(label => PROTOCOL_COLORS[label] || '#999999');

  const data = {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: colors,
        borderColor: 'rgba(0, 0, 0, 0.8)',
        borderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: 'white',
        bodyColor: 'white',
        borderColor: 'rgba(255, 255, 255, 0.2)',
        borderWidth: 1,
        padding: 12,
        callbacks: {
          label: (context: any) => {
            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
            const percentage = ((context.parsed / total) * 100).toFixed(1);
            return `${context.label}: ${context.parsed} (${percentage}%)`;
          },
        },
      },
    },
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Route Breakdown
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Protocol utilization
      </Typography>

      <Box sx={{ height: 200, display: 'flex', justifyContent: 'center', mb: 2 }}>
        <Doughnut data={data} options={options} />
      </Box>

      <Box display="flex" flexWrap="wrap" gap={1} justifyContent="center">
        {labels.map((label, index) => {
          const percentage = ((values[index] / values.reduce((a, b) => a + b, 0)) * 100).toFixed(1);
          return (
            <Chip
              key={label}
              label={`${label}: ${values[index]} (${percentage}%)`}
              size="small"
              sx={{
                bgcolor: colors[index],
                color: 'white',
                fontWeight: 'medium',
                '&:hover': {
                  bgcolor: colors[index],
                  opacity: 0.8,
                },
              }}
            />
          );
        })}
      </Box>

      <Box sx={{ mt: 3, p: 2, bgcolor: 'rgba(255,255,255,0.05)', borderRadius: 1 }}>
        <Typography variant="caption" color="text.secondary" display="block">
          Avg Routes per Auction
        </Typography>
        <Typography variant="h6" fontWeight="medium">
          {stats.avgRoutesPerAuction.toFixed(2)}
        </Typography>

        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          Total Liquidity Routes
        </Typography>
        <Typography variant="h6" fontWeight="medium">
          {stats.totalLiquidityRoutes}
        </Typography>
      </Box>
    </Box>
  );
};
