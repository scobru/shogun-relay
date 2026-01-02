/**
 * Wormhole Cleanup Service
 *
 * Automatically cleans up orphaned wormhole file transfers from IPFS.
 * Transfers older than the configured maxAge that haven't been completed
 * will be unpinned from IPFS to free up storage.
 */

import type { IGunInstance } from "gun";
import { loggers } from "./logger";
import { wormholeConfig, ipfsConfig, authConfig } from "../config/env-config";
import { GUN_PATHS, getGunNode } from "./gun-paths";

const log = loggers.server || console;

let cleanupInterval: NodeJS.Timeout | null = null;
let isProcessing = false;

interface WormholeTransfer {
  createdAt?: number;
  ipfsHash?: string;
  completed?: boolean;
}

/**
 * Start the wormhole cleanup scheduler
 * @param gun - GunDB instance
 */
export function startWormholeCleanup(gun: IGunInstance): void {
  if (!wormholeConfig.cleanupEnabled) {
    log.debug({}, "🔄 Wormhole cleanup scheduler disabled by configuration");
    return;
  }

  if (cleanupInterval) {
    log.warn({}, "🔄 Wormhole cleanup scheduler already running");
    return;
  }

  log.info(
    {
      intervalMs: wormholeConfig.cleanupIntervalMs,
      maxAgeSecs: wormholeConfig.maxAgeSecs,
    },
    "🔄 Starting wormhole cleanup scheduler"
  );

  // Run after initial delay to let GunDB initialize
  setTimeout(() => {
    runWormholeCleanup(gun);
  }, 10000);

  // Set interval for periodic cleanup
  cleanupInterval = setInterval(() => {
    runWormholeCleanup(gun);
  }, wormholeConfig.cleanupIntervalMs);
}

/**
 * Stop the wormhole cleanup scheduler
 */
export function stopWormholeCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    log.debug({}, "🔄 Wormhole cleanup scheduler stopped");
  }
}

/**
 * Run a single cleanup iteration
 * @param gun - GunDB instance
 */
async function runWormholeCleanup(gun: IGunInstance): Promise<void> {
  if (isProcessing) {
    log.debug({}, "🔄 Wormhole cleanup already in progress, skipping");
    return;
  }

  isProcessing = true;

  try {
    const now = Date.now();
    const maxAgeMs = wormholeConfig.maxAgeSecs * 1000;
    const cutoffTime = now - maxAgeMs;

    log.debug(
      { cutoffTime: new Date(cutoffTime).toISOString() },
      "🔄 Scanning for orphaned wormhole transfers"
    );

    // Read all transfers from Gun
    const transfers = await getWormholeTransfers(gun);

    if (transfers.length === 0) {
      log.debug({}, "🔄 No wormhole transfers found");
      return;
    }

    let cleaned = 0;
    let errors = 0;

    for (const { code, data } of transfers) {
      try {
        // Skip if no createdAt timestamp
        if (!data.createdAt) {
          continue;
        }

        // Skip if not old enough
        if (data.createdAt > cutoffTime) {
          continue;
        }

        // Skip if already completed
        const completionStatus = await checkTransferCompleted(gun, code);
        if (completionStatus) {
          continue;
        }

        log.info(
          {
            code,
            ipfsHash: data.ipfsHash,
            createdAt: new Date(data.createdAt).toISOString(),
            ageHours: Math.round((now - data.createdAt) / (1000 * 60 * 60)),
          },
          "🧹 Cleaning up orphaned wormhole transfer"
        );

        // Unpin from IPFS
        if (data.ipfsHash) {
          await unpinFromIPFS(data.ipfsHash);
        }

        // Remove from Gun index
        getGunNode(gun, GUN_PATHS.SHOGUN_WORMHOLE)
          .get(GUN_PATHS.WORMHOLE_TRANSFERS)
          .get(code)
          .put(null as any);

        // Remove transfer metadata
        gun.get(code).put(null as any);

        cleaned++;
      } catch (err) {
        log.error({ err, code }, "❌ Failed to clean up wormhole transfer");
        errors++;
      }
    }

    if (cleaned > 0 || errors > 0) {
      log.info({ cleaned, errors }, "🔄 Wormhole cleanup completed");
    }
  } catch (err) {
    log.error({ err }, "❌ Unexpected error in wormhole cleanup");
  } finally {
    isProcessing = false;
  }
}

/**
 * Get all wormhole transfers from Gun
 */
async function getWormholeTransfers(
  gun: IGunInstance
): Promise<Array<{ code: string; data: WormholeTransfer }>> {
  return new Promise((resolve) => {
    const transfers: Array<{ code: string; data: WormholeTransfer }> = [];
    const seen = new Set<string>();
    let timeout: NodeJS.Timeout;

    const handler = (data: any, key: string) => {
      if (key === "_" || !data || seen.has(key)) return;
      seen.add(key);

      // For each code in the index, fetch the full transfer data
      gun.get(key).once((transferData: any) => {
        if (transferData && transferData.createdAt) {
          transfers.push({
            code: key,
            data: {
              createdAt: transferData.createdAt,
              ipfsHash: transferData.ipfsHash,
              completed: transferData.completed,
            },
          });
        }
      });
    };

    getGunNode(gun, GUN_PATHS.SHOGUN_WORMHOLE).get(GUN_PATHS.WORMHOLE_TRANSFERS).map().once(handler);

    // Wait a bit for all data to come in
    timeout = setTimeout(() => {
      resolve(transfers);
    }, 5000);
  });
}

/**
 * Check if a transfer has been completed
 */
async function checkTransferCompleted(gun: IGunInstance, code: string): Promise<boolean> {
  return new Promise((resolve) => {
    gun.get(`${code}-received`).once((data: any) => {
      resolve(data?.status === "completed");
    });

    // Timeout after 2 seconds
    setTimeout(() => resolve(false), 2000);
  });
}

/**
 * Unpin a CID from IPFS
 */
async function unpinFromIPFS(cid: string): Promise<void> {
  try {
    const response = await fetch(`${ipfsConfig.apiUrl}/api/v0/pin/rm?arg=${cid}`, {
      method: "POST",
      headers: {
        ...(ipfsConfig.apiToken ? { Authorization: `Bearer ${ipfsConfig.apiToken}` } : {}),
      },
    });

    if (!response.ok) {
      // 404 or similar means pin doesn't exist - that's fine
      if (response.status !== 500) {
        log.debug({ cid, status: response.status }, "⚠️ IPFS unpin returned non-OK status");
      }
    } else {
      log.debug({ cid }, "📌 Successfully unpinned from IPFS");
    }
  } catch (err) {
    log.warn({ err, cid }, "⚠️ Failed to unpin from IPFS (node may be unavailable)");
  }
}
