/**
 * Peer Discovery - Auto-discover relays from on-chain registry and add as Gun peers
 *
 * This module:
 * 1. Reads registered relays from the on-chain ShogunRelayRegistry
 * 2. Automatically adds them as GunDB peers for P2P sync
 * 3. Enables multi-relay architecture with automatic data replication
 *
 * The deposit tombstone mechanism in bridge-state.ts ensures deposits are only
 * processed once across all relays (markDepositProcessed/isDepositProcessed).
 */

import { createRegistryClient } from "./registry-client";
import { loggers } from "./logger";
import { GUN_PATHS, getGunNode } from "./gun-paths";
import { chatService } from "./chat-service";
import type { IGunInstance } from "gun";

const log = loggers.registry || console;

interface PeerSyncResult {
  added: string[];
  skipped: string[];
  failed: string[];
  total: number;
}

/**
 * Sync on-chain registered relays as Gun peers
 *
 * @param gun - GunDB instance
 * @param chainId - Chain ID for registry (84532 for Base Sepolia, 8453 for Base)
 * @param excludeEndpoint - Optional endpoint to exclude (usually our own)
 * @returns Sync result with added/skipped/failed counts
 */
export async function syncOnchainRelaysAsPeers(
  gun: IGunInstance,
  chainId: number = 84532,
  excludeEndpoint?: string
): Promise<PeerSyncResult> {
  const result: PeerSyncResult = {
    added: [],
    skipped: [],
    failed: [],
    total: 0,
  };

  try {
    const registryClient = createRegistryClient(chainId);
    const activeRelays = await registryClient.getActiveRelays();
    result.total = activeRelays.length;

    log.debug({ count: activeRelays.length }, "Found active relays on-chain");

    for (const relay of activeRelays) {
      try {
        if (!relay.endpoint) {
          log.debug({ address: relay.address }, "Relay has no endpoint, skipping");
          result.skipped.push(relay.address);
          continue;
        }

        // Normalize the endpoint
        let baseEndpoint = relay.endpoint.trim();

        // Remove trailing slash
        if (baseEndpoint.endsWith("/")) {
          baseEndpoint = baseEndpoint.slice(0, -1);
        }

        // Skip our own endpoint
        if (excludeEndpoint && baseEndpoint.toLowerCase() === excludeEndpoint.toLowerCase()) {
          log.debug({ endpoint: baseEndpoint }, "Skipping own endpoint");
          result.skipped.push(baseEndpoint);
          continue;
        }

        // Build Gun peer URL - add /gun if not already present
        let gunPeerUrl: string;
        if (baseEndpoint.endsWith("/gun")) {
          gunPeerUrl = baseEndpoint;
        } else {
          gunPeerUrl = `${baseEndpoint}/gun`;
        }

        // Add as Gun peer
        gun.opt({ peers: [gunPeerUrl] });

        log.debug(
          {
            address: relay.address,
            endpoint: baseEndpoint,
            gunPeer: gunPeerUrl,
          },
          "Added on-chain relay as Gun peer"
        );

        result.added.push(gunPeerUrl);
      } catch (error) {
        log.error({ error, relay: relay.address }, "Failed to add relay as peer");
        result.failed.push(relay.address);
      }
    }

    log.info(
      {
        added: result.added.length,
        skipped: result.skipped.length,
        failed: result.failed.length,
        total: result.total,
      },
      "On-chain relay peer sync completed"
    );

    return result;
  } catch (error) {
    log.error({ error }, "Failed to sync on-chain relays as peers");
    throw error;
  }
}

/**
 * Announce this relay's presence on GunDB
 * @param gun - GunDB instance
 * @param relayInfo - Relay information (endpoint, etc.)
 * @param pubKey - Relay's public key (SEA pub)
 */
