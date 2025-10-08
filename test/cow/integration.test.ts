import { expect } from 'chai';
import axios from 'axios';
import { CoWAuction } from '../../src/cow/types';

describe('CoW Solver Integration Tests', () => {
  const SOLVER_URL = 'http://localhost:8000';

  before(async function() {
    this.timeout(10000);
    // Wait for server to be ready
    let ready = false;
    for (let i = 0; i < 10; i++) {
      try {
        await axios.get(`${SOLVER_URL}/health`);
        ready = true;
        break;
      } catch (e) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    if (!ready) {
      throw new Error('Solver server not ready');
    }
  });

  it('should respond to health checks', async () => {
    const response = await axios.get(`${SOLVER_URL}/health`);
    expect(response.status).to.equal(200);
    expect(response.data.status).to.equal('alive');
  });

  it('should solve a test auction', async function() {
    this.timeout(30000);

    const auction: CoWAuction = {
      id: 'integration-test-1',
      orders: [{
        uid: '0xtest123',
        sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sellAmount: '1000000000000000000',
        buyAmount: '3000000000',
        kind: 'sell',
        partiallyFillable: false,
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: '0x',
        feeAmount: '0',
        owner: '0x0000000000000000000000000000000000000000',
        sellTokenBalance: 'erc20',
        buyTokenBalance: 'erc20'
      }],
      liquidity: [{
        kind: 'ConstantProduct',
        tokens: [
          '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        ],
        reserves: ['100000000000000000000', '300000000000'],
        router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
        gasEstimate: '150000'
      }],
      effectiveGasPrice: '30000000000',
      deadline: new Date(Date.now() + 300000).toISOString(),
      surplus_capturing_jit_order_owners: []
    };

    const response = await axios.post(`${SOLVER_URL}/solve`, auction);

    expect(response.status).to.equal(200);
    expect(response.data).to.have.property('solutions');
    expect(response.data.solutions).to.be.an('array');
  });
});