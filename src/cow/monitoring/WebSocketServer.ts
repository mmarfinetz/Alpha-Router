import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import logger from '../../utils/logger';
import { solverMetrics, AuctionMetrics, TimeSeriesPoint } from './SolverMetrics';

/**
 * WebSocket server for streaming real-time solver metrics to frontend
 */
export class SolverWebSocketServer {
  private io: SocketIOServer;
  private connectedClients: Set<string> = new Set();
  private statsInterval?: NodeJS.Timeout;

  constructor(httpServer: HTTPServer) {
    // Initialize Socket.IO with CORS enabled
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: '*', // In production, restrict this to your frontend domain
        methods: ['GET', 'POST']
      },
      path: '/solver-ws'
    });

    this.setupEventHandlers();
    this.setupMetricsListeners();

    logger.info('SolverWebSocketServer initialized');
  }

  /**
   * Set up Socket.IO connection handlers
   */
  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      const clientId = socket.id;
      this.connectedClients.add(clientId);

      logger.info(`Client connected: ${clientId} (total: ${this.connectedClients.size})`);

      // Send initial state to new client
      this.sendInitialState(socket);

      // Handle client requests
      socket.on('requestStats', () => {
        this.sendStats(socket);
      });

      socket.on('requestAuctions', (limit: number = 50) => {
        this.sendRecentAuctions(socket, limit);
      });

      socket.on('requestTimeSeries', () => {
        this.sendTimeSeries(socket);
      });

      socket.on('exportMetrics', () => {
        const json = solverMetrics.exportToJSON();
        socket.emit('metricsExport', json);
      });

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        this.connectedClients.delete(clientId);
        logger.info(`Client disconnected: ${clientId} (reason: ${reason}, remaining: ${this.connectedClients.size})`);
      });
    });

    // Start periodic stats broadcast
    this.startStatsInterval();
  }

  /**
   * Set up listeners for solver metrics events
   */
  private setupMetricsListeners(): void {
    // Listen for new auctions
    solverMetrics.on('auction', (metrics: AuctionMetrics) => {
      this.broadcast('auctionUpdate', metrics);
    });

    // Listen for time series updates
    solverMetrics.on('timeseries', (point: TimeSeriesPoint) => {
      this.broadcast('timeSeriesUpdate', point);
    });

    // Listen for metrics reset
    solverMetrics.on('reset', () => {
      this.broadcast('metricsReset', {});
    });
  }

  /**
   * Send initial state to newly connected client
   */
  private sendInitialState(socket: Socket): void {
    try {
      // Send current stats
      const stats = solverMetrics.getStats();
      socket.emit('stats', stats);

      // Send recent auctions
      const recentAuctions = solverMetrics.getRecentAuctions(50);
      socket.emit('auctionHistory', recentAuctions);

      // Send time series data
      const timeSeries = solverMetrics.getTimeSeries();
      socket.emit('timeSeries', timeSeries);

      // Send oracle metrics
      const oracleMetrics = solverMetrics.getOracleMetrics();
      socket.emit('oracleMetrics', oracleMetrics);

      logger.debug(`Sent initial state to client ${socket.id}`);
    } catch (error) {
      logger.error('Error sending initial state', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Send current stats to a client
   */
  private sendStats(socket: Socket): void {
    const stats = solverMetrics.getStats();
    socket.emit('stats', stats);
  }

  /**
   * Send recent auctions to a client
   */
  private sendRecentAuctions(socket: Socket, limit: number): void {
    const auctions = solverMetrics.getRecentAuctions(limit);
    socket.emit('auctionHistory', auctions);
  }

  /**
   * Send time series data to a client
   */
  private sendTimeSeries(socket: Socket): void {
    const timeSeries = solverMetrics.getTimeSeries();
    socket.emit('timeSeries', timeSeries);
  }

  /**
   * Broadcast message to all connected clients
   */
  private broadcast(event: string, data: any): void {
    if (this.connectedClients.size > 0) {
      this.io.emit(event, data);
      logger.debug(`Broadcasted ${event} to ${this.connectedClients.size} clients`);
    }
  }

  /**
   * Start periodic stats broadcasting
   */
  private startStatsInterval(): void {
    // Broadcast full stats every 5 seconds
    this.statsInterval = setInterval(() => {
      if (this.connectedClients.size > 0) {
        const stats = solverMetrics.getStats();
        this.broadcast('stats', stats);

        const oracleMetrics = solverMetrics.getOracleMetrics();
        this.broadcast('oracleMetrics', oracleMetrics);
      }
    }, 5000);

    logger.debug('Started periodic stats broadcasting (5s interval)');
  }

  /**
   * Stop the WebSocket server
   */
  stop(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = undefined;
    }

    this.io.close();
    this.connectedClients.clear();

    logger.info('SolverWebSocketServer stopped');
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.connectedClients.size;
  }

  /**
   * Get server statistics
   */
  getServerStats() {
    return {
      connectedClients: this.connectedClients.size,
      metricsTracked: solverMetrics.getStats().totalAuctions,
      uptime: solverMetrics.getStats().uptime
    };
  }
}
