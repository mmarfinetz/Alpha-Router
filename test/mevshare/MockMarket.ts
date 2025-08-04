import { BigNumber } from "ethers";
import { EthMarket } from "../../src/EthMarket";

export class MockMarket implements EthMarket {
    marketAddress: string;
    tokenAddress: string;
    tokens: string[];
    protocol: string;
    private _reserves: BigNumber[] = [BigNumber.from(0), BigNumber.from(0)];

    constructor(address: string, tokens: string[], protocol: string = "MockProtocol", contract?: any) {
        this.marketAddress = address;
        this.tokenAddress = tokens[0];
        this.tokens = tokens;
        this.protocol = protocol;
    }

    async getVolatility(): Promise<BigNumber> {
        return BigNumber.from(0);
    }

    async getLiquidity(): Promise<BigNumber> {
        return BigNumber.from(0);
    }

    async getReserves(tokenAddress?: string): Promise<BigNumber> {
        if (!tokenAddress) {
            return this._reserves[0];
        }
        const tokenIndex = this.tokens.indexOf(tokenAddress);
        if (tokenIndex === -1) {
            throw new Error('Token not found in pair');
        }
        return this._reserves[tokenIndex];
    }

    async setReserves(reserve0: BigNumber, reserve1: BigNumber): Promise<void> {
        this._reserves = [reserve0, reserve1];
    }

    async getPriceImpact(): Promise<BigNumber> {
        return BigNumber.from('10000000000000000');
    }

    async getTradingFee(): Promise<BigNumber> {
        return BigNumber.from('3000000000000000');
    }

    async sellTokens(): Promise<string> {
        return '0x';
    }

    async sellTokensToNextMarket(): Promise<{ targets: string[], data: string[], payloads: string[], values: BigNumber[] }> {
        return { targets: [], data: [], payloads: [], values: [] };
    }

    async getTokensOut(): Promise<BigNumber> {
        return BigNumber.from(0);
    }

    async getBalance(): Promise<BigNumber> {
        return BigNumber.from(0);
    }

    receiveDirectly(): boolean {
        return false;
    }

    async updateReserves(): Promise<void> {
        // Mock implementation - do nothing
        return Promise.resolve();
    }

    async getReservesByToken(tokenAddress?: string): Promise<BigNumber | BigNumber[]> {
        if (!tokenAddress) {
            return this._reserves;
        }
        const tokenIndex = this.tokens.indexOf(tokenAddress);
        if (tokenIndex === -1) {
            throw new Error('Token not found in pair');
        }
        return this._reserves[tokenIndex];
    }
} 