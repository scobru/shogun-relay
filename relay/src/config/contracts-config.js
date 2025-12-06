/**
 * Shogun Protocol Contracts Configuration
 * 
 * Centralized configuration file for all contract addresses across networks.
 * This file should be kept in sync with actual deployments.
 * 
 * Last updated: 2025-01-XX
 */

export const CONTRACTS_CONFIG = {
  baseSepolia: {
    chainId: 84532,
    relayRegistry: "0x2E74079a4FaeaF25CC8e73181287c10E66e358dA",
    storageDealRegistry: "0xAb8F8fEB2E1dF540208d702f0c8A2AD2E6f8AEcd",
    dataPostRegistry: "0xe2F4515F345Ef5E8E19eB653843f8499f3b55F8a",
    dataSaleEscrowFactory: "0x050e81d5Aba6EA8e5fB40E4385c692F04D86F889",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    rpc: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org"
  },
  base: {
    chainId: 8453,
    relayRegistry: null,
    storageDealRegistry: null,
    dataPostRegistry: null,
    dataSaleEscrowFactory: null,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    rpc: "https://mainnet.base.org",
    explorer: "https://basescan.org"
  }
};

// Helper function to get config by chainId
export function getConfigByChainId(chainId) {
  const config = Object.values(CONTRACTS_CONFIG).find(c => c.chainId === chainId);
  return config || null;
}

// Helper function to get config by network name
export function getConfigByNetwork(network) {
  return CONTRACTS_CONFIG[network] || null;
}

