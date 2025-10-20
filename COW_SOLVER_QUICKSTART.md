# CoW Protocol Solver - Quick Start Guide

This repository implements a **genetic algorithm-based solver for CoW Protocol** that maximizes user surplus through multi-objective optimization across heterogeneous DEXs.

## What This Is

This is **NOT** an MEV extraction bot. This is a **CoW Protocol solver** that:

✅ Maximizes user surplus (users get more tokens)  
✅ Competes in solver auctions to provide best execution  
✅ Uses multi-objective GA to optimize across surplus, gas, slippage, and risk  
✅ Splits flow across multiple DEX paths to reduce price impact  

**Key Point:** You're **delivering value TO users**, not extracting it from them.

## Quick Start

### 1. Build and Test Locally

```bash
# Install dependencies
npm install

# Build the solver
npm run build

# Start the solver
node build/cow/index.js
```

You should see:
```
🐮 CoW Protocol Solver running on http://localhost:8000
📊 Health check: http://localhost:8000/health
🎯 Solve endpoint: http://localhost:8000/solve
```

### 2. Test the Solver

```bash
# Quick health check
curl http://localhost:8000/health

# Or run the full test suite
./scripts/cow/test-solver.sh
```

### 3. Test with Real CoW Order Flow

To test against production CoW Protocol auctions:

```bash
# Set your RPC endpoint
export NODE_URL="https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"

# Run the setup script
./scripts/cow/test-local.sh
```

Then follow the instructions to start:
1. **Your solver** (Terminal 1)
2. **CoW Driver** (Terminal 2) 
3. **CoW Autopilot** (Terminal 3)

**Full documentation:** See [docs/COW_LOCAL_TESTING.md](docs/COW_LOCAL_TESTING.md)

## How It Works

### Architecture

```
User Orders → CoW Orderbook → Autopilot (creates auctions)
                                     ↓
                                  Driver (dispatches to solvers)
                                     ↓
                           Your GA Solver (finds best routes)
                                     ↓
                           Settlement (executes on-chain)
```

### The Algorithm

Your solver uses a **hybrid genetic algorithm** that:

1. **Encodes** execution paths as chromosomes with:
   - Variable-length path sets (e.g., 3 different routes)
   - Continuous split ratios (e.g., 40% path A, 35% path B, 25% path C)

2. **Optimizes** using NSGA-II multi-objective evolution:
   - Objective 1: Maximize user surplus (more tokens out)
   - Objective 2: Minimize gas cost
   - Objective 3: Minimize slippage
   - Objective 4: Minimize execution risk

3. **Converges** in ~500ms with adaptive control:
   - Simple orders → deterministic baseline
   - Complex fragmented liquidity → GA search
   - Never worse than baseline (fallback guarantee)

4. **Returns** Pareto-optimal solutions:
   - Multiple trade-offs on the efficient frontier
   - Driver selects best solution for the auction

**Full details:** See [docs/hybrid_ga_mev_arxiv.pdf](docs/hybrid_ga_mev_arxiv.pdf)

## Project Structure

```
src/cow/
├── index.ts                    # Entry point
├── server.ts                   # HTTP server (/solve endpoint)
├── CoWAdapter.ts               # Converts CoW auctions → optimization problems
├── OrderSettlementEngine.ts    # Settlement logic
├── routing/
│   └── RouteSplitter.ts        # Multi-path routing
├── oracles/
│   ├── OracleManager.ts        # Price feeds
│   └── OneInchOracle.ts        # 1inch integration
└── monitoring/
    ├── SolverMetrics.ts        # Performance metrics
    └── WebSocketServer.ts      # Real-time monitoring

src/engines/
├── GeneticRouterEngine.ts      # NSGA-II implementation
├── HybridGAEngine.ts           # Adaptive solver selection
├── DualDecompositionOptimizer.ts # Deterministic baseline
└── DeterministicSplitOptimizer.ts # Simple split routing

scripts/cow/
├── test-local.sh               # Setup local testing environment
├── test-solver.sh              # Quick solver test
└── driver.config.toml          # Driver configuration

docs/
├── COW_LOCAL_TESTING.md        # Full local testing guide
└── hybrid_ga_mev_arxiv.pdf     # Research paper
```

