const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Server } = require('socket.io');
const os = require('os');
const { ethers } = require('ethers');
const fs = require('fs');
const express = require('express');
const http = require('http');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true
});

// Log connection attempts with better formatting
io.engine.on("connection_error", (err) => {
  console.log('=== Socket.IO Connection Error ===');
  console.log('Error code:', err.code);
  console.log('Error message:', err.message);
  console.log('Error context:', err.context);
  console.log('Request URL:', err.req?.url);
  console.log('Request headers:', err.req?.headers);
  console.log('================================');
});

// Store connected clients
let connectedClients = new Set();

// This handler is replaced by the one below

// Function to broadcast updates to all connected clients
const broadcastUpdate = (eventName, data) => {
  connectedClients.forEach(socket => {
    socket.emit(eventName, data);
  });
};

// Add POST endpoint to receive updates from the bot
app.post('/update', (req, res) => {
  const { eventName, data } = req.body;
  if (!eventName || !data) {
    return res.status(400).json({ error: 'Missing eventName or data' });
  }
  
  // Broadcast the update to all connected clients
  broadcastUpdate(eventName, data);
  
  res.json({ success: true });
});

// Expose broadcast function
app.broadcastUpdate = broadcastUpdate;

// Initialize Ethereum provider
let provider;
try {
  if (process.env.ETHEREUM_WS_URL) {
    provider = new ethers.providers.WebSocketProvider(process.env.ETHEREUM_WS_URL);
    console.log('Connected to Ethereum WebSocket provider');
  } else {
    console.log('No ETHEREUM_WS_URL provided. Block updates will be disabled.');
  }
} catch (error) {
  console.error('Failed to connect to Ethereum WebSocket provider:', error.message);
  console.log('Block updates will be disabled.');
}

// Track active markets and transactions
let activeMarkets = new Map();
let transactions = new Map();
let profitHistory = [];
let lastMarketUpdate = new Date().toLocaleTimeString();
let totalMarketsCount = 0;
let activeMarketsCount = 0;

// Function to get real system status
function getSystemStatus() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  
  const cpuUsage = cpus.reduce((acc, cpu) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b);
    const idle = cpu.times.idle;
    return acc + ((total - idle) / total) * 100;
  }, 0) / cpus.length;

  return {
    cpuUsage: Math.round(cpuUsage * 10) / 10,
    memoryUsage: Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10,
    uptime: Math.floor(os.uptime()),
    lastBlock: 0  // Will be updated by block listener
  };
}

// Function to parse market updates from bot output
function updateMarketMetrics(line) {
  try {
    // Try to parse as JSON first
    const logData = JSON.parse(line);
    
    // Handle different types of log data
    if (logData.message && logData.message.includes('Memory usage')) {
      // Bot is alive, update timestamp
      lastMarketUpdate = new Date().toLocaleTimeString();
      
      // Emit heartbeat to show bot is active
      io.emit('systemStatus', getSystemStatus());
      return;
    }
    
    // Look for market-related data
    if (logData.totalMarkets !== undefined) {
      totalMarketsCount = logData.totalMarkets;
    }
    
    if (logData.count !== undefined && logData.message && logData.message.includes('markets')) {
      activeMarketsCount = logData.count;
    }
    
    // Look for thresholds information
    if (logData.thresholds) {
      console.log('Found market thresholds:', logData.thresholds);
    }
    
    // Update timestamp for any market-related activity
    if (logData.totalMarkets !== undefined || logData.count !== undefined) {
      lastMarketUpdate = new Date().toLocaleTimeString();
      
      // Emit updated metrics to all connected clients
      io.emit('marketMetrics', {
        totalMarkets: totalMarketsCount,
        activeMarkets: activeMarketsCount,
        lastUpdate: lastMarketUpdate
      });
    }
    
  } catch (e) {
    // If not JSON, try regex patterns on the raw line
    const totalMarketsMatch = line.match(/Updating reserves for (\d+) markets/);
    if (totalMarketsMatch) {
      totalMarketsCount = parseInt(totalMarketsMatch[1]);
    }

    const activeMarketsMatch = line.match(/Filtered pairs for arbitrage calculation: (\d+)/);
    if (activeMarketsMatch) {
      activeMarketsCount = parseInt(activeMarketsMatch[1]);
    }

    if (totalMarketsMatch || activeMarketsMatch) {
      lastMarketUpdate = new Date().toLocaleTimeString();
      
      io.emit('marketMetrics', {
        totalMarkets: totalMarketsCount,
        activeMarkets: activeMarketsCount,
        lastUpdate: lastMarketUpdate
      });
    }
  }
}

