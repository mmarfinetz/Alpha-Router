import React from 'react';
import { Box, Typography } from '@mui/material';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions
} from 'chart.js';
import { useWebSocket } from '../hooks/useWebSocket';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const options: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false,
    },
    title: {
      display: false,
    },
  },
  scales: {
    x: {
      grid: {
        color: 'rgba(255, 255, 255, 0.1)',
      },
      ticks: {
        color: 'rgba(255, 255, 255, 0.7)',
      },
    },
    y: {
      grid: {
        color: 'rgba(255, 255, 255, 0.1)',
      },
      ticks: {
        color: 'rgba(255, 255, 255, 0.7)',
        callback: (value) => `${value} ETH`,
      },
    },
  },
};

interface ProfitDataPoint {
  timestamp: string;
  profit: number;
}

export const ProfitChart: React.FC = () => {
  const { profitData } = useWebSocket();

  const data = {
    labels: profitData.map((d: ProfitDataPoint) => d.timestamp),
    datasets: [
      {
        label: 'Profit (ETH)',
        data: profitData.map((d: ProfitDataPoint) => d.profit),
        borderColor: '#90caf9',
        backgroundColor: 'rgba(144, 202, 249, 0.5)',
        fill: true,
        tension: 0.4,
      },
    ],
  };

  const totalProfit = profitData.reduce((sum: number, d: ProfitDataPoint) => sum + d.profit, 0);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" component="div">
          Profit Chart
        </Typography>
        <Typography variant="h6" component="div" sx={{ color: 'primary.main' }}>
          Total: {totalProfit.toFixed(4)} ETH
        </Typography>
      </Box>
      <Box sx={{ height: 300 }}>
        <Line options={options} data={data} />
      </Box>
    </Box>
  );
}; 