## Environment Variables

### Required

```bash
ETHEREUM_RPC_URL=https://...   # Your RPC endpoint
PRIVATE_KEY=0x...              # Wallet for signing (not for executing trades in shadow mode)
```

### Optional

```bash
COW_SOLVER_PORT=8000           # Solver port (default: 8000)
NODE_ENV=production            # Environment
CHAIN_ID=1                     # Network (1=mainnet, 42161=arbitrum, etc.)
```

## Testing Modes

### 1. Standalone Testing (Fast)
```bash
node build/cow/index.js
./scripts/cow/test-solver.sh
```
Tests your solver in isolation with mock data.

### 2. Shadow Testing (Realistic)
```bash
./scripts/cow/test-local.sh
```
Tests against real production orderflow, but **no trades execute** (paper trading only).

### 3. Production Deployment
Deploy to Railway/Render and register with CoW Protocol solver registry.

## Performance Tuning

### GA Parameters

Edit `src/engines/GeneticRouterEngine.ts`:

```typescript
// Population size (higher = better solutions, slower)
populationSize: 64,  // Try 32 for faster, 128 for better quality

// Max generations (higher = more convergence time)
maxGenerations: 100,  // Try 50 for 2x faster

// Mutation rate (higher = more exploration)
mutationRate: 0.15,  // Try 0.1-0.3
```

### Time Budget

Edit `src/engines/HybridGAEngine.ts`:

```typescript
// Max solver time
const MAX_SOLVE_TIME = 2000;  // 2 seconds for real-time auctions
```

### RPC Optimization

- Use multicall for batch liquidity fetching
- Cache pool reserves (update only on events)
- Use fallback providers for redundancy

## Monitoring

### HTTP Metrics
```bash
curl http://localhost:8000/metrics | jq
```

Returns:
```json
{
  "auctionsSolved": 42,
  "totalSolutions": 156,
  "avgSolveTime": 487,
  "avgUserSurplus": "1.2 ETH",
  "paretoFrontSize": 6.4,
  "gaConvergenceRate": 0.95
}
```

### WebSocket Stream
```bash
wscat -c ws://localhost:8000/metrics
```

Real-time updates on every auction.

### Logs
```bash
tail -f logs/solver.log
```

## Common Issues

### "No solutions found"
- Not enough liquidity for the order size
- Slippage limits too tight
- Gas costs exceed potential surplus
- **Solution:** This is often correct behavior

### "Solver timeout"
- GA taking >2 seconds
- **Solution:** Reduce population size or max generations

### "RPC rate limit"
- Too many RPC calls
- **Solution:** Enable caching, use multicall, upgrade RPC plan

### "Invalid solution"
- Solution violates constraints
- **Solution:** Check validation logic in OrderSettlementEngine

## Next Steps

1. **Read the paper:** [docs/hybrid_ga_mev_arxiv.pdf](docs/hybrid_ga_mev_arxiv.pdf)
2. **Test locally:** Follow [docs/COW_LOCAL_TESTING.md](docs/COW_LOCAL_TESTING.md)
3. **Tune parameters:** Adjust GA settings for your RPC/hardware
4. **Monitor performance:** Use metrics endpoints to track improvements
5. **Compare to baseline:** Run multiple solvers and measure user surplus delta
6. **Deploy to production:** Register with CoW Protocol

## Resources

- [CoW Protocol Docs](https://docs.cow.fi/)
- [Solver Tutorial](https://docs.cow.fi/cow-protocol/tutorials/solvers)
- [Services Repo](https://github.com/cowprotocol/services)
- [CoW Swap UI](https://swap.cow.fi/)

## Support

- Issues: GitHub Issues
- Discussion: CoW Protocol Discord
- Paper: See [docs/hybrid_ga_mev_arxiv.pdf](docs/hybrid_ga_mev_arxiv.pdf)

---

**Remember:** This solver competes to give users the best prices. Better solutions = happier users = more solver rewards. Win-win! 🐮

