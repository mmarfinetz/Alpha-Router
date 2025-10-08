#!/bin/bash

echo "════════════════════════════════════════════════════════════════"
echo "🏗️  CONTRACT DEPLOYMENT HELPER"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Check if .env.competition exists
if [ ! -f ".env.competition" ]; then
    echo "❌ .env.competition not found!"
    echo "   Run: nano .env.competition"
    exit 1
fi

# Load environment
source .env.competition

# Check configuration
if [[ "$ETHEREUM_RPC_URL" == *"YOUR-API-KEY"* ]]; then
    echo "❌ ETHEREUM_RPC_URL not configured in .env.competition"
    exit 1
fi

if [[ "$PRIVATE_KEY" == "your_private_key_here" ]]; then
    echo "❌ PRIVATE_KEY not configured in .env.competition"
    exit 1
fi

echo "📋 Deployment Options:"
echo ""
echo "1️⃣  Deploy to Mainnet (~$250 in gas)"
echo "   - Real money, real contracts"
echo "   - Use for actual trading"
echo "   - Requires 0.15 ETH in wallet"
echo ""
echo "2️⃣  Deploy to Sepolia Testnet (FREE)"
echo "   - Test contracts, no real money"
echo "   - Get free testnet ETH from faucet"
echo "   - Safe for testing"
echo ""
echo "3️⃣  Skip deployment (RECOMMENDED for competition)"
echo "   - Use placeholder address"
echo "   - Deploy later when needed"
echo "   - Save $250 for now"
echo ""

read -p "Choose option (1/2/3): " choice

case $choice in
    1)
        echo ""
        echo "🚀 Deploying to MAINNET..."
        echo "⚠️  This will cost ~0.125 ETH (~$250) in gas!"
        echo ""
        read -p "Are you sure? (yes/no): " confirm
        if [ "$confirm" != "yes" ]; then
            echo "Cancelled."
            exit 0
        fi
        
        echo ""
        echo "📦 Compiling contracts..."
        npx hardhat compile
        
        echo ""
        echo "🚀 Deploying to mainnet..."
        npx hardhat run scripts/deploy-contracts.ts --network mainnet
        ;;
        
    2)
        echo ""
        echo "🧪 Deploying to SEPOLIA TESTNET..."
        echo ""
        
        if [ -z "$SEPOLIA_RPC_URL" ]; then
            echo "❌ SEPOLIA_RPC_URL not set in .env.competition"
            echo ""
            echo "Add this line to .env.competition:"
            echo "SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR-API-KEY"
            exit 1
        fi
        
        echo "📦 Compiling contracts..."
        npx hardhat compile
        
        echo ""
        echo "💡 Make sure you have testnet ETH!"
        echo "   Get free ETH: https://sepoliafaucet.com/"
        echo ""
        read -p "Press Enter when ready..."
        
        echo ""
        echo "🚀 Deploying to Sepolia..."
        npx hardhat run scripts/deploy-contracts.ts --network sepolia
        ;;
        
    3)
        echo ""
        echo "✅ Skipping deployment (smart choice for competition!)"
        echo ""
        echo "📝 Your .env.competition already has:"
        echo "   BUNDLE_EXECUTOR_ADDRESS=0x0000000000000000000000000000000000000001"
        echo ""
        echo "This placeholder is perfect for the shadow solver competition."
        echo "Deploy real contracts later when you want to execute actual trades."
        echo ""
        echo "🚀 Next step: Deploy your solver!"
        echo "   Run: ./START_COMPETITION.sh"
        ;;
        
    *)
        echo "Invalid option. Cancelled."
        exit 1
        ;;
esac

echo ""
echo "════════════════════════════════════════════════════════════════"
