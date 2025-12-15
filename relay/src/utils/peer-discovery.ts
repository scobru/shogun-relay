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
 * Start periodic sync of on-chain relays
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

  // Initial sync
  doSync();

  // Start periodic sync
  intervalId = setInterval(doSync, intervalMs);

  // Return stop function
  return () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}
