/**
 * Unified GunDB paths for the Shogun network
 *
 * These paths are shared between shogun-relay and shogun-mule
 * to ensure consistent network discovery and communication.
 */

export const GUN_PATHS = {
  // Base
  SHOGUN: "shogun",
  SHOGUN_INDEX: "shogun/index",

  // Network discovery
  RELAYS: "shogun/network/relays",
  PEERS: "shogun/network/peers",
  TORRENTS: "shogun/network/torrents",

  // Chat
  LOBBY: "shogun/chat/lobby",
  CHATS: "shogun/chats",

  // Search index
  SEARCH: "shogun/network/search",

  // User data
  USERS: "shogun/users",
  UPLOADS: "shogun/uploads",
  LOGS: "shogun/logs",
  MB_USAGE: "shogun/mbUsage",
  TEST: "shogun/test",

  // Reputation and Features (unified under shogun/network)
  REPUTATION: "shogun/network/reputation",
  PIN_REQUESTS: "shogun/network/pin-requests",
  PIN_RESPONSES: "shogun/network/pin-responses",

  // System
  SYSTEM_HASH: "shogun/systemhash",

  // Indexes (unified under shogun/index)
  OBSERVATIONS_BY_HOST: "shogun/index/observations-by-host",
  DEALS_BY_CID: "shogun/index/deals-by-cid",
  DEALS_BY_CLIENT: "shogun/index/deals-by-client",
  STORAGE_DEALS: "shogun/frozen/storage-deals",
  FROZEN_STORAGE_DEALS: "shogun/frozen/storage-deals",

  // Anna's Archive (torrent preservation network) - unified under shogun/
  ANNAS_ARCHIVE: "shogun/annas-archive",

  // Legacy paths (for backwards compatibility)
  SHOGUN_DEALS: "shogun-deals",
  FROZEN_STORAGE_DEALS_LEGACY: "frozen-storage-deals",

  // Wormhole
  SHOGUN_WORMHOLE: "shogun/wormhole",
  WORMHOLE_TRANSFERS: "transfers", // Relative to SHOGUN_WORMHOLE

  // x402
  X402: "shogun/x402",
  SUBSCRIPTIONS: "subscriptions", // Relative to X402 (so shogun/x402/subscriptions)
  PAYMENTS: "payments", // Relative to X402 (so shogun/x402/payments)
} as const;

export type GunPath = (typeof GUN_PATHS)[keyof typeof GUN_PATHS];

// Cache for Gun nodes to prevent repetitive graph traversal and string splitting
const gunNodeCache = new WeakMap<any, Map<string, any>>();

/**
 * Helper to get a Gun node from a unified path string
 * Handles splitting path by '/' and traversing the graph hierarchically
 *
 * @param gun - Gun instance
 * @param path - Path string (e.g. 'shogun/network/relays')
 * @returns - Gun node at the end of the path
 */
export const getGunNode = (gun: any, path: string): any => {
  // Check cache first to avoid repetitive string splitting and traversal
  let instanceCache = gunNodeCache.get(gun);
  if (!instanceCache) {
    instanceCache = new Map<string, any>();
    gunNodeCache.set(gun, instanceCache);
  }

  const cachedNode = instanceCache.get(path);
  if (cachedNode) {
    return cachedNode;
  }

  const parts = path.split("/");
  let node = gun;
  for (const part of parts) {
    node = node.get(part);
  }

  // Store in cache for future use
  instanceCache.set(path, node);

  return node;
};
