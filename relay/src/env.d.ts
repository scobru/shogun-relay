/**
 * Type declarations for environment variables
 * This file helps TypeScript understand the types of process.env variables
 */

declare namespace NodeJS {
  interface ProcessEnv {
    // Required Configuration
    ADMIN_PASSWORD?: string;

    // Relay Identity
    RELAY_HOST?: string;
    RELAY_PORT?: string;
    RELAY_NAME?: string;

    // IPFS Configuration
    IPFS_API_URL?: string;
    IPFS_GATEWAY_URL?: string;
    IPFS_API_TOKEN?: string;

    // GunDB Configuration
    RELAY_SEA_KEYPAIR?: string;
    RELAY_SEA_KEYPAIR_PATH?: string;
    RELAY_PEERS?: string;
    RELAY_PROTECTED?: string;
    DISABLE_RADISK?: string;
    CLEANUP_CORRUPTED_DATA?: string;

    // On-chain Registry
    RELAY_PRIVATE_KEY?: string;
    REGISTRY_CHAIN_ID?: string;

    // X402 Payment Configuration
    X402_PAY_TO_ADDRESS?: string;
    X402_PRIVATE_KEY?: string;
    X402_NETWORK?: string;
    X402_SETTLEMENT_MODE?: string;
    X402_FACILITATOR_URL?: string;
    X402_FACILITATOR_API_KEY?: string;
    X402_RPC_URL?: string;

    // Pricing Configuration
    DEAL_PRICE_STANDARD?: string;
    DEAL_PRICE_PREMIUM?: string;
    DEAL_PRICE_ENTERPRISE?: string;
    DEAL_MIN_SIZE_MB?: string;
    DEAL_MAX_SIZE_MB?: string;
    DEAL_MIN_DURATION_DAYS?: string;
    DEAL_MAX_DURATION_DAYS?: string;
    DEAL_PREMIUM_REPLICATION?: string;
    DEAL_ENTERPRISE_REPLICATION?: string;
    SUB_BASIC_PRICE?: string;
    SUB_BASIC_STORAGE_MB?: string;
    SUB_STANDARD_PRICE?: string;
    SUB_STANDARD_STORAGE_MB?: string;
    SUB_PREMIUM_PRICE?: string;
    SUB_PREMIUM_STORAGE_MB?: string;
    SUB_DURATION_DAYS?: string;

    // Storage Limits
    RELAY_MAX_STORAGE_GB?: string;
    RELAY_STORAGE_WARNING_THRESHOLD?: string;

    // Network Federation
    AUTO_REPLICATION?: string;

    // Holster Relay
    HOLSTER_RELAY_HOST?: string;
    HOLSTER_RELAY_PORT?: string;
    HOLSTER_RELAY_STORAGE?: string;
    HOLSTER_RELAY_STORAGE_PATH?: string;
    HOLSTER_MAX_CONNECTIONS?: string;

    // Advanced Options
    DATA_DIR?: string;
    RELAY_QR?: string;
    RELAY_STORE?: string;
    RELAY_PATH?: string;
    PORT?: string;
    NODE_ENV?: 'development' | 'production' | 'test';
    STRICT_SESSION_IP?: string;
    ENABLE_METRICS?: string;
    ENABLE_HEALTH?: string;
  }
}

