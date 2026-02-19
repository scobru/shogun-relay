/**
 * Unified GunDB paths for the Shogun network
 * 
 * These paths are shared between shogun-relay and shogun-mule
 * to ensure consistent network discovery and communication.
 */

export const GUN_PATHS = {
  // Base
  SHOGUN: 'shogun',
  SHOGUN_INDEX: 'shogun/index',

  // Network discovery
  RELAYS: 'shogun/network/relays',
  PEERS: 'shogun/network/peers',
  // TORRENTS removed

  // Chat
  LOBBY: 'shogun/chat/lobby',
  CHATS: 'shogun/chats',

  // Search index
  SEARCH: 'shogun/network/search',

  // User data
  USERS: 'shogun/users',
  UPLOADS: 'shogun/uploads',
  LOGS: 'shogun/logs',
  MB_USAGE: 'shogun/mbUsage',
  TEST: 'shogun/test',

  // Reputation and Features (unified under shogun/network)
  REPUTATION: 'shogun/network/reputation',
  PIN_REQUESTS: 'shogun/network/pin-requests',
  PIN_RESPONSES: 'shogun/network/pin-responses',

  // System
  SYSTEM_HASH: 'shogun/systemhash',

  // Indexes (unified under shogun/index)
  OBSERVATIONS_BY_HOST: 'shogun/index/observations-by-host',

  // Anna's Archive (torrent preservation network) - unified under shogun/
  // ANNAS_ARCHIVE removed

  // Wormhole
  SHOGUN_WORMHOLE: 'shogun/wormhole',
  WORMHOLE_TRANSFERS: 'transfers',              // Relative to SHOGUN_WORMHOLE

  // X402 (Payment/Subscription Protocol) - kept for legacy potential compatibility
  X402: 'shogun/x402',




} as const;

export type GunPath = typeof GUN_PATHS[keyof typeof GUN_PATHS];

/**
 * Helper to get a Gun node from a unified path string
 * Handles splitting path by '/' and traversing the graph hierarchically
 * 
 * @param gun - Gun instance
 * @param path - Path string (e.g. 'shogun/network/relays')
 * @returns - Gun node at the end of the path
 */
export const getGunNode = (gun: any, path: string): any => {
  const parts = path.split('/');
  let node = gun;
  for (const part of parts) {
    node = node.get(part);
  }
  return node;
};
