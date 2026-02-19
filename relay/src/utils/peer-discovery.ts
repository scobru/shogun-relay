/**
 * Peer Discovery - Auto-discover relays from GunDB and add as Gun peers
 *
 * This module:
 * 1. Reads relay announcements from GunDB (shogun/network/relays)
 * 2. Automatically adds them as GunDB peers for P2P sync
 * 3. Enables multi-relay architecture with automatic data replication
 *
 * Note: On-chain peer discovery has been moved to shogun-commerce.
 */

import { loggers } from "./logger";
import { GUN_PATHS, getGunNode } from "./gun-paths";
import { chatService } from "./chat-service";
import type { IGunInstance } from "gun";

const log = loggers.registry || console;

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
