/**
 * Type declarations for centralized environment configuration
 */

export interface ServerConfig {
  host: string;
  port: number;
  publicPath: string;
  nodeEnv: string;
  welcomeMessage: string;
}

export interface RelayConfig {
  name: string;
  protected: boolean;
  endpoint?: string;
  peers: string[];
}

export interface IPFSConfig {
  apiUrl: string;
  apiToken?: string;
  gatewayUrl: string;
  pinTimeoutMs: number;
  apiHost: string;
  apiPort: number;
}

export interface AuthConfig {
  adminPassword?: string;
  strictSessionIp: boolean;
}

export interface HolsterConfig {
  host: string;
  port: number;
  storageEnabled: boolean;
  storagePath: string;
  maxConnections: number;
}

export interface StorageConfig {
  dataDir: string;
  storageType: string;
  disableRadisk: boolean;
}

export interface RelayKeysConfig {
  seaKeypair?: string;
  seaKeypairPath?: string;
}

export interface BlockchainConfig {
  registryChainId: number;
  relayPrivateKey?: string;
}

export interface X402Config {
  network: string;
  rpcUrl?: string;
  payToAddress?: string;
}

export interface DealSyncConfig {
  enabled: boolean;
  intervalMs: number;
  fastIntervalMs: number;
  initialDelayMs: number;
}

export interface ReplicationConfig {
  autoReplication: boolean;
}

export interface LoggingConfig {
  logLevel: string;
  debug: boolean;
}

export interface PricingConfig {
  dealPriceStandard: number;
  dealPricePremium: number;
  dealPriceEnterprise: number;
  dealMinSizeMB: number;
  dealMaxSizeMB: number;
  dealMinDurationDays: number;
  dealMaxDurationDays: number;
  dealPremiumReplication: number;
  dealEnterpriseReplication: number;
  subBasicStorageMB: number;
  subBasicPrice: number;
  subStandardStorageMB: number;
  subStandardPrice: number;
  subPremiumStorageMB: number;
  subPremiumPrice: number;
  subDurationDays: number;
}

export interface PackageConfig {
  version: string;
}

export interface TorrentConfig {
  enabled: boolean;
  annasArchiveUrl: string;
  dataDir: string;
  maxTb: number;
}

export interface DriveConfig {
  dataDir: string;
}

export interface EnvConfig {
  server: ServerConfig;
  relay: RelayConfig;
  ipfs: IPFSConfig;
  auth: AuthConfig;
  holster: HolsterConfig;
  storage: StorageConfig;
  relayKeys: RelayKeysConfig;
  blockchain: BlockchainConfig;
  x402: X402Config;
  dealSync: DealSyncConfig;
  replication: ReplicationConfig;
  logging: LoggingConfig;
  pricing: PricingConfig;
  package: PackageConfig;
  torrent: TorrentConfig;
  drive: DriveConfig;
}

declare const config: EnvConfig;

export const serverConfig: ServerConfig;
export const relayConfig: RelayConfig;
export const ipfsConfig: IPFSConfig;
export const authConfig: AuthConfig;
export const holsterConfig: HolsterConfig;
export const storageConfig: StorageConfig;
export const relayKeysConfig: RelayKeysConfig;
export const blockchainConfig: BlockchainConfig;
export const x402Config: X402Config;
export const dealSyncConfig: DealSyncConfig;
export const replicationConfig: ReplicationConfig;
export const loggingConfig: LoggingConfig;
export const pricingConfig: PricingConfig;
export const packageConfig: PackageConfig;
export const torrentConfig: TorrentConfig;
export const driveConfig: DriveConfig;

export default config;