export function announceRelayPresence(
  gun: IGunInstance,
  relayInfo: { endpoint: string; [key: string]: any },
  pubKey: string
): void {
  if (!pubKey || !relayInfo.endpoint) {
    log.warn("Cannot announce relay presence: missing pubKey or endpoint");
    return;
  }

  const presenceData = {
    ...relayInfo,
    lastSeen: Date.now(),
  };

  // Write to unified relays path
  getGunNode(gun, GUN_PATHS.RELAYS).get(pubKey).put(presenceData);
  
  // Also announce to PEERS path so Mules can find us as a generic peer
  getGunNode(gun, GUN_PATHS.PEERS).get(pubKey).put(presenceData);
  
  log.info({ pubKey, endpoint: relayInfo.endpoint }, "Announced relay presence on GunDB");
}

/**
 * Sync peers from GunDB (shogun/network/relays)
 * @param gun - GunDB instance
 * @param excludeEndpoint - Endpoint to exclude (our own)
 */
export function syncGunDBPeers(gun: IGunInstance, excludeEndpoint?: string): void {
  log.info("Starting GunDB peer discovery...");
  
  getGunNode(gun, GUN_PATHS.RELAYS).map().on((data: any, pubKey: string) => {
    if (!data || !data.endpoint) return;

    // Validate endpoint (basic check)
    if (typeof data.endpoint !== 'string' || !data.endpoint.startsWith('http')) {
      log.warn({ pubKey, data }, "Invalid endpoint in peer discovery");
      return;
    }

    let peerEndpoint = data.endpoint.trim();
    if (peerEndpoint.endsWith("/")) {
      peerEndpoint = peerEndpoint.slice(0, -1);
    }

    // Skip our own endpoint
    if (excludeEndpoint && peerEndpoint.toLowerCase() === excludeEndpoint.toLowerCase()) {
      return;
    }

    // Build Gun peer URL - add /gun if not already present
    let gunPeerUrl: string;
    if (peerEndpoint.endsWith("/gun")) {
      gunPeerUrl = peerEndpoint;
    } else {
      gunPeerUrl = `${peerEndpoint}/gun`;
    }

    // Add as peer
    gun.opt({ peers: [gunPeerUrl] });
    
    // Auto-subscribe to chat with this relay
    chatService.syncMessagesFrom(pubKey);

    log.info({ peer: gunPeerUrl, pubKey }, "Discovered peer via GunDB");
  });
}

/**
 * Sync generic peers (Mules) from GunDB (shogun/network/peers)
 * @param gun - GunDB instance
 */
export function syncMulePeers(gun: IGunInstance): void {
  log.info("Starting GunDB Mule peer discovery...");
  
  getGunNode(gun, GUN_PATHS.PEERS).map().on((data: any, pubKey: string) => {
    if (!data) return;
    
    // Auto-subscribe to chat with this peer (Mule)
    chatService.syncMessagesFrom(pubKey);
    
    // We don't add Mules as gun.opt({peers}) because they are likely not running Gun servers (or are behind NAT)
    // But we do want to discover them for chat.
  });
}

/**
 * Start periodic sync of on-chain relays AND GunDB discovery
 *
 * @param gun - GunDB instance
 * @param chainId - Chain ID for registry
 * @param excludeEndpoint - Endpoint to exclude (our own)
 * @param intervalMs - Sync interval in milliseconds (default: 5 minutes)
 * @returns Stop function to cancel the periodic sync
 */
export function startPeriodicPeerSync(
  gun: IGunInstance,
  chainId: number = 84532,
  excludeEndpoint?: string,
  intervalMs: number = 5 * 60 * 1000 // 5 minutes default
): () => void {
  let intervalId: NodeJS.Timeout | null = null;
  let isRunning = false;

  // Sync on-chain initially
  const doSync = async () => {
    if (isRunning) {
      log.debug("Peer sync already in progress, skipping");
      return;
    }

    isRunning = true;
    try {
      await syncOnchainRelaysAsPeers(gun, chainId, excludeEndpoint);
    } catch {
      // Error already logged in syncOnchainRelaysAsPeers
    } finally {
      isRunning = false;
    }
  };

  // Initial on-chain sync
  doSync();

  // Start periodic on-chain sync
  intervalId = setInterval(doSync, intervalMs);

  // Return stop function
  return () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}
