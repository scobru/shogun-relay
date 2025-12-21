/**
 * Multi-Chain Configuration
 * 
 * Defines supported blockchain networks and their RPC URLs.
 * RPC URLs can be overridden via environment variables.
 */

// Supported network identifiers
export type NetworkId = 
  | 'base-sepolia' 
  | 'base' 
  | 'sepolia' 
  | 'mainnet' 
  | 'arbitrum' 
  | 'arbitrum-sepolia'
  | 'optimism'
  | 'optimism-sepolia'
  | 'polygon'
  | 'polygon-amoy';

// Network configuration interface
export interface NetworkConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorer?: string;
  isTestnet: boolean;
}

// Default RPC URLs (public endpoints)
const DEFAULT_RPC_URLS: Record<NetworkId, string> = {
  'base-sepolia': 'https://sepolia.base.org',
  'base': 'https://mainnet.base.org',
  'sepolia': 'https://rpc.sepolia.org',
  'mainnet': 'https://eth.public-rpc.com',
  'arbitrum': 'https://arb1.arbitrum.io/rpc',
  'arbitrum-sepolia': 'https://sepolia-rollup.arbitrum.io/rpc',
  'optimism': 'https://mainnet.optimism.io',
  'optimism-sepolia': 'https://sepolia.optimism.io',
  'polygon': 'https://polygon-rpc.com',
  'polygon-amoy': 'https://rpc-amoy.polygon.technology',
};

// Chain IDs for each network
const CHAIN_IDS: Record<NetworkId, number> = {
  'base-sepolia': 84532,
  'base': 8453,
  'sepolia': 11155111,
  'mainnet': 1,
  'arbitrum': 42161,
  'arbitrum-sepolia': 421614,
  'optimism': 10,
  'optimism-sepolia': 11155420,
  'polygon': 137,
  'polygon-amoy': 80002,
};

// Network names (human readable)
const NETWORK_NAMES: Record<NetworkId, string> = {
  'base-sepolia': 'Base Sepolia',
  'base': 'Base',
  'sepolia': 'Ethereum Sepolia',
  'mainnet': 'Ethereum Mainnet',
  'arbitrum': 'Arbitrum One',
  'arbitrum-sepolia': 'Arbitrum Sepolia',
  'optimism': 'Optimism',
  'optimism-sepolia': 'Optimism Sepolia',
  'polygon': 'Polygon',
  'polygon-amoy': 'Polygon Amoy',
};

// Explorer URLs
const EXPLORER_URLS: Record<NetworkId, string> = {
  'base-sepolia': 'https://sepolia.basescan.org',
  'base': 'https://basescan.org',
  'sepolia': 'https://sepolia.etherscan.io',
  'mainnet': 'https://etherscan.io',
  'arbitrum': 'https://arbiscan.io',
  'arbitrum-sepolia': 'https://sepolia.arbiscan.io',
  'optimism': 'https://optimistic.etherscan.io',
  'optimism-sepolia': 'https://sepolia-optimism.etherscan.io',
  'polygon': 'https://polygonscan.com',
  'polygon-amoy': 'https://amoy.polygonscan.com',
};

// Testnet flags
const IS_TESTNET: Record<NetworkId, boolean> = {
  'base-sepolia': true,
  'base': false,
  'sepolia': true,
  'mainnet': false,
  'arbitrum': false,
  'arbitrum-sepolia': true,
  'optimism': false,
  'optimism-sepolia': true,
  'polygon': false,
  'polygon-amoy': true,
};

/**
 * Get RPC URL for a network, with environment variable override support
 * 
 * Environment variable naming convention:
 * - BASE_SEPOLIA_RPC for 'base-sepolia'
 * - BASE_RPC for 'base'
 * - SEPOLIA_RPC for 'sepolia'
 * etc.
 * 
 * Also supports service-specific overrides:
 * - X402_BASE_SEPOLIA_RPC
 * - BRIDGE_BASE_SEPOLIA_RPC
 * - DEALS_BASE_SEPOLIA_RPC
 */
export function getRpcForNetwork(network: NetworkId, service?: 'x402' | 'bridge' | 'deals'): string {
  // Convert network ID to env variable name (e.g., 'base-sepolia' -> 'BASE_SEPOLIA')
  const envName = network.toUpperCase().replace(/-/g, '_');
  
  // Check service-specific override first
  if (service) {
    const serviceEnvName = `${service.toUpperCase()}_${envName}_RPC`;
    const serviceRpc = process.env[serviceEnvName];
    if (serviceRpc) {
      return serviceRpc;
    }
  }
  
  // Check global override
  const globalEnvName = `${envName}_RPC`;
  const globalRpc = process.env[globalEnvName];
  if (globalRpc) {
    return globalRpc;
  }
  
  // Return default
  return DEFAULT_RPC_URLS[network] || '';
}

/**
 * Get chain ID for a network
 */
export function getChainIdForNetwork(network: NetworkId): number {
  return CHAIN_IDS[network] || 0;
}

/**
 * Get network ID from chain ID
 */
export function getNetworkFromChainId(chainId: number): NetworkId | undefined {
  for (const [network, id] of Object.entries(CHAIN_IDS)) {
    if (id === chainId) {
      return network as NetworkId;
    }
  }
  return undefined;
}

/**
 * Get full network configuration
 */
export function getNetworkConfig(network: NetworkId, service?: 'x402' | 'bridge' | 'deals'): NetworkConfig {
  return {
    chainId: CHAIN_IDS[network],
    name: NETWORK_NAMES[network],
    rpcUrl: getRpcForNetwork(network, service),
    explorer: EXPLORER_URLS[network],
    isTestnet: IS_TESTNET[network],
  };
}

/**
 * Parse comma-separated network list from environment variable
 */
export function parseNetworkList(envValue: string | undefined, defaultValue: NetworkId[] = ['base-sepolia']): NetworkId[] {
  if (!envValue) {
    return defaultValue;
  }
  
  return envValue
    .split(',')
    .map(n => n.trim().toLowerCase() as NetworkId)
    .filter(n => CHAIN_IDS[n] !== undefined);
}

/**
 * Validate network ID
 */
export function isValidNetwork(network: string): network is NetworkId {
  return network in CHAIN_IDS;
}

/**
 * Get all supported networks
 */
export function getSupportedNetworks(): NetworkId[] {
  return Object.keys(CHAIN_IDS) as NetworkId[];
}

/**
 * Get all testnet networks
 */
export function getTestnetNetworks(): NetworkId[] {
  return Object.entries(IS_TESTNET)
    .filter(([_, isTestnet]) => isTestnet)
    .map(([network]) => network as NetworkId);
}

/**
 * Get all mainnet networks
 */
export function getMainnetNetworks(): NetworkId[] {
  return Object.entries(IS_TESTNET)
    .filter(([_, isTestnet]) => !isTestnet)
    .map(([network]) => network as NetworkId);
}

export default {
  getRpcForNetwork,
  getChainIdForNetwork,
  getNetworkFromChainId,
  getNetworkConfig,
  parseNetworkList,
  isValidNetwork,
  getSupportedNetworks,
  getTestnetNetworks,
  getMainnetNetworks,
  DEFAULT_RPC_URLS,
  CHAIN_IDS,
  NETWORK_NAMES,
  EXPLORER_URLS,
  IS_TESTNET,
};
