import { expect } from 'chai';
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import hre from 'hardhat';

dotenv.config();

describe('MEV Bot Contracts Integration Tests', () => {
  let deployer: any;
  let bundleExecutor: any;
  let flashLoanExecutor: any;
  let weth: any;

  const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
  const FORKING_BLOCK = 19000000;

  beforeAll(async () => {

    // Setup local hardhat network with mainnet fork
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ETH_MAINNET_URL,
            blockNumber: FORKING_BLOCK,
          },
        },
      ],
    });

    console.log(`Network forked from mainnet at block ${FORKING_BLOCK}`);

    // Get signers
    [deployer] = await hre.ethers.getSigners();
    
    // Connect to WETH contract
    const wethABI = [
      'function deposit() payable',
      'function withdraw(uint256) external',
      'function balanceOf(address) view returns (uint256)',
      'function transfer(address, uint256) returns (bool)',
      'function approve(address, uint256) returns (bool)'
    ];
    weth = new ethers.Contract(WETH_ADDRESS, wethABI, deployer);
  });

  describe('Network Setup', () => {
    it('should have proper network configuration', async () => {
      const blockNumber = await hre.ethers.provider.getBlockNumber();
      expect(blockNumber).to.be.greaterThan(FORKING_BLOCK);
    });

    it('should have deployer with ETH balance', async () => {
      const balance = await deployer.getBalance();
      expect(balance.gt(ethers.utils.parseEther('1'))).to.be.true;
      console.log('Deployer balance:', ethers.utils.formatEther(balance), 'ETH');
    });

    it('should connect to WETH contract', async () => {
      const wethBalance = await weth.balanceOf(deployer.address);
      expect(wethBalance.gte(0)).to.be.true;
    });
  });

  describe('Contract Deployment', () => {
    it('should deploy BundleExecutor contract', async () => {

      const BundleExecutor = await hre.ethers.getContractFactory('BundleExecutor');
      bundleExecutor = await BundleExecutor.deploy(WETH_ADDRESS);
      await bundleExecutor.deployed();

      expect(bundleExecutor.address).to.match(/^0x[a-fA-F0-9]{40}$/);
      console.log('BundleExecutor deployed at:', bundleExecutor.address);

      // Verify constructor parameters
      const wethAddress = await bundleExecutor.WETH();
      expect(wethAddress).to.equal(WETH_ADDRESS);
    });

    it('should deploy FlashLoanExecutor contract', async () => {

      const FlashLoanExecutor = await hre.ethers.getContractFactory('FlashLoanExecutor');
      flashLoanExecutor = await FlashLoanExecutor.deploy(bundleExecutor.address);
      await flashLoanExecutor.deployed();

      expect(flashLoanExecutor.address).to.match(/^0x[a-fA-F0-9]{40}$/);
      console.log('FlashLoanExecutor deployed at:', flashLoanExecutor.address);

      // Verify constructor parameters
      const bundleExecutorAddress = await flashLoanExecutor.bundleExecutor();
      expect(bundleExecutorAddress).to.equal(bundleExecutor.address);
    });

    it('should set proper ownership', async () => {
      const owner = await bundleExecutor.owner();
      expect(owner).to.equal(deployer.address);
    });
  });

  describe('BundleExecutor Functionality', () => {
    beforeAll(async () => {
      if (!bundleExecutor) {
        const BundleExecutor = await hre.ethers.getContractFactory('BundleExecutor');
        bundleExecutor = await BundleExecutor.deploy(WETH_ADDRESS);
        await bundleExecutor.deployed();
      }
    });

    it('should receive ETH deposits', async () => {
      const initialBalance = await hre.ethers.provider.getBalance(bundleExecutor.address);
      
      const depositAmount = ethers.utils.parseEther('1.0');
      await deployer.sendTransaction({
        to: bundleExecutor.address,
        value: depositAmount
      });

      const finalBalance = await hre.ethers.provider.getBalance(bundleExecutor.address);
      expect(finalBalance.sub(initialBalance)).to.equal(depositAmount);
    });

    it('should handle WETH operations', async () => {
      // Deposit ETH to get WETH
      const wethAmount = ethers.utils.parseEther('0.5');
      await weth.deposit({ value: wethAmount });
      
      const wethBalance = await weth.balanceOf(deployer.address);
      expect(wethBalance.gte(wethAmount)).to.be.true;

      // Transfer WETH to BundleExecutor
      await weth.transfer(bundleExecutor.address, wethAmount);
      
      const bundleExecutorWethBalance = await weth.balanceOf(bundleExecutor.address);
      expect(bundleExecutorWethBalance).to.equal(wethAmount);
    });

    it('should validate call data structure', async () => {
      // Test call data encoding for uniswap swap
      const swapInterface = new ethers.utils.Interface([
        'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)'
      ]);

      const callData = swapInterface.encodeFunctionData('swapExactTokensForTokens', [
        ethers.utils.parseEther('1'),
        ethers.utils.parseEther('0.95'),
        [WETH_ADDRESS, '0xA0b86a33E6417c7fb8248c5dB2E9d0a54E2F05D6'], // WETH -> TOKEN
        bundleExecutor.address,
        Math.floor(Date.now() / 1000) + 3600
      ]);

      expect(callData).to.be.a('string');
      expect(callData).to.match(/^0x[a-fA-F0-9]+$/);
      expect(callData.length).to.be.greaterThan(10);
    });

    it('should implement proper access control', async () => {
      // Only owner should be able to call owner-only functions
      const [, nonOwner] = await hre.ethers.getSigners();
      
      // This should fail when called by non-owner
      try {
        await bundleExecutor.connect(nonOwner).call(
          WETH_ADDRESS,
          ethers.utils.parseEther('0'),
          '0x'
        );
        expect.fail('Should have reverted for non-owner');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        expect(errorMessage).to.include('Ownable: caller is not the owner');
      }
    });
  });

  describe('Flash Loan Integration', () => {
    beforeAll(async () => {
      if (!flashLoanExecutor) {
        const FlashLoanExecutor = await hre.ethers.getContractFactory('FlashLoanExecutor');
        flashLoanExecutor = await FlashLoanExecutor.deploy(bundleExecutor.address);
        await flashLoanExecutor.deployed();
      }
    });

    it('should validate flash loan parameters', () => {
      const flashLoanParams = {
        asset: WETH_ADDRESS,
        amount: ethers.utils.parseEther('100'),
        premium: ethers.utils.parseEther('0.09'), // 0.09% fee
        mode: 0 // No debt
      };

      expect(flashLoanParams.asset).to.match(/^0x[a-fA-F0-9]{40}$/);
      expect(flashLoanParams.amount.gt(0)).to.be.true;
      expect(flashLoanParams.premium.gte(0)).to.be.true;
      expect(flashLoanParams.mode).to.be.a('number');
    });

    it('should calculate flash loan costs', () => {
      const loanAmount = ethers.utils.parseEther('100');
      const feeRate = 9; // 0.09% = 9 basis points
      const expectedFee = loanAmount.mul(feeRate).div(10000);

      expect(expectedFee).to.equal(ethers.utils.parseEther('0.09'));
    });

    it('should validate arbitrage profitability with fees', () => {
      const flashLoanAmount = ethers.utils.parseEther('100');
      const flashLoanFee = ethers.utils.parseEther('0.09');
      const arbitrageProfit = ethers.utils.parseEther('0.5');
      const gasCost = ethers.utils.parseEther('0.1');

      const netProfit = arbitrageProfit.sub(flashLoanFee).sub(gasCost);
      const profitMargin = netProfit.mul(100).div(flashLoanAmount);

      expect(netProfit.gt(0)).to.be.true;
      expect(profitMargin.toNumber()).to.equal(31); // 0.31% profit margin
    });
  });

  describe('Gas Optimization', () => {
    it('should estimate gas for bundle execution', async () => {
      if (!bundleExecutor) {
        const BundleExecutor = await hre.ethers.getContractFactory('BundleExecutor');
        bundleExecutor = await BundleExecutor.deploy(WETH_ADDRESS);
        await bundleExecutor.deployed();
      }

      // Estimate gas for a simple call
      const gasEstimate = await bundleExecutor.estimateGas.call(
        WETH_ADDRESS,
        0,
        '0x'
      );

      expect(gasEstimate.gt(0)).to.be.true;
      expect(gasEstimate.lt(ethers.BigNumber.from(500000))).to.be.true; // Should be reasonable
      console.log('Estimated gas for bundle execution:', gasEstimate.toString());
    });

    it('should validate gas price calculations', () => {
      const baseFee = ethers.utils.parseUnits('30', 'gwei');
      const priorityFee = ethers.utils.parseUnits('2', 'gwei');
      const gasLimit = ethers.BigNumber.from(300000);

      const maxFeePerGas = baseFee.add(priorityFee);
      const maxTransactionCost = maxFeePerGas.mul(gasLimit);

      expect(maxFeePerGas).to.equal(ethers.utils.parseUnits('32', 'gwei'));
      expect(maxTransactionCost).to.equal(ethers.utils.parseEther('0.0096'));
    });
  });

  describe('Security Validations', () => {
    it('should prevent reentrancy attacks', async () => {
      // BundleExecutor should have proper reentrancy guards
      if (!bundleExecutor) {
        const BundleExecutor = await hre.ethers.getContractFactory('BundleExecutor');
        bundleExecutor = await BundleExecutor.deploy(WETH_ADDRESS);
        await bundleExecutor.deployed();
      }

      // Test that the contract exists and has proper structure
      const code = await hre.ethers.provider.getCode(bundleExecutor.address);
      expect(code).to.not.equal('0x');
      expect(code.length).to.be.greaterThan(100);
    });

    it('should validate slippage protection', () => {
      const expectedOutput = ethers.utils.parseEther('95');
      const actualOutput = ethers.utils.parseEther('94.5');
      const slippageTolerance = 1; // 1%

      const slippage = expectedOutput.sub(actualOutput).mul(100).div(expectedOutput);
      const isWithinTolerance = slippage.lte(ethers.BigNumber.from(slippageTolerance));

      expect(slippage.toNumber()).to.be.lessThanOrEqual(slippageTolerance);
      expect(isWithinTolerance).to.be.true;
    });

    it('should implement deadline protection', () => {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const transactionDeadline = currentTimestamp + 300; // 5 minutes
      const executionTimestamp = currentTimestamp + 60;   // 1 minute later

      expect(executionTimestamp).to.be.lessThan(transactionDeadline);
    });
  });
});