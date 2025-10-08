"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("@nomiclabs/hardhat-ethers");
require("@nomiclabs/hardhat-waffle");
require("dotenv").config();

const config = {
    solidity: {
        compilers: [
            {
                version: "0.6.12",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200
                    }
                }
            },
            {
                version: "0.8.19",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200
                    }
                }
            },
            {
                version: "0.8.20",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200
                    },
                    viaIR: true
                }
            }
        ]
    },
    networks: {
        hardhat: {
            forking: {
                url: process.env.ETHEREUM_RPC_URL || process.env.ETH_MAINNET_URL,
                blockNumber: 19000000 // Recent block number
            },
            mining: {
                auto: true,
                interval: 0
            }
        },
        mainnet: {
            url: process.env.ETHEREUM_RPC_URL || process.env.ETH_MAINNET_URL,
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
            chainId: 1,
            gasPrice: "auto"
        },
        sepolia: {
            url: process.env.SEPOLIA_RPC_URL,
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
            chainId: 11155111
        },
        arbitrum: {
            url: process.env.ETHEREUM_RPC_URL || process.env.RPC_URL || "https://arb1.arbitrum.io/rpc",
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
            chainId: 42161,
            gasPrice: "auto"
        }
    }
};

module.exports = config;
