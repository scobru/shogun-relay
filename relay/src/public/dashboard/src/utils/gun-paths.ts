/**
 * Unified GunDB paths for the Shogun network
 * 
 * These paths are shared between shogun-relay and shogun-mule
 * to ensure consistent network discovery and communication.
 * 
 * NOTE: This is a copy for the dashboard frontend. Keep in sync with
 * relay/src/utils/gun-paths.ts
 */

export const GUN_PATHS = {
  // Base
  SHOGUN: 'shogun',
  SHOGUN_INDEX: 'shogun/index',
  
  // Network discovery
  RELAYS: 'shogun/network/relays',
  PEERS: 'shogun/network/peers',
  TORRENTS: 'shogun/network/torrents',
  
  // Chat
  LOBBY: 'shogun/chat/lobby',
  CHATS: 'shogun/chats',
  
  // Search index
  SEARCH: 'shogun/network/search',
  
  // User data
  USERS: 'shogun/users',
  UPLOADS: 'shogun/uploads',
  LOGS: 'shogun/logs',
  
  // Reputation and Features
  REPUTATION: 'shogun/network/reputation',
  PIN_REQUESTS: 'shogun/network/pin-requests',
  
  // System
  SYSTEM_HASH: 'shogun/systemhash',
  
  // Indexes
  OBSERVATIONS_BY_HOST: 'observations-by-host', // Relative to SHOGUN_INDEX
  DEALS_BY_CID: 'deals-by-cid',                 // Relative to SHOGUN_INDEX
  DEALS_BY_CLIENT: 'deals-by-client',           // Relative to SHOGUN_INDEX
  STORAGE_DEALS: 'storage-deals',               // Relative path for frozen namespace
  FROZEN_STORAGE_DEALS: 'frozen/storage-deals', // Full path for frozen storage deals
  
  // Anna's Archive (torrent preservation network)
  ANNAS_ARCHIVE: 'annas-archive',
  
  // Wormhole
  SHOGUN_WORMHOLE: 'shogun/wormhole',
  WORMHOLE_TRANSFERS: 'transfers',              // Relative to SHOGUN_WORMHOLE
  
  // x402
  X402: 'shogun/x402',
  SUBSCRIPTIONS: 'subscriptions'                // Relative to X402 (so shogun/x402/subscriptions)
} as const;

export type GunPath = typeof GUN_PATHS[keyof typeof GUN_PATHS];
