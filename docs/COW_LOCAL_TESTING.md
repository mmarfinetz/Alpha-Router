# Local Testing with Real CoW Protocol Order Flow

This guide shows how to test your GA-based solver against **real production orderflow** from CoW Protocol using the autopilot + driver architecture.

## Architecture Overview

```
CoW Orderbook (prod) 
    ↓
Autopilot (local) ← fetches orders, creates auctions
    ↓
Driver (local) ← forwards auctions to solver
    ↓
Your Solver (local) ← receives /solve requests, returns solutions
```

## Prerequisites

1. **Rust installed** via [rustup](https://rustup.rs/)
2. **Node.js** and dependencies installed (`npm install`)
3. **RPC endpoint** (Infura, Alchemy, etc.) - ⚠️ **WARNING: Can use significant RPC resources**
4. **Your solver built** (`npm run build`)

## Step 1: Clone CoW Protocol Services

```bash
# Clone the services repo
git clone https://github.com/cowprotocol/services.git ~/cow-services
cd ~/cow-services

# Build the services (first time only)
cargo build --release --bin autopilot
cargo build --release --bin driver
```

## Step 2: Configure Driver

Create `driver.config.toml` in the cow-services directory:

```toml
# driver.config.toml
[http-server]
addr = "0.0.0.0:11088"

# Your solver configuration
[[solver]]
name = "ga-solver"                              # Your solver name
endpoint = "http://localhost:8000"              # Your solver's /solve endpoint
relative-slippage = "0.001"                     # 0.1% max slippage
absolute-slippage = "1000000000000000000"       # 1 ETH absolute slippage limit

# Optional: Configure multiple solvers for comparison
# [[solver]]
# name = "baseline"
# endpoint = "http://localhost:8001"

[settlement]
# Settlement contract address (mainnet)
address = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41"

[liquidity]
# Enable Uniswap V2, V3, Balancer, etc.
uniswap-v2 = ["UniswapV2", "Sushiswap"]
uniswap-v3 = ["UniswapV3"]
balancer-v2 = true
zeroex = false  # Optional: disable 0x for faster testing

[contracts]
# GPv2 settlement contract
gp-v2-settlement = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41"
```

## Step 3: Start Your Solver

In your arbitrage-bot directory:

```bash
# Build your solver
npm run build

# Start the CoW solver server
# It will listen on http://localhost:8000
NODE_ENV=development node build/cow/index.js
```

You should see:
```
🐮 CoW Protocol Solver running on http://localhost:8000
📊 Health check: http://localhost:8000/health
🎯 Solve endpoint: http://localhost:8000/solve
```

## Step 4: Start the Driver

In the `~/cow-services` directory:

```bash
# Set your RPC endpoint
export NODE_URL="https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY"

# Start the driver
cargo run --release --bin driver -- \
  --config driver.config.toml \
  --ethrpc $NODE_URL
```

Driver should output:
```
[INFO] Driver starting on http://0.0.0.0:11088
[INFO] Configured solvers: ga-solver
```

## Step 5: Start the Autopilot

In the `~/cow-services` directory (new terminal):

```bash
# Set your RPC endpoint
export NODE_URL="https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY"

# Start autopilot pointing to:
# - Production mainnet orderbook (--shadow https://api.cow.fi/mainnet)
# - Local driver (--drivers)
cargo run --release --bin autopilot -- \
  --native-price-estimators "baseline|http://localhost:11088/baseline" \
  --skip-event-sync true \
  --node-url $NODE_URL \
  --shadow https://api.cow.fi/mainnet \
  --drivers "ga-solver|http://localhost:11088/ga-solver"
```

Autopilot should output:
```
[INFO] Autopilot starting
[INFO] Connected to orderbook: https://api.cow.fi/mainnet
[INFO] Fetching auctions...
```

## Step 6: Monitor Your Solver

Watch your solver logs for incoming auctions:

```bash
# Your solver should start receiving /solve requests
tail -f logs/solver.log
```

Expected log output:
```
[INFO] Received auction id=123456 orders=5 liquidity=120
[INFO] GA optimization started: population=64, maxGen=100
[INFO] Generation 10/100: best_surplus=1.2 ETH, pareto_size=8
[INFO] Optimization completed in 450ms
[INFO] Submitted solution: surplus=1.2 ETH, gas=250k, paths=3
```

## Testing Against Different Networks

### Mainnet Production (most liquidity)
```bash
--shadow https://api.cow.fi/mainnet
```

### Mainnet Staging (barn - testing environment)
```bash
--shadow https://barn.api.cow.fi/mainnet
```

### Gnosis Chain
```bash
--shadow https://api.cow.fi/xdai
export NODE_URL="https://rpc.gnosischain.com"
```

### Arbitrum One
```bash
--shadow https://api.cow.fi/arbitrum_one
export NODE_URL="https://arb1.arbitrum.io/rpc"
```

## Debugging Tips

### Check Health Endpoints

```bash
# Your solver
curl http://localhost:8000/health

# Driver
curl http://localhost:11088/health

# Autopilot (no health endpoint, check logs)
```

### Test Solver Directly

Send a mock auction to your solver:

```bash
curl -X POST http://localhost:8000/solve \
  -H "Content-Type: application/json" \
  -d @test/fixtures/sample-auction.json
```

### Common Issues

**No auctions received:**
- Check autopilot is connected to orderbook
- Verify driver config points to correct solver endpoint
- Ensure solver is listening on the right port

**Solver timing out:**
- GA optimization taking too long (>2s)
- Reduce population size or max generations
- Check RPC latency

**Invalid solutions:**
- Solution doesn't respect limits
- Gas estimation incorrect
- Path routing invalid

**RPC rate limits:**
- Use a paid RPC plan or multiple providers
- Implement RPC caching
- Use multicall for batch requests

## Performance Monitoring

Your solver includes built-in metrics:

```bash
# WebSocket metrics (real-time)
wscat -c ws://localhost:8000/metrics

# HTTP metrics endpoint
curl http://localhost:8000/metrics
```

Metrics include:
- Auctions solved
- Average solution time
- GA convergence rate
- User surplus improvements
- Pareto front quality

## Next Steps

1. **Tune GA Parameters**: Adjust population size, mutation rate based on observed performance
2. **Add Caching**: Cache liquidity data to reduce RPC calls
3. **Profile Performance**: Use `--inspect` to profile Node.js solver
4. **Compare to Baseline**: Run multiple solvers and compare results
5. **Production Deployment**: Once tested, deploy to Railway/Render for 24/7 operation

## Advanced: Multi-Solver Competition

Run multiple solver instances and compare:

```bash
# Terminal 1: GA solver (port 8000)
NODE_ENV=development node build/cow/index.js

# Terminal 2: Baseline solver (port 8001)
COW_SOLVER_PORT=8001 node build/cow/baseline-solver.js

# Update driver.config.toml with both solvers
[[solver]]
name = "ga-solver"
endpoint = "http://localhost:8000"

[[solver]]
name = "baseline"
endpoint = "http://localhost:8001"
```

The driver will send auctions to both and compare solutions.

## Resources

- [CoW Protocol Docs](https://docs.cow.fi/)
- [Solver Tutorial](https://docs.cow.fi/cow-protocol/tutorials/solvers)
- [Services Repo](https://github.com/cowprotocol/services)
- [Your Paper](../docs/hybrid_ga_mev_arxiv.pdf) - GA solver architecture

## Safety Notes

⚠️ **This is shadow testing only** - no real trades are executed
⚠️ **RPC usage can be high** - monitor your provider's usage dashboard
⚠️ **Test on barn first** - use staging environment before production

