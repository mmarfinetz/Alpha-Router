import React from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  Chip,
  Divider
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import PendingIcon from '@mui/icons-material/Pending';
import { AuctionMetrics } from '../../hooks/useSolverMetrics';

interface AuctionFeedProps {
  auctions: AuctionMetrics[];
}

export const AuctionFeed: React.FC<AuctionFeedProps> = ({ auctions }) => {
  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  const formatAuctionId = (id: string): string => {
    return id.length > 12 ? `${id.slice(0, 6)}...${id.slice(-6)}` : id;
  };

  const getStatusIcon = (auction: AuctionMetrics) => {
    if (!auction.success) {
      return <ErrorIcon sx={{ color: 'error.main', fontSize: 20 }} />;
    }
    if (auction.solutionFound) {
      return <CheckCircleIcon sx={{ color: 'success.main', fontSize: 20 }} />;
    }
    return <PendingIcon sx={{ color: 'warning.main', fontSize: 20 }} />;
  };

  const getStatusColor = (auction: AuctionMetrics): 'success' | 'error' | 'warning' | 'default' => {
    if (!auction.success) return 'error';
    if (auction.solutionFound) return 'success';
    return 'warning';
  };

  const getStatusLabel = (auction: AuctionMetrics): string => {
    if (!auction.success) return 'Failed';
    if (auction.won) return 'Won';
    if (auction.submitted) return 'Submitted';
    if (auction.solutionFound) return 'Solved';
    return 'No Solution';
  };

  const recentAuctions = [...auctions].reverse().slice(0, 20);

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Live Auction Feed
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Recent auction activity (latest 20)
      </Typography>

      {recentAuctions.length === 0 ? (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 280,
            color: 'text.secondary'
          }}
        >
          <Typography>Waiting for auctions...</Typography>
        </Box>
      ) : (
        <List
          sx={{
            maxHeight: 280,
            overflow: 'auto',
            '&::-webkit-scrollbar': {
              width: '8px',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: 'rgba(255,255,255,0.2)',
              borderRadius: '4px',
            },
          }}
        >
          {recentAuctions.map((auction, index) => (
            <React.Fragment key={auction.auctionId}>
              <ListItem
                sx={{
                  px: 1,
                  py: 1.5,
                  '&:hover': {
                    bgcolor: 'rgba(255,255,255,0.05)',
                  },
                }}
              >
                <Box sx={{ mr: 1 }}>{getStatusIcon(auction)}</Box>
                <ListItemText
                  primary={
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography variant="body2" fontWeight="medium">
                        {formatAuctionId(auction.auctionId)}
                      </Typography>
                      <Chip
                        label={getStatusLabel(auction)}
                        size="small"
                        color={getStatusColor(auction)}
                        sx={{ height: 20, fontSize: '0.7rem' }}
                      />
                    </Box>
                  }
                  secondary={
                    <Box sx={{ mt: 0.5 }}>
                      <Typography variant="caption" color="text.secondary">
                        {formatTime(auction.timestamp)} • {auction.orderCount} orders •{' '}
                        {auction.solveTimeMs}ms
                        {auction.surplus && ` • ${parseFloat(auction.surplus).toFixed(4)} ETH`}
                      </Typography>
                      {auction.error && (
                        <Typography
                          variant="caption"
                          color="error.main"
                          display="block"
                          sx={{ mt: 0.5 }}
                        >
                          Error: {auction.error}
                        </Typography>
                      )}
                    </Box>
                  }
                />
              </ListItem>
              {index < recentAuctions.length - 1 && <Divider />}
            </React.Fragment>
          ))}
        </List>
      )}
    </Box>
  );
};
