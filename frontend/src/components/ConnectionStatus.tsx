import React from 'react';
import { Box, Typography } from '@mui/material';
import { useWebSocket } from '../hooks/useWebSocket';

export const ConnectionStatus: React.FC = () => {
  const { connected } = useWebSocket();

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box
        sx={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          backgroundColor: connected ? 'success.main' : 'error.main',
        }}
      />
      <Typography variant="body2" color="text.secondary">
        {connected ? 'Connected' : 'Disconnected'}
      </Typography>
    </Box>
  );
}; 