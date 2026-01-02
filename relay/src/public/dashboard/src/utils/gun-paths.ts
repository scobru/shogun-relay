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
  
  // Reputation and Features (unified under shogun/network)
  REPUTATION: 'shogun/network/reputation',
  PIN_REQUESTS: 'shogun/network/pin-requests',
  PIN_RESPONSES: 'shogun/network/pin-responses',
  
  // System
  SYSTEM_HASH: 'shogun/systemhash',
  
  // Indexes (unified under shogun/index)
  OBSERVATIONS_BY_HOST: 'shogun/index/observations-by-host',
  DEALS_BY_CID: 'shogun/index/deals-by-cid',
  DEALS_BY_CLIENT: 'shogun/index/deals-by-client',
  STORAGE_DEALS: 'shogun/frozen/storage-deals',
  FROZEN_STORAGE_DEALS: 'shogun/frozen/storage-deals',
  
  // Anna's Archive (torrent preservation network) - unified under shogun/
  ANNAS_ARCHIVE: 'shogun/annas-archive',
  
  // Wormhole
  SHOGUN_WORMHOLE: 'shogun/wormhole',
  WORMHOLE_TRANSFERS: 'transfers',              // Relative to SHOGUN_WORMHOLE
  
  // x402
  X402: 'shogun/x402',
  SUBSCRIPTIONS: 'subscriptions'                // Relative to X402 (so shogun/x402/subscriptions)
} as const;

export type GunPath = typeof GUN_PATHS[keyof typeof GUN_PATHS];
