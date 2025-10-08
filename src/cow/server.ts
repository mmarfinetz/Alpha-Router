import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { createServer, Server as HTTPServer } from 'http';
import { ethers } from 'ethers';
import { CoWAdapter } from './CoWAdapter';
import logger from '../utils/logger';
import { CoWAuction, SolverResponse } from './types';
import { SolverWebSocketServer } from './monitoring/WebSocketServer';

export class CoWSolverServer {
  private app: express.Application;
  private httpServer: HTTPServer;
  private wsServer: SolverWebSocketServer;
  private adapter: CoWAdapter;
  private port: number;

  constructor(
    provider: ethers.providers.Provider,
    wallet: ethers.Wallet,
    bundleExecutorAddress: string,
    port: number = 8000
  ) {
    this.port = port;
    this.app = express();

    // Create HTTP server
    this.httpServer = createServer(this.app);

    // Trust Railway proxy for rate limiting
    this.app.set('trust proxy', 1);

    this.setupMiddleware();

    // Create bundle executor contract instance for advanced routing
    const bundleExecutorContract = new ethers.Contract(
      bundleExecutorAddress,
      ['function uniswapWeth(uint256 amountToFirstMarket, uint256 minAmountOut, address[] calldata targets, bytes[] calldata data) external payable'],
      wallet
    );

    // Create the adapter with advanced routing enabled (pass wallet + executor)
    this.adapter = new CoWAdapter(provider, wallet, bundleExecutorContract);

    logger.info('CoWSolverServer initialized', {
      port,
      walletAddress: wallet.address,
      bundleExecutor: bundleExecutorAddress,
      advancedRouting: true
    });

    this.setupRoutes();

    // Initialize WebSocket server for real-time metrics
    this.wsServer = new SolverWebSocketServer(this.httpServer);
    logger.info('WebSocket server initialized for real-time metrics streaming');
  }

  private setupMiddleware() {
    this.app.use(express.json({ limit: '10mb' }));

    // Rate limiting - prevent DoS
    const limiter = rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 100, // 100 requests per minute
      message: { error: 'Too many requests, please try again later' }
    });
    this.app.use(limiter);

    // CORS for development
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      next();
    });

    // Request logging
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes() {
    // Main solver endpoint
    this.app.post('/solve', async (req: Request, res: Response) => {
      const TIMEOUT_MS = 10000; // 10 second timeout
      const startTime = Date.now();
      
      try {
        const auction: CoWAuction = req.body;

        // Validate auction
        if (!auction.id || !auction.orders || !auction.liquidity) {
          return res.status(400).json({
            error: 'Invalid auction format',
            solutions: []
          });
        }

        // Create timeout promise
        const timeoutPromise = new Promise<SolverResponse>((_, reject) => {
          setTimeout(() => reject(new Error('Solver timeout')), TIMEOUT_MS);
        });

        // Race between solve and timeout
        const result = await Promise.race([
          this.adapter.solve(auction),
          timeoutPromise
        ]);

        const elapsed = Date.now() - startTime;
        logger.info(`Solved auction ${auction.id} in ${elapsed}ms`);
        
        res.json(result);

      } catch (error: any) {
        const elapsed = Date.now() - startTime;
        
        if (error.message === 'Solver timeout') {
          logger.warn(`Solver timeout after ${elapsed}ms`);
          return res.status(408).json({
            error: 'Request timeout',
            solutions: []
          });
        }
        
        logger.error('Error in /solve endpoint:', error);
        res.status(500).json({
          error: error.message,
          solutions: []
        });
      }
    });

    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      const stats = this.adapter.getStats();
      res.json({
        status: 'alive',
        ...stats,
        timestamp: new Date().toISOString()
      });
    });

    // Metrics endpoint
    this.app.get('/metrics', (req: Request, res: Response) => {
      const stats = this.adapter.getStats();
      res.json(stats);
    });

    // WebSocket status endpoint
    this.app.get('/ws-status', (req: Request, res: Response) => {
      const wsStats = this.wsServer.getServerStats();
      res.json({
        ...wsStats,
        websocketPath: '/solver-ws'
      });
    });

    // Root endpoint
    this.app.get('/', (req: Request, res: Response) => {
      res.json({
        name: 'AlphaRouter',
        version: '1.0.0',
        endpoints: {
          solve: 'POST /solve',
          health: 'GET /health',
          metrics: 'GET /metrics'
        }
      });
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
      this.httpServer.listen(this.port, host, () => {
        logger.info(`🐮 CoW Protocol Solver running on http://${host}:${this.port}`);
        logger.info(`📊 Health check: http://${host}:${this.port}/health`);
        logger.info(`🎯 Solve endpoint: http://${host}:${this.port}/solve`);
        logger.info(`📈 Metrics: http://${host}:${this.port}/metrics`);
        logger.info(`🔌 WebSocket: ws://${host}:${this.port}/solver-ws`);
        resolve();
      });
    });
  }

  /**
   * Stop the server gracefully
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.wsServer.stop();
      this.httpServer.close(() => {
        logger.info('CoWSolverServer stopped');
        resolve();
      });
    });
  }
}