// Watch bot log file for updates
function watchBotLog() {
  const logPath = path.join(__dirname, '..', 'output.log');
  
  // Create file if it doesn't exist
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, '');
  }

  // Watch for changes
  fs.watchFile(logPath, { interval: 1000 }, (curr, prev) => {
    if (curr.size > prev.size) {
      const buffer = Buffer.alloc(curr.size - prev.size);
      const fd = fs.openSync(logPath, 'r');
      fs.readSync(fd, buffer, 0, buffer.length, prev.size);
      fs.closeSync(fd);
      
      const newLines = buffer.toString().split('\n');
      newLines.forEach(line => {
        if (line.trim()) {
          updateMarketMetrics(line);
        }
      });
    }
  });
}

// Function to parse bot logs
function parseBotLogs() {
  try {
    const logPath = path.join(__dirname, '..', 'combined.log');
    if (!fs.existsSync(logPath)) {
      console.log('No combined.log file found. Will create when bot starts logging.');
      return;
    }
    
    // Get file stats to check size
    const stats = fs.statSync(logPath);
    const fileSizeInMB = stats.size / (1024 * 1024);
    
    let logs;
    if (fileSizeInMB > 100) {
      // For large files, read only the last part
      console.log(`Log file is ${fileSizeInMB.toFixed(2)}MB, reading tail only...`);
      const fileDescriptor = fs.openSync(logPath, 'r');
      const bufferSize = 1024 * 1024; // 1MB buffer
      const buffer = Buffer.alloc(bufferSize);
      const position = Math.max(0, stats.size - bufferSize);
      fs.readSync(fileDescriptor, buffer, 0, bufferSize, position);
      fs.closeSync(fileDescriptor);
      logs = buffer.toString('utf8').split('\n');
    } else {
      logs = fs.readFileSync(logPath, 'utf8').split('\n');
    }
    
    // Process last 1000 lines at most
    const recentLogs = logs.slice(-1000);
    
    recentLogs.forEach(line => {
      if (!line.trim()) return;
      
      // Update market metrics from log lines
      updateMarketMetrics(line);
      
      try {
        // Skip lines that don't look like JSON
        if (!line.startsWith('{')) return;
        
        const log = JSON.parse(line);
        
        // Handle different log types
        switch (log.type) {
          case 'MARKET_UPDATE':
            lastMarketUpdate = new Date().toLocaleTimeString();
            break;
          
          case 'TRANSACTION':
            transactions.set(log.hash, {
              hash: log.hash,
              type: log.transactionType,
              timestamp: new Date(log.timestamp).toLocaleTimeString(),
              status: log.status,
              profit: log.profit?.toString() || '0'
            });
            
            if (log.profit) {
              profitHistory.push({
                timestamp: new Date(log.timestamp).toLocaleTimeString(),
                profit: parseFloat(ethers.utils.formatEther(log.profit))
              });
            }
            break;
        }
      } catch (e) {
        // Silently skip invalid JSON lines
        return;
      }
    });
  } catch (e) {
    console.error('Error reading bot logs:', e);
  }
}

// Initialize data on startup
parseBotLogs();

// Watch for new bot log entries
const logWatcher = fs.watch(path.join(__dirname, '..', 'combined.log'), (eventType) => {
  if (eventType === 'change') {
    parseBotLogs();
  }
});

// Initialize WebSocket connections
io.on('connection', (socket) => {
  console.log(`=== New Client Connected ===`);
  console.log(`Socket ID: ${socket.id}`);
  console.log(`Client IP: ${socket.handshake.address}`);
  console.log(`Transport: ${socket.conn.transport.name}`);
  console.log(`Total connected clients: ${connectedClients.size + 1}`);
  console.log(`============================`);
  
  connectedClients.add(socket);
  
  // Send initial data immediately
  socket.emit('systemStatus', getSystemStatus());
  socket.emit('marketMetrics', {
    totalMarkets: totalMarketsCount,
    activeMarkets: activeMarketsCount,
    lastUpdate: lastMarketUpdate
  });
  
  // Send any existing transaction data
  const transactionArray = Array.from(transactions.values());
  transactionArray.forEach(tx => {
    socket.emit('transaction', tx);
  });
  
  // Send any existing profit data
  profitHistory.forEach(profit => {
    socket.emit('profit', profit);
  });
  
  // Set up periodic updates
  const statusInterval = setInterval(() => {
    socket.emit('systemStatus', getSystemStatus());
  }, 1000);
  
  socket.on('disconnect', (reason) => {
    clearInterval(statusInterval);
    connectedClients.delete(socket);
    console.log(`Client disconnected: ${socket.id}, reason: ${reason}`);
  });

  socket.on('error', (error) => {
    console.log(`Socket error: ${error}`);
  });
});

// Start watching bot log
watchBotLog();

// Cleanup on exit
process.on('SIGINT', () => {
  logWatcher.close();
  if (provider) {
    provider.removeAllListeners();
  }
  process.exit();
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, broadcastUpdate }; 