# Shadow Competition Setup (Paper Trading)

## Key Points
- **No contract deployment needed** - Shadow competition is paper trading only
- **No real trades executed** - Just submit solutions to competition API
- Your solver only needs to respond to `/solve` HTTP requests

## What Was Fixed for Railway Deployment

### 1. ✅ Port Binding (server.ts)
```typescript
// Now binds to 0.0.0.0 in production (Railway requirement)
const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
```

### 2. ✅ Production Build (railway.json)
```json
"startCommand": "NODE_ENV=production node build/cow/index.js"
```
- Uses compiled JS instead of `ts-node`
- `ts-node` is dev-only and not available in production

### 3. ✅ Railway PORT Variable (index.ts)
```typescript
// Railway auto-assigns PORT, respect it
const port = parseInt(process.env.PORT || process.env.COW_SOLVER_PORT || '8000');
```

### 4. ✅ Dummy Contract Address OK (index.ts)
```typescript
// Shadow mode doesn't execute trades, dummy address is fine
const executorAddress = bundleExecutorAddress || '0x0000000000000000000000000000000000000001';
```

### 5. ✅ Better Startup Logging
- Shows all config on startup for debugging Railway deployment

## Railway Environment Variables

Set these in Railway dashboard:

```bash
# Arbitrum RPC
ETHEREUM_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/jpWIUdqC9uBZm_8nb1t0hgYf9jCbh3Wi
RPC_URL=https://arb-mainnet.g.alchemy.com/v2/jpWIUdqC9uBZm_8nb1t0hgYf9jCbh3Wi

# Your wallet (for signing, not executing trades)
PRIVATE_KEY=76ad9c049e8258f3ec5a3513f73933fe5be8338dc7ef479372de5abf9293b255

# Dummy address is fine for shadow competition
BUNDLE_EXECUTOR_ADDRESS=0x0000000000000000000000000000000000000001

# Production mode
NODE_ENV=production

# Arbitrum chain ID
CHAIN_ID=42161
```

**Note:** Don't set `PORT` or `COW_SOLVER_PORT` - Railway handles this automatically.

## Test Locally (Per CoW Docs)

### 1. Start Your Solver
```bash
npm run build
NODE_ENV=production node build/cow/index.js
```

Should output:
```
🐮 CoW Protocol Solver running on http://0.0.0.0:8000
📊 Health check: http://0.0.0.0:8000/health
🎯 Solve endpoint: http://0.0.0.0:8000/solve
```

### 2. Test Health Endpoint
```bash
curl http://localhost:8000/health
```

Expected response:
```json
{
  "status": "alive",
  "auctionsSolved": 0,
  "totalSolutions": 0,
  "timestamp": "2025-09-29T..."
}
```

### 3. Test with Mock Auction (Optional)
```bash
curl -X POST http://localhost:8000/solve \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test-auction-1",
    "orders": [],
    "liquidity": []
  }'
```

Expected response:
```json
{
  "solutions": []
}
```

### 4. Test with CoW Autopilot + Driver (Advanced)

Follow: https://docs.cow.fi/cow-protocol/tutorials/solvers/local_test

```bash
# 1. Run Autopilot (points to your solver)
cargo run --bin autopilot -- \
  --native-price-estimators "baseline|http://driver/baseline" \
  --skip-event-sync true \
  --node-url $NODE_URL \
  --shadow https://api.cow.fi/mainnet \
  --drivers "mysolver|http://localhost:8000/mysolver"

# 2. Run Driver
cargo run -p driver -- \
  --config driver.config.toml \
  --ethrpc $NODE_URL
```

## After Railway Deploy

### Check Deployment
```bash
curl https://cow-solver-production.up.railway.app/health
```

### Monitor Logs
Check Railway dashboard for:
- "Connected to network: arbitrum (chainId: 42161)"
- "🐮 CoW Protocol Solver running on..."
- Any error messages

### Common Issues

**502 Bad Gateway**
- Server not binding to 0.0.0.0 (fixed)
- Build failed (check Railway logs)
- Environment variables not set

**Application Error**
- Missing environment variables
- RPC connection issues
- TypeScript compilation errors

**Timeout**
- Solver taking too long (>10s)
- RPC provider slow/rate limited

## Shadow Competition Registration

Once deployed and healthy:
1. Register your solver URL with competition organizers
2. They'll send auction data to your `/solve` endpoint
3. Your solver returns solutions
4. Competition scores your solutions (paper trading only)

## Key Files

- `src/cow/index.ts` - Entry point
- `src/cow/server.ts` - HTTP server with `/solve` endpoint
- `src/cow/CoWAdapter.ts` - Converts auctions to arbitrage opportunities
- `src/cow/types.ts` - CoW Protocol data structures
- `railway.json` - Railway deployment config