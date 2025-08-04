import React from 'react';
import { Box, Typography, LinearProgress } from '@mui/material';
import { useWebSocket } from '../hooks/useWebSocket';

export const SystemStatus: React.FC = () => {
  const { systemStatus, connected } = useWebSocket();

  const formatUptime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  if (!systemStatus) {
    return (
      <Box>
        <Typography variant="h6" gutterBottom>
          System Status
        </Typography>
        <Typography color="text.secondary">
          Loading system status...
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        System Status
      </Typography>
      
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Connection Status
        </Typography>
        <Typography variant="body1" sx={{ color: connected ? 'success.main' : 'error.main' }}>
          {connected ? 'Connected' : 'Disconnected'}
        </Typography>
      </Box>

      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          CPU Usage
        </Typography>
        <LinearProgress 
          variant="determinate" 
          value={systemStatus.cpuUsage} 
          sx={{ 
            height: 10, 
            borderRadius: 5,
            backgroundColor: 'rgba(255,255,255,0.1)',
            '& .MuiLinearProgress-bar': {
              backgroundColor: systemStatus.cpuUsage > 80 ? 'error.main' : 'primary.main',
            },
          }}
        />
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {systemStatus.cpuUsage.toFixed(1)}%
        </Typography>
      </Box>

      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Memory Usage
        </Typography>
        <LinearProgress 
          variant="determinate" 
          value={systemStatus.memoryUsage} 
          sx={{ 
            height: 10, 
            borderRadius: 5,
            backgroundColor: 'rgba(255,255,255,0.1)',
            '& .MuiLinearProgress-bar': {
              backgroundColor: systemStatus.memoryUsage > 80 ? 'error.main' : 'primary.main',
            },
          }}
        />
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {systemStatus.memoryUsage.toFixed(1)}%
        </Typography>
      </Box>

      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Uptime
        </Typography>
        <Typography variant="body1">
          {formatUptime(systemStatus.uptime)}
        </Typography>
      </Box>

      <Box>
        <Typography variant="body2" color="text.secondary">
          Last Block
        </Typography>
        <Typography variant="body1">
          #{systemStatus.lastBlock.toLocaleString()}
        </Typography>
      </Box>
    </Box>
  );
}; 