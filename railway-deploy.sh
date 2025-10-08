#!/bin/bash

# CoW Solver Railway Deployment Script

echo "🚂 Railway Deployment Script"
echo "============================"
echo ""

# Check Railway CLI
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found"
    echo "Install with: npm i -g @railway/cli"
    exit 1
fi

echo "✅ Railway CLI found: $(railway --version)"
echo ""

# Check Railway project status
echo "📊 Railway Project Status:"
railway status
echo ""

# Set environment variables
echo "🔐 Setting Environment Variables..."
echo "This will set the required environment variables for the CoW solver"
echo ""

# Read from .env.competition
if [ -f ".env.competition" ]; then
    echo "Loading from .env.competition..."

    # Set variables using Railway v4 syntax
    railway variables \
        --set "ETHEREUM_RPC_URL=$(grep ETHEREUM_RPC_URL .env.competition | cut -d '=' -f2-)" \
        --set "RPC_URL=$(grep RPC_URL .env.competition | cut -d '=' -f2-)" \
        --set "PRIVATE_KEY=$(grep PRIVATE_KEY .env.competition | cut -d '=' -f2-)" \
        --set "NODE_ENV=production" \
        --set "LOG_LEVEL=info" \
        --set "BUNDLE_EXECUTOR_ADDRESS=0x0000000000000000000000000000000000000001"

    echo "✅ Environment variables set"
else
    echo "⚠️  .env.competition not found, skipping variable setup"
    echo "You can set variables manually with:"
    echo "  railway variables set KEY=VALUE"
fi

echo ""
echo "📦 Building project..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

echo "✅ Build successful"
echo ""

echo "🚀 Deploying to Railway..."
railway up

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Deployment successful!"
    echo ""
    echo "📝 Next steps:"
    echo "1. Check deployment: railway status"
    echo "2. View logs: railway logs"
    echo "3. Get URL: railway domain"
    echo "4. Test solver: curl https://your-domain.railway.app/health"
else
    echo ""
    echo "❌ Deployment failed"
    echo "Check logs with: railway logs"
    exit 1
fi
