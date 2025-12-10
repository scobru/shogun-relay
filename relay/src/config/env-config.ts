/**
 * Centralized Environment Variables Configuration
 * 
 * This file centralizes all environment variables used throughout the Shogun Relay application.
 * All environment variables should be imported from this file instead of directly from process.env.
 * 
 * Priority: Environment variables > Default values
 */

import dotenv from 'dotenv';
import path from 'path';
import ip from 'ip';

dotenv.config();

// ============================================================================
// SERVER / RELAY CONFIGURATION
// ============================================================================

export const config = {
  // Server Configuration
  server: {
    host: process.env.RELAY_HOST || ip.address(),
    port: (() => {
      const port = parseInt(process.env.RELAY_PORT || process.env.PORT || '8765');
      if (isNaN(port) || port <= 0 || port >= 65536) {
        return 8765;
      }
      return port;
    })(),
    publicPath: process.env.RELAY_PATH || 'public',
    nodeEnv: process.env.NODE_ENV || 'development',
    welcomeMessage: process.env.WELCOME_MESSAGE || `
*** WELCOME TO SHOGUN RELAY ***
`,
  },

  // Relay Identity
  relay: {
    name: process.env.RELAY_NAME || 'shogun-relay',
    environment: process.env.NODE_ENV || 'development',
    protected: process.env.RELAY_PROTECTED === 'true',
    endpoint: process.env.RELAY_ENDPOINT,
    peers: process.env.RELAY_PEERS ? process.env.RELAY_PEERS.split(',') : [],
  },

  // ============================================================================
  // IPFS CONFIGURATION
  // ============================================================================

  ipfs: {
    apiUrl: process.env.IPFS_API_URL || 'http://127.0.0.1:5001',
    apiToken: process.env.IPFS_API_TOKEN || process.env.IPFS_API_KEY,
    gatewayUrl: process.env.IPFS_GATEWAY_URL || 'http://127.0.0.1:8080',
    pinTimeoutMs: parseInt(process.env.IPFS_PIN_TIMEOUT_MS || '120000') || 120000,
    // Parsed IPFS API URL components
    apiHost: (() => {
      try {
        const url = new URL(process.env.IPFS_API_URL || 'http://127.0.0.1:5001');
        return url.hostname;
      } catch {
        return '127.0.0.1';
      }
    })(),
    apiPort: (() => {
      try {
        const url = new URL(process.env.IPFS_API_URL || 'http://127.0.0.1:5001');
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
    strictSessionIp: process.env.STRICT_SESSION_IP !== 'false',
  },

  // ============================================================================
  // HOLSTER CONFIGURATION
  // ============================================================================

  holster: {
    host: process.env.HOLSTER_RELAY_HOST || '0.0.0.0',
    port: (() => {
      const mainPort = parseInt(process.env.RELAY_PORT || process.env.PORT || '8765');
      const holsterPort = parseInt(process.env.HOLSTER_RELAY_PORT || '0');
      return holsterPort || mainPort + 1;
    })(),
    storageEnabled: process.env.HOLSTER_RELAY_STORAGE === 'true' || true,
    storagePath: process.env.HOLSTER_RELAY_STORAGE_PATH || path.join(process.cwd(), 'holster-data'),
    maxConnections: parseInt(process.env.HOLSTER_MAX_CONNECTIONS || '100') || 100,
  },

  // ============================================================================
  // GUN DB / STORAGE CONFIGURATION
  // ============================================================================

  storage: {
    dataDir: process.env.DATA_DIR || path.join(process.cwd(), 'data'),
    storageType: (process.env.STORAGE_TYPE || 'sqlite').toLowerCase(),
    disableRadisk: process.env.DISABLE_RADISK === 'true',
    maxStorageGB: parseFloat(process.env.RELAY_MAX_STORAGE_GB || '0') || 0,
    storageWarningThreshold: parseFloat(process.env.RELAY_STORAGE_WARNING_THRESHOLD || '80') || 80,
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
    registryChainId: parseInt(process.env.REGISTRY_CHAIN_ID || '84532'),
    relayPrivateKey: process.env.RELAY_PRIVATE_KEY,
  },

  // X402 Payment Configuration
  x402: {
    network: process.env.X402_NETWORK || 'base-sepolia',
    rpcUrl: process.env.X402_RPC_URL,
    payToAddress: process.env.X402_PAY_TO_ADDRESS,
    privateKey: process.env.X402_PRIVATE_KEY,
    facilitatorUrl: process.env.X402_FACILITATOR_URL,
    facilitatorApiKey: process.env.X402_FACILITATOR_API_KEY,
    settlementMode: process.env.X402_SETTLEMENT_MODE as 'facilitator' | 'direct' | undefined,
  },

  // ============================================================================
  // DEAL SYNC CONFIGURATION
  // ============================================================================

  dealSync: {
    enabled: process.env.DEAL_SYNC_ENABLED !== 'false',
    intervalMs: parseInt(process.env.DEAL_SYNC_INTERVAL_MS || '300000') || 5 * 60 * 1000, // 5 minutes
    fastIntervalMs: parseInt(process.env.DEAL_SYNC_FAST_INTERVAL_MS || '120000') || 2 * 60 * 1000, // 2 minutes
    initialDelayMs: parseInt(process.env.DEAL_SYNC_INITIAL_DELAY_MS || '30000') || 30 * 1000, // 30 seconds
  },

  // ============================================================================
  // BRIDGE CONFIGURATION (L2 Bridge)
  // ============================================================================

  bridge: {
    enabled: process.env.BRIDGE_ENABLED !== 'false',
    // contractAddress is no longer needed - SDK gets it from deployments automatically
    rpcUrl: process.env.BRIDGE_RPC_URL || process.env.REGISTRY_RPC_URL,
    chainId: parseInt(process.env.BRIDGE_CHAIN_ID || process.env.REGISTRY_CHAIN_ID || '84532'),
    sequencerPrivateKey: process.env.BRIDGE_SEQUENCER_PRIVATE_KEY || process.env.RELAY_PRIVATE_KEY,
    startBlock: process.env.BRIDGE_START_BLOCK ? parseInt(process.env.BRIDGE_START_BLOCK) : undefined,
    minConfirmations: parseInt(process.env.BRIDGE_MIN_CONFIRMATIONS || '3') || 3, // Security: wait for 3 block confirmations
    // Auto batch submission (if relay can act as sequencer)
    autoBatchEnabled: process.env.BRIDGE_AUTO_BATCH_ENABLED !== 'false',
    autoBatchIntervalMs: parseInt(process.env.BRIDGE_AUTO_BATCH_INTERVAL_MS || '300000') || 5 * 60 * 1000, // 5 minutes
    autoBatchMinWithdrawals: parseInt(process.env.BRIDGE_AUTO_BATCH_MIN_WITHDRAWALS || '1') || 1,
  },

  // ============================================================================
  // REPLICATION / NETWORK CONFIGURATION
  // ============================================================================

  replication: {
    autoReplication: process.env.AUTO_REPLICATION !== 'false',
  },

  // ============================================================================
  // LOGGING CONFIGURATION
  // ============================================================================

  logging: {
    logLevel: (process.env.LOG_LEVEL as string) || (process.env.NODE_ENV !== 'production' ? 'debug' : 'info'),
    debug: process.env.DEBUG === 'true' || !!process.env.DEBUG,
  },

  // ============================================================================
  // PRICING CONFIGURATION (Environment Variables)
  // ============================================================================

  pricing: {
    // Deal Pricing
    dealPriceStandard: parseFloat(process.env.DEAL_PRICE_STANDARD || '0.0001'),
    dealPricePremium: parseFloat(process.env.DEAL_PRICE_PREMIUM || '0.0002'),
    dealPriceEnterprise: parseFloat(process.env.DEAL_PRICE_ENTERPRISE || '0.0005'),
    dealMinSizeMB: parseFloat(process.env.DEAL_MIN_SIZE_MB || '0.001'),
    dealMaxSizeMB: parseFloat(process.env.DEAL_MAX_SIZE_MB || '1000'),
    dealMinDurationDays: parseInt(process.env.DEAL_MIN_DURATION_DAYS || '7'),
    dealMaxDurationDays: parseInt(process.env.DEAL_MAX_DURATION_DAYS || '365'),
    dealPremiumReplication: parseInt(process.env.DEAL_PREMIUM_REPLICATION || '3'),
    dealEnterpriseReplication: parseInt(process.env.DEAL_ENTERPRISE_REPLICATION || '5'),

    // Subscription Pricing
    subBasicStorageMB: parseInt(process.env.SUB_BASIC_STORAGE_MB || '100'),
    subBasicPrice: parseFloat(process.env.SUB_BASIC_PRICE || '0.001'),
    subStandardStorageMB: parseInt(process.env.SUB_STANDARD_STORAGE_MB || '500'),
    subStandardPrice: parseFloat(process.env.SUB_STANDARD_PRICE || '0.004'),
    subPremiumStorageMB: parseInt(process.env.SUB_PREMIUM_STORAGE_MB || '2000'),
    subPremiumPrice: parseFloat(process.env.SUB_PREMIUM_PRICE || '0.01'),
    subDurationDays: parseInt(process.env.SUB_DURATION_DAYS || '30'),
  },

  // ============================================================================
  // PACKAGE METADATA
  // ============================================================================

  package: {
    version: process.env.npm_package_version || '1.0.0',
  },
} as const;

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
export const dealSyncConfig = config.dealSync;
export const bridgeConfig = config.bridge;
export const replicationConfig = config.replication;
export const loggingConfig = config.logging;
export const pricingConfig = config.pricing;
export const packageConfig = config.package;

// ============================================================================
// EXPORT DEFAULT
// ============================================================================

export default config;
