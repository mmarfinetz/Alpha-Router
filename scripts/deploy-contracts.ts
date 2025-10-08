import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  
  console.log("════════════════════════════════════════════════════════════════");
  console.log("🚀 DEPLOYING CONTRACTS");
  console.log("════════════════════════════════════════════════════════════════");
  console.log("");
  console.log("Deploying with account:", deployer.address);
  
  // Get balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");
  console.log("");

  // Check if we have enough ETH
  if (balance < ethers.parseEther("0.05")) {
    console.log("⚠️  WARNING: Low balance! You might need more ETH for deployment.");
    console.log("   Recommended: At least 0.1 ETH for mainnet deployment");
    console.log("");
  }

  // WETH address on Ethereum mainnet
  const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  
  // AAVE V3 Pool Addresses Provider on Mainnet
  const AAVE_POOL_ADDRESSES_PROVIDER = "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e";
  
  console.log("📝 Using addresses:");
  console.log("   WETH:", WETH_ADDRESS);
  console.log("   AAVE Pool Provider:", AAVE_POOL_ADDRESSES_PROVIDER);
  console.log("");

  // ========================================================================
  // Deploy BundleExecutor
  // ========================================================================
  console.log("════════════════════════════════════════════════════════════════");
  console.log("1️⃣  Deploying BundleExecutor...");
  console.log("════════════════════════════════════════════════════════════════");
  
  const BundleExecutor = await ethers.getContractFactory("BundleExecutor");
  console.log("   Factory created, deploying...");
  
  const bundleExecutor = await BundleExecutor.deploy(
    deployer.address, // owner
    WETH_ADDRESS      // WETH address
  );
  
  console.log("   Waiting for deployment confirmation...");
  await bundleExecutor.waitForDeployment();
  
  const bundleExecutorAddress = await bundleExecutor.getAddress();
  console.log("   ✅ BundleExecutor deployed!");
  console.log("   📍 Address:", bundleExecutorAddress);
  console.log("");

  // ========================================================================
  // Deploy FlashLoanExecutor
  // ========================================================================
  console.log("════════════════════════════════════════════════════════════════");
  console.log("2️⃣  Deploying FlashLoanExecutor...");
  console.log("════════════════════════════════════════════════════════════════");
  
  const FlashLoanExecutor = await ethers.getContractFactory("FlashLoanExecutor");
  console.log("   Factory created, deploying...");
  
  const flashLoanExecutor = await FlashLoanExecutor.deploy(
    AAVE_POOL_ADDRESSES_PROVIDER,
    bundleExecutorAddress
  );
  
  console.log("   Waiting for deployment confirmation...");
  await flashLoanExecutor.waitForDeployment();
  
  const flashLoanExecutorAddress = await flashLoanExecutor.getAddress();
  console.log("   ✅ FlashLoanExecutor deployed!");
  console.log("   📍 Address:", flashLoanExecutorAddress);
  console.log("");

  // ========================================================================
  // Summary
  // ========================================================================
  console.log("════════════════════════════════════════════════════════════════");
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("════════════════════════════════════════════════════════════════");
  console.log("");
  console.log("📋 Contract Addresses:");
  console.log("   BundleExecutor:      ", bundleExecutorAddress);
  console.log("   FlashLoanExecutor:   ", flashLoanExecutorAddress);
  console.log("");
  console.log("💾 Save these addresses to your .env file:");
  console.log("   BUNDLE_EXECUTOR_ADDRESS=" + bundleExecutorAddress);
  console.log("   FLASH_LOAN_EXECUTOR_ADDRESS=" + flashLoanExecutorAddress);
  console.log("");
  console.log("🔍 Verify on Etherscan:");
  console.log("   https://etherscan.io/address/" + bundleExecutorAddress);
  console.log("   https://etherscan.io/address/" + flashLoanExecutorAddress);
  console.log("");
  console.log("📝 Next Steps:");
  console.log("   1. Update your .env.competition with BUNDLE_EXECUTOR_ADDRESS");
  console.log("   2. Verify contracts on Etherscan (optional but recommended)");
  console.log("   3. Test your solver with the new contract addresses");
  console.log("");
  console.log("════════════════════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("");
    console.error("❌ DEPLOYMENT FAILED!");
    console.error("");
    console.error(error);
    console.error("");
    process.exit(1);
  });
