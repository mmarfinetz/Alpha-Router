import React from 'react';
import { Box, Typography } from '@mui/material';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { TimeSeriesPoint } from '../../hooks/useSolverMetrics';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface WinRateChartProps {
  timeSeries: TimeSeriesPoint[];
}

export const WinRateChart: React.FC<WinRateChartProps> = ({ timeSeries }) => {
  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const data = {
    labels: timeSeries.map(point => formatTime(point.timestamp)),
    datasets: [
      {
        label: 'Win Rate (%)',
        data: timeSeries.map(point => point.winRate),
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 6,
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
        borderColor: 'rgb(59, 130, 246)',
        borderWidth: 1,
        padding: 12,
        displayColors: false,
        callbacks: {
          label: (context: any) => {
            return `Win Rate: ${context.parsed.y.toFixed(1)}%`;
          },
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: {
          display: false,
        },
        ticks: {
          color: 'rgba(255, 255, 255, 0.5)',
          maxTicksLimit: 10,
        },
      },
      y: {
        display: true,
        grid: {
          color: 'rgba(255, 255, 255, 0.1)',
        },
        ticks: {
          color: 'rgba(255, 255, 255, 0.5)',
          callback: (value: any) => `${value}%`,
        },
        min: 0,
        max: 100,
      },
    },
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Win Rate Trend
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Your competitive performance over time
      </Typography>

      {timeSeries.length === 0 ? (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 280,
            color: 'text.secondary',
          }}
        >
          <Typography>Collecting data...</Typography>
        </Box>
      ) : (
        <Box sx={{ height: 280 }}>
          <Line data={data} options={options} />
        </Box>
      )}
    </Box>
  );
};
