import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Network:", network.name, "ChainId:", network.chainId);

  // AAVE V3 Pool Addresses Provider
  // Ethereum Mainnet: 0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e
  // Arbitrum: 0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb
  const AAVE_ADDRESSES: { [chainId: number]: string } = {
    1: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
    42161: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb"
  };

  const AAVE_POOL_ADDRESSES_PROVIDER = AAVE_ADDRESSES[network.chainId] || AAVE_ADDRESSES[1];
  console.log("Using Aave Pool Provider:", AAVE_POOL_ADDRESSES_PROVIDER);

  // Deploy a mock bundle executor for testing
  const BundleExecutor = await ethers.getContractFactory("FlashBotsMultiCall");
  const bundleExecutor = await BundleExecutor.deploy(deployer.address);
  await bundleExecutor.waitForDeployment();
  console.log("BundleExecutor deployed to:", await bundleExecutor.getAddress());

  // Deploy FlashLoanExecutor
  const FlashLoanExecutor = await ethers.getContractFactory("FlashLoanExecutor");
  const flashLoanExecutor = await FlashLoanExecutor.deploy(
    AAVE_POOL_ADDRESSES_PROVIDER,
    await bundleExecutor.getAddress()
  );
  await flashLoanExecutor.waitForDeployment();
  console.log("FlashLoanExecutor deployed to:", await flashLoanExecutor.getAddress());

  console.log("\n✅ Deployment complete!");
  console.log("Update your .env file with:");
  console.log(`BUNDLE_EXECUTOR_ADDRESS=${await bundleExecutor.getAddress()}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 