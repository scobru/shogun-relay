/**
 * Centralized Environment Variables Configuration
 *
 * This file centralizes all environment variables used throughout the Shogun Relay application.
 * All environment variables should be imported from this file instead of directly from process.env.
 *
 * Priority: Environment variables > Default values
 * 
 * Multi-Chain Support:
 * - X402_NETWORKS, X402_DEFAULT_NETWORK, X402_<NETWORK>_RPC
 * - BRIDGE_NETWORKS, BRIDGE_DEFAULT_NETWORK, BRIDGE_<NETWORK>_RPC
 * - DEALS_NETWORKS, DEALS_DEFAULT_NETWORK, DEALS_<NETWORK>_RPC
 */

import dotenv from "dotenv";
import path from "path";
import ip from "ip";
import { 
  parseNetworkList, 
  getRpcForNetwork, 
  getChainIdForNetwork,
  type NetworkId 
} from "./chains";

dotenv.config();

// ============================================================================
// SERVER / RELAY CONFIGURATION
// ============================================================================

export const config = {
  // Server Configuration
  server: {
    host: process.env.RELAY_HOST || ip.address(),
    port: (() => {
      const port = parseInt(process.env.RELAY_PORT || process.env.PORT || "8765");
      if (isNaN(port) || port <= 0 || port >= 65536) {
        return 8765;
      }
      return port;
    })(),
    publicPath: process.env.RELAY_PATH || "public",
    nodeEnv: process.env.NODE_ENV || "development",
    welcomeMessage:
      process.env.WELCOME_MESSAGE ||
      `
*** WELCOME TO SHOGUN RELAY ***
`,
  },

  // Relay Identity
  relay: {
    name: process.env.RELAY_NAME || "shogun-relay",
    environment: process.env.NODE_ENV || "development",
    protected: process.env.RELAY_PROTECTED === "true",
    endpoint: process.env.RELAY_ENDPOINT,
    peers: process.env.RELAY_PEERS ? process.env.RELAY_PEERS.split(",") : [],
  },

  // ============================================================================
  // IPFS CONFIGURATION
  // ============================================================================

  ipfs: {
    apiUrl: process.env.IPFS_API_URL || "http://127.0.0.1:5001",
    apiToken: process.env.IPFS_API_TOKEN || process.env.IPFS_API_KEY,
    gatewayUrl: process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080",
    pinTimeoutMs: parseInt(process.env.IPFS_PIN_TIMEOUT_MS || "120000") || 120000,
    // Parsed IPFS API URL components
    apiHost: (() => {
      try {
        const url = new URL(process.env.IPFS_API_URL || "http://127.0.0.1:5001");
        return url.hostname;
      } catch {
        return "127.0.0.1";
      }
    })(),
    apiPort: (() => {
      try {
        const url = new URL(process.env.IPFS_API_URL || "http://127.0.0.1:5001");
        return parseInt(url.port) || 5001;
      } catch {
        return 5001;
      }
    })(),
  },

  // ============================================================================
  // AUTHENTICATION / SECURITY
  // ============================================================================

  auth: {
    adminPassword: process.env.ADMIN_PASSWORD,
    strictSessionIp: process.env.STRICT_SESSION_IP !== "false",
    // CORS configuration
    corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",") : ["*"],
    corsCredentials: process.env.CORS_CREDENTIALS === "true",
  },

  // ============================================================================
  // HOLSTER CONFIGURATION
  // ============================================================================

  holster: {
    host: process.env.HOLSTER_RELAY_HOST || "0.0.0.0",
    port: (() => {
      const mainPort = parseInt(process.env.RELAY_PORT || process.env.PORT || "8765");
      const holsterPort = parseInt(process.env.HOLSTER_RELAY_PORT || "0");
      return holsterPort || mainPort + 1;
    })(),
    storageEnabled: process.env.HOLSTER_RELAY_STORAGE === "true" || true,
    storagePath: process.env.HOLSTER_RELAY_STORAGE_PATH || path.join(process.cwd(), "holster-data"),
    maxConnections: parseInt(process.env.HOLSTER_MAX_CONNECTIONS || "100") || 100,
  },

  // ============================================================================
  // GUN DB / STORAGE CONFIGURATION
  // ============================================================================

  storage: {
    dataDir: process.env.DATA_DIR || path.join(process.cwd(), "data"),
    storageType: (process.env.STORAGE_TYPE || "sqlite").toLowerCase(),
    disableRadisk: process.env.DISABLE_RADISK === "true",
    maxStorageGB: parseFloat(process.env.RELAY_MAX_STORAGE_GB || "0") || 0,
    storageWarningThreshold: parseFloat(process.env.RELAY_STORAGE_WARNING_THRESHOLD || "80") || 80,
  },

  // Relay SEA Keypair Configuration
  relayKeys: {
    seaKeypair: process.env.RELAY_SEA_KEYPAIR,
    seaKeypairPath: process.env.RELAY_SEA_KEYPAIR_PATH,
  },

  // ============================================================================
  // BLOCKCHAIN / RPC CONFIGURATION
  // ============================================================================

  blockchain: {
    registryChainId: parseInt(process.env.REGISTRY_CHAIN_ID || "84532"),
    relayPrivateKey: process.env.RELAY_PRIVATE_KEY,
  },

  // ============================================================================
  // X402 PAYMENT CONFIGURATION (Multi-Chain)
  // ============================================================================

  x402: {
    // Multi-chain configuration
    networks: parseNetworkList(process.env.X402_NETWORKS, ['base-sepolia']),
    defaultNetwork: (process.env.X402_DEFAULT_NETWORK || 'base-sepolia') as NetworkId,
    
    // Get RPC URL for specific network (or default)
    getRpcUrl: (network?: NetworkId): string => {
      const targetNetwork = network || (process.env.X402_DEFAULT_NETWORK || 'base-sepolia') as NetworkId;
      return getRpcForNetwork(targetNetwork, 'x402');
    },
    
    // Get chain ID for specific network (or default)
    getChainId: (network?: NetworkId): number => {
      const targetNetwork = network || (process.env.X402_DEFAULT_NETWORK || 'base-sepolia') as NetworkId;
      return getChainIdForNetwork(targetNetwork);
    },
    
    // RPC URLs map for all configured networks
    rpcUrls: (() => {
      const networks = parseNetworkList(process.env.X402_NETWORKS, ['base-sepolia']);
      const urls: Record<string, string> = {};
      for (const network of networks) {
        urls[network] = getRpcForNetwork(network, 'x402');
      }
      return urls;
    })(),
    
    // Default chain ID (for backward compatibility)
    chainId: getChainIdForNetwork((process.env.X402_DEFAULT_NETWORK || 'base-sepolia') as NetworkId),
    
    // Payment configuration
    payToAddress: process.env.X402_PAY_TO_ADDRESS,
    privateKey: process.env.X402_PRIVATE_KEY,
    facilitatorUrl: process.env.X402_FACILITATOR_URL,
    facilitatorApiKey: process.env.X402_FACILITATOR_API_KEY,
    settlementMode: process.env.X402_SETTLEMENT_MODE as "facilitator" | "direct" | undefined,
  },

  // ============================================================================
  // BRIDGE CONFIGURATION (Multi-Chain)
  // ============================================================================

  bridge: {
    enabled: process.env.BRIDGE_ENABLED !== "false",
    
    // Multi-chain configuration
    networks: parseNetworkList(process.env.BRIDGE_NETWORKS, ['base-sepolia']),
    defaultNetwork: (process.env.BRIDGE_DEFAULT_NETWORK || 'base-sepolia') as NetworkId,
    
    // Get RPC URL for specific network (or default)
    getRpcUrl: (network?: NetworkId): string => {
      const targetNetwork = network || (process.env.BRIDGE_DEFAULT_NETWORK || 'base-sepolia') as NetworkId;
      return getRpcForNetwork(targetNetwork, 'bridge');
    },
    
    // Get chain ID for specific network (or default)
    getChainId: (network?: NetworkId): number => {
      const targetNetwork = network || (process.env.BRIDGE_DEFAULT_NETWORK || 'base-sepolia') as NetworkId;
      return getChainIdForNetwork(targetNetwork);
    },
    
    // RPC URLs map for all configured networks
    rpcUrls: (() => {
      const networks = parseNetworkList(process.env.BRIDGE_NETWORKS, ['base-sepolia']);
      const urls: Record<string, string> = {};
      for (const network of networks) {
        urls[network] = getRpcForNetwork(network, 'bridge');
      }
      return urls;
    })(),
    
    // Default chain ID (for backward compatibility)
    chainId: getChainIdForNetwork((process.env.BRIDGE_DEFAULT_NETWORK || 'base-sepolia') as NetworkId),
    
    // Sequencer configuration
    sequencerPrivateKey: process.env.BRIDGE_SEQUENCER_PRIVATE_KEY || process.env.RELAY_PRIVATE_KEY,
    startBlock: process.env.BRIDGE_START_BLOCK
      ? parseInt(process.env.BRIDGE_START_BLOCK)
      : undefined,
    minConfirmations: parseInt(process.env.BRIDGE_MIN_CONFIRMATIONS || "3") || 3,
    
    // Auto batch submission
    autoBatchEnabled: process.env.BRIDGE_AUTO_BATCH_ENABLED !== "false",
    autoBatchIntervalMs:
      parseInt(process.env.BRIDGE_AUTO_BATCH_INTERVAL_MS || "300000") || 5 * 60 * 1000,
    autoBatchMinWithdrawals: parseInt(process.env.BRIDGE_AUTO_BATCH_MIN_WITHDRAWALS || "1") || 1,
    
    // Security: Allowed chain IDs
    validChainIds: process.env.BRIDGE_VALID_CHAIN_IDS
      ? process.env.BRIDGE_VALID_CHAIN_IDS.split(",")
        .map((id) => parseInt(id.trim()))
        .filter((id) => !isNaN(id))
      : [1, 11155111, 8453, 84532, 42161, 421614, 10, 11155420, 137, 80002],
  },

  // ============================================================================
  // DEALS CONFIGURATION (Multi-Chain)
  // ============================================================================

  deals: {
    // Multi-chain configuration
    networks: parseNetworkList(process.env.DEALS_NETWORKS, ['base-sepolia']),
    defaultNetwork: (process.env.DEALS_DEFAULT_NETWORK || 'base-sepolia') as NetworkId,
    
    // Get RPC URL for specific network (or default)
    getRpcUrl: (network?: NetworkId): string => {
      const targetNetwork = network || (process.env.DEALS_DEFAULT_NETWORK || 'base-sepolia') as NetworkId;
      return getRpcForNetwork(targetNetwork, 'deals');
    },
    
    // Get chain ID for specific network (or default)
    getChainId: (network?: NetworkId): number => {
      const targetNetwork = network || (process.env.DEALS_DEFAULT_NETWORK || 'base-sepolia') as NetworkId;
      return getChainIdForNetwork(targetNetwork);
    },
    
    // RPC URLs map for all configured networks
    rpcUrls: (() => {
      const networks = parseNetworkList(process.env.DEALS_NETWORKS, ['base-sepolia']);
      const urls: Record<string, string> = {};
      for (const network of networks) {
        urls[network] = getRpcForNetwork(network, 'deals');
      }
      return urls;
    })(),
    
    // Default chain ID (for backward compatibility)
    chainId: getChainIdForNetwork((process.env.DEALS_DEFAULT_NETWORK || 'base-sepolia') as NetworkId),
  },

  // ============================================================================
  // DEAL SYNC CONFIGURATION
  // ============================================================================

  dealSync: {
    enabled: process.env.DEAL_SYNC_ENABLED !== "false",
    intervalMs: parseInt(process.env.DEAL_SYNC_INTERVAL_MS || "300000") || 5 * 60 * 1000,
    fastIntervalMs: parseInt(process.env.DEAL_SYNC_FAST_INTERVAL_MS || "120000") || 2 * 60 * 1000,
    initialDelayMs: parseInt(process.env.DEAL_SYNC_INITIAL_DELAY_MS || "30000") || 30 * 1000,
  },

  // ============================================================================
  // WORMHOLE CLEANUP CONFIGURATION
  // ============================================================================

  wormhole: {
    cleanupEnabled: process.env.WORMHOLE_CLEANUP_ENABLED !== "false",
    cleanupIntervalMs: parseInt(process.env.WORMHOLE_CLEANUP_INTERVAL_MS || "3600000") || 60 * 60 * 1000,
    maxAgeSecs: parseInt(process.env.WORMHOLE_MAX_AGE_SECS || "86400") || 24 * 60 * 60,
  },

  // ============================================================================
  // REPLICATION / NETWORK CONFIGURATION
  // ============================================================================

  replication: {
    autoReplication: process.env.AUTO_REPLICATION !== "false",
  },

  // ============================================================================
  // LOGGING CONFIGURATION
  // ============================================================================

  logging: {
    logLevel:
      (process.env.LOG_LEVEL as string) ||
      (process.env.NODE_ENV !== "production" ? "debug" : "info"),
    debug: process.env.DEBUG === "true" || !!process.env.DEBUG,
  },

  // ============================================================================
  // PRICING CONFIGURATION
  // ============================================================================

  pricing: {
    // Deal Pricing
    dealPriceStandard: parseFloat(process.env.DEAL_PRICE_STANDARD || "0.0001"),
    dealPricePremium: parseFloat(process.env.DEAL_PRICE_PREMIUM || "0.0002"),
    dealPriceEnterprise: parseFloat(process.env.DEAL_PRICE_ENTERPRISE || "0.0005"),
    dealMinSizeMB: parseFloat(process.env.DEAL_MIN_SIZE_MB || "0.001"),
    dealMaxSizeMB: parseFloat(process.env.DEAL_MAX_SIZE_MB || "1000"),
    dealMinDurationDays: parseInt(process.env.DEAL_MIN_DURATION_DAYS || "7"),
    dealMaxDurationDays: parseInt(process.env.DEAL_MAX_DURATION_DAYS || "365"),
    dealPremiumReplication: parseInt(process.env.DEAL_PREMIUM_REPLICATION || "3"),
    dealEnterpriseReplication: parseInt(process.env.DEAL_ENTERPRISE_REPLICATION || "5"),

    // Subscription Pricing
    subBasicStorageMB: parseInt(process.env.SUB_BASIC_STORAGE_MB || "100"),
    subBasicPrice: parseFloat(process.env.SUB_BASIC_PRICE || "0.001"),
    subStandardStorageMB: parseInt(process.env.SUB_STANDARD_STORAGE_MB || "500"),
    subStandardPrice: parseFloat(process.env.SUB_STANDARD_PRICE || "0.004"),
    subPremiumStorageMB: parseInt(process.env.SUB_PREMIUM_STORAGE_MB || "2000"),
    subPremiumPrice: parseFloat(process.env.SUB_PREMIUM_PRICE || "0.01"),
    subDurationDays: parseInt(process.env.SUB_DURATION_DAYS || "30"),
  },

  // ============================================================================
  // PACKAGE METADATA
  // ============================================================================

  package: {
    version: process.env.npm_package_version || "1.0.0",
  },
};

// ============================================================================
// EXPORT INDIVIDUAL CONFIGURATION OBJECTS FOR CONVENIENCE
// ============================================================================

export const serverConfig = config.server;
export const relayConfig = config.relay;
export const ipfsConfig = config.ipfs;
export const authConfig = config.auth;
export const holsterConfig = config.holster;
export const storageConfig = config.storage;
export const relayKeysConfig = config.relayKeys;
export const blockchainConfig = config.blockchain;
export const x402Config = config.x402;
export const bridgeConfig = config.bridge;
export const dealsConfig = config.deals;
export const dealSyncConfig = config.dealSync;
export const wormholeConfig = config.wormhole;
export const replicationConfig = config.replication;
export const loggingConfig = config.logging;
export const pricingConfig = config.pricing;
export const packageConfig = config.package;

// ============================================================================
// EXPORT DEFAULT
// ============================================================================

export default config;
