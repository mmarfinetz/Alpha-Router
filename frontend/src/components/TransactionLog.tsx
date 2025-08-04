import React from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip
} from '@mui/material';
import { useWebSocket } from '../hooks/useWebSocket';

const getStatusColor = (status: string) => {
  switch (status.toLowerCase()) {
    case 'success':
      return 'success';
    case 'pending':
      return 'warning';
    case 'failed':
      return 'error';
    default:
      return 'default';
  }
};

export const TransactionLog: React.FC = () => {
  const { transactions } = useWebSocket();

  return (
    <Box>
      <Typography variant="h6" gutterBottom component="div">
        Transaction Log
      </Typography>
      <TableContainer component={Paper} sx={{ maxHeight: 300 }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell>Time</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Hash</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Profit</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {transactions.map((tx) => (
              <TableRow key={tx.hash} hover>
                <TableCell>{tx.timestamp}</TableCell>
                <TableCell>
                  <Chip
                    label={tx.type}
                    size="small"
                    sx={{ 
                      backgroundColor: 'rgba(144, 202, 249, 0.2)',
                      color: 'primary.light',
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {`${tx.hash.substring(0, 6)}...${tx.hash.substring(tx.hash.length - 4)}`}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    label={tx.status}
                    size="small"
                    color={getStatusColor(tx.status) as any}
                    variant="outlined"
                  />
                </TableCell>
                <TableCell align="right">
                  {tx.profit ? (
                    <Typography
                      variant="body2"
                      sx={{ 
                        color: parseFloat(tx.profit) >= 0 ? 'success.main' : 'error.main',
                        fontWeight: 'bold',
                      }}
                    >
                      {parseFloat(tx.profit) >= 0 ? '+' : ''}{tx.profit} ETH
                    </Typography>
                  ) : '-'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}; 