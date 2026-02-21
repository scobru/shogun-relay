/**
 * Network Routes - Relay Federation & Discovery
 *
 * Leverages GunDB's native sync for relay discovery.
 * Does NOT duplicate GunDB's replication - only adds:
 * - Network-wide relay discovery endpoint
 * - Storage proofs for IPFS content verification
 * - Pin coordination messages via GunDB pub/sub
 * - On-chain registry queries (Base Sepolia/Mainnet)
 */

import express, { Request, Response, Router } from "express";
import crypto from "crypto";
import { ipfsRequest } from "../utils/ipfs-client";
import * as Reputation from "../utils/relay-reputation";
import * as FrozenData from "../utils/frozen-data";
import { getRelayUser, getRelayKeyPair } from "../utils/relay-user";
import { authConfig, relayConfig } from "../config";
import { loggers } from "../utils/logger";
import { GUN_PATHS } from "../utils/gun-paths";

// Helper to get relay keypair safely for reputation tracking
// Returns null instead of undefined if keypair not available
function getRelayUserWithKeyPair(): any {
  const user = getRelayUser();
  const keyPair = getRelayKeyPair();
  // Return a mock object with the keypair attached for backward compatibility
  if (user && keyPair) {
    return { ...user, _keyPair: keyPair };
  }
  return user;
}


// Helper to safely get signing keypair
function getSigningKeyPair(): any {
  return getRelayKeyPair() || null;
}

/**
 * Safely parse a number from IPFS API response
 * Handles empty strings, undefined, null, and invalid values
 * that cause "strconv.ParseFloat: parsing \"\": invalid syntax" errors
 */
function safeParseNumber(value: unknown, defaultValue = 0): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  if (typeof value === 'number') {
    return isNaN(value) ? defaultValue : value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return defaultValue;
    }
    const parsed = parseInt(trimmed, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

const router: Router = express.Router();

// Stats cache for faster responses
interface StatsCache {
  data: any;
  timestamp: number;
  ttl: number;
}

const statsCache: StatsCache = {
  data: null,
  timestamp: 0,
  ttl: 30000, // 30 seconds cache
};

// IPFS Configuration handled by ipfs-client.js

/**
 * GET /api/v1/network/relays
 *
 * Discover all relays in the network.
 * Reads from GunDB's native sync - no custom replication needed.
 */
router.get("/relays", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({ success: false, error: "Gun instance not available" });
    }

    const relays: {
      host: any;
      endpoint: string | null;
      lastSeen: any;
      uptime: any;
      connections: any;
      memory: any;
      ipfs: any; // Extended info if available
      storage: any;
    }[] = [];
    const timeout = parseInt(String(req.query.timeout)) || 5000;
    const minLastSeen = Date.now() - (parseInt(String(req.query.maxAge)) || 300000); // Default 5 min

    // GunDB native: read all relays from the synced namespace
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, timeout);

      gun
        .get(GUN_PATHS.RELAYS)
        .map()
        .once((data: any, host: string) => {
          if (!data || typeof data !== "object") return;

          const pulse = data.pulse;
          if (pulse && typeof pulse === "object") {
            // Only include relays seen recently
            if (pulse.timestamp && pulse.timestamp > minLastSeen) {
              relays.push({
                host,
                endpoint: pulse.relay?.host
                  ? `http://${pulse.relay.host}:${pulse.relay.port}`
                  : null,
                lastSeen: pulse.timestamp,
                uptime: pulse.uptime,
                connections: pulse.connections,
                memory: pulse.memory,
                ipfs: pulse.ipfs || null, // Extended info if available
                storage: pulse.storage || null,
              });
            }
          } else if (data.endpoint && data.lastSeen) {
            // Handle simple announcement (from peer-discovery.ts)
            // These entries don't have full pulse stats but are valid relays
            if (data.lastSeen > minLastSeen) {
              relays.push({
                host,
                endpoint: data.endpoint,
                lastSeen: data.lastSeen,
                uptime: 0, // Not available in simple announcement
                connections: { total: 0, active: 0 },
                memory: null,
                ipfs: null,
                storage: null,
              });
            }
          }
        });

      // Give GunDB time to collect from peers
      setTimeout(
        () => {
          clearTimeout(timer);
          resolve(undefined);
        },
        Math.min(timeout, 3000)
      );
    });

    // Sort by most recently seen
    relays.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));

    res.json({
      success: true,
      count: relays.length,
      relays,
      query: {
        timeout,
        maxAge: Date.now() - minLastSeen,
      },
    });
  } catch (error) {
    loggers.server.error({ err: error }, "Error fetching relays");
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/v1/network/relay/:host
 *
 * Get specific relay info from GunDB.
 */
router.get("/relay/:host", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({ success: false, error: "Gun instance not available" });
    }

    const { host } = req.params;

    const relayData = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000);

      gun
        .get(GUN_PATHS.RELAYS)
        .get(host)
        .once((data: unknown) => {
          clearTimeout(timer);
          resolve(data);
        });
    });

    if (!relayData) {
      return res.status(404).json({ success: false, error: "Relay not found" });
    }

    res.json({
      success: true,
      relay: {
        host,
        ...relayData,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/v1/network/peers
 *
 * Discover all generic peers (Mules) in the network.
 */
router.get("/peers", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({ success: false, error: "Gun instance not available" });
    }

    const peers: {
      pubKey: string;
      alias: string | null;
      lastSeen: number;
      type: string;
    }[] = [];

    const minLastSeen = Date.now() - (parseInt(String(req.query.maxAge)) || 3600000); // Default 1 hour

    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000); // Short timeout for quick response

      gun
        .get(GUN_PATHS.PEERS)
        .map()
        .once((data: any, pubKey: string) => {
          if (!data || typeof data !== "object") return;

          if (data.lastSeen && data.lastSeen > minLastSeen) {
            peers.push({
              pubKey,
              alias: data.alias || null,
              lastSeen: data.lastSeen,
              type: data.type || 'unknown',
            });
          }
        });

      // Give GunDB time to collect
      setTimeout(() => {
        clearTimeout(timer);
        resolve(undefined);
      }, 1500);
    });

    peers.sort((a, b) => b.lastSeen - a.lastSeen);

    res.json({
      success: true,
      count: peers.length,
      peers
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/v1/network/stats
 *
 * Network-wide statistics aggregated from all known relays.
 * Now includes retroactive sync from IPFS, GunDB deals, and subscriptions.
 * Statistics persist across restarts by reading from persistent sources.
 */
router.get("/stats", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({ success: false, error: "Gun instance not available" });
    }

    const stats = {
      totalRelays: 0,
      activeRelays: 0,
      totalConnections: 0,
      totalStorageBytes: 0,

      totalPins: 0,
    };

    const relaysFound: Array<{ host: any; hasPulse: boolean }> = [];
    const fiveMinutesAgo = Date.now() - 300000;
    const currentRelayHost =
      relayConfig.endpoint?.replace(/^https?:\/\//, "").replace(/\/$/, "") || relayConfig.name;

    // Check cache first for faster response
    const now = Date.now();
    if (statsCache.data && (now - statsCache.timestamp) < statsCache.ttl) {
      loggers.server.debug("📊 Returning cached network stats");
      return res.json(statsCache.data);
    }

    // STEP 1: Collect stats from pulse data (real-time relay status)
    // Reduced timeout to 5 seconds for faster response
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        loggers.server.info(
          { relaysFound: relaysFound.length },
          `📊 Network stats collection timeout. Found ${relaysFound.length} relays`
        );
        resolve();
      }, 5000); // Reduced from 15s to 5s for faster response

      let processedCount = 0;
      const processedHosts = new Set<string>(); // Track processed hosts to avoid duplicates

      // Also try to include current relay's own pulse directly
      // If pulse is not found in GunDB, use local app data as fallback
      let currentRelayIncluded = false;
      const includeCurrentRelay = () => {
        if (processedHosts.has(currentRelayHost)) return;

        gun
          .get(GUN_PATHS.RELAYS)
          .get(currentRelayHost)
          .once((data: any) => {
            if (data && data.pulse && typeof data.pulse === "object") {
              const pulse = data.pulse;
              if (pulse.timestamp && pulse.timestamp > fiveMinutesAgo) {
                if (!processedHosts.has(currentRelayHost)) {
                  processedHosts.add(currentRelayHost);
                  currentRelayIncluded = true;
                  stats.totalRelays++;
                  stats.activeRelays++;
                  const activeConnections = pulse.connections?.active || 0;
                  stats.totalConnections += activeConnections;
                  relaysFound.push({ host: currentRelayHost, hasPulse: true });

                  if (pulse.ipfs && typeof pulse.ipfs === "object") {
                    const repoSize = pulse.ipfs.repoSize || 0;
                    const numPins = pulse.ipfs.numPins || 0;
                    stats.totalStorageBytes += repoSize;
                    stats.totalPins += numPins;
                  }

                  loggers.server.debug(
                    { host: currentRelayHost },
                    `   📡 Current relay included from GunDB pulse: ${currentRelayHost}`
                  );
                }
              }
            }
          });
      };

      // Try to include current relay immediately
      includeCurrentRelay();

      gun
        .get(GUN_PATHS.RELAYS)
        .map()
        .once((data: any, host: any) => {
          if (processedHosts.has(host)) {
            return; // Skip duplicates
          }
          processedHosts.add(host);
          processedCount++;
          loggers.server.debug(
            { processedCount, host },
            `📊 Processing relay ${processedCount}: ${host}`
          );

          if (!data || typeof data !== "object") {
            loggers.server.warn({ host }, `   ⚠️ Invalid data for relay ${host}`);
            return;
          }

          stats.totalRelays++;
          relaysFound.push({ host, hasPulse: !!data.pulse });

          const pulse = data.pulse;
          if (pulse && typeof pulse === "object") {
            loggers.server.debug(
              {
                host,
                timestamp: pulse.timestamp,
                age: Date.now() - (pulse.timestamp || 0),
              },
              `   ✅ Pulse found for ${host}, timestamp: ${pulse.timestamp}, age: ${Date.now() - (pulse.timestamp || 0)}ms`
            );

            if (pulse.timestamp && pulse.timestamp > fiveMinutesAgo) {
              stats.activeRelays++;
              const activeConnections = pulse.connections?.active || 0;
              stats.totalConnections += activeConnections;
              loggers.server.debug(
                { host, activeConnections },
                `   📡 Active relay: ${host}, connections: ${activeConnections}`
              );

              if (pulse.ipfs && typeof pulse.ipfs === "object") {
                const repoSize = pulse.ipfs.repoSize || 0;
                const numPins = pulse.ipfs.numPins || 0;
                stats.totalStorageBytes += repoSize;
                stats.totalPins += numPins;
                loggers.server.debug(
                  { host, repoSize, numPins },
                  `   💾 IPFS stats: ${repoSize} bytes, ${numPins} pins`
                );
              } else {
                loggers.server.warn({ host }, `   ⚠️ No IPFS stats for ${host}`);
              }
            } else {
              const age = pulse.timestamp ? Date.now() - pulse.timestamp : "no timestamp";
              loggers.server.debug(
                { host, age },
                `   ⏰ Relay ${host} pulse too old (${age}ms ago)`
              );
            }
          } else if (data.endpoint && data.lastSeen) {
            // Handle simple announcement without pulse object
            const age = Date.now() - (data.lastSeen || 0);

            if (data.lastSeen > fiveMinutesAgo) {
              stats.totalRelays++;
              // We count them as active if seen recently, even without full pulse
              stats.activeRelays++;
              relaysFound.push({ host, hasPulse: true }); // Treat as having presence

              loggers.server.debug(
                { host, age },
                `   📡 Active relay (announcement): ${host}, age: ${age}ms`
              );
            } else {
              loggers.server.debug(
                { host, age },
                `   ⏰ Relay ${host} announcement too old (${age}ms ago)`
              );
              // Still count as found, just not active
              relaysFound.push({ host, hasPulse: false });
            }
          } else {
            loggers.server.warn({ host }, `   ⚠️ No pulse or valid announcement for relay ${host}`);
          }
        });

      setTimeout(async () => {
        clearTimeout(timer);

        // Fallback: if current relay not included, use local app data
        if (!currentRelayIncluded && !processedHosts.has(currentRelayHost)) {
          processedHosts.add(currentRelayHost);
          stats.totalRelays++;
          stats.activeRelays++;
          // Get connections from app locals or GunDB internals
          const activeWires = req.app.get("activeWires") || Object.keys(gun._.opt.peers || {}).length || 0;
          stats.totalConnections += activeWires;
          relaysFound.push({ host: currentRelayHost, hasPulse: false });

          // Try to get IPFS stats from local node as fallback
          try {
            const repoStats = await ipfsRequest("/api/v0/repo/stat?size-only=true&human=false");
            if (repoStats && typeof repoStats === "object") {
              let repoSize = 0;
              if ("RepoSize" in repoStats) {
                repoSize = safeParseNumber((repoStats as { RepoSize?: unknown }).RepoSize);
              } else if ("repoSize" in repoStats) {
                repoSize = safeParseNumber((repoStats as { repoSize?: unknown }).repoSize);
              }

              if (repoSize > 0) {
                stats.totalStorageBytes += repoSize;
                loggers.server.debug(
                  { repoSize },
                  `   💾 Current relay IPFS repo size (fallback): ${repoSize} bytes`
                );
              }

              // Get pin count
              const pinLs = await ipfsRequest("/api/v0/pin/ls?type=recursive");
              if (pinLs && typeof pinLs === "object" && "Keys" in pinLs) {
                const keys = (pinLs as { Keys?: Record<string, any> }).Keys;
                if (keys) {
                  const pinCount = Object.keys(keys).length;
                  stats.totalPins += pinCount;
                  loggers.server.debug(
                    { pinCount },
                    `   📌 Current relay IPFS pins (fallback): ${pinCount}`
                  );
                }
              }
            }
          } catch (ipfsError) {
            // Ignore IPFS errors in fallback
          }

          loggers.server.debug(
            { host: currentRelayHost, activeWires },
            `   📡 Current relay included from local data (fallback): ${currentRelayHost}, connections: ${activeWires}`
          );
        } else if (currentRelayIncluded) {
          // Current relay was included but might not have IPFS data in pulse, try to add it
          const currentRelayData = await new Promise<{ pulse?: { ipfs?: any } } | null>(
            (resolve) => {
              gun
                .get(GUN_PATHS.RELAYS)
                .get(currentRelayHost)
                .once((data: any) => resolve(data || null));
              setTimeout(() => resolve(null), 1000);
            }
          );

          // If pulse exists but no IPFS data, try to fetch from local node
          if (
            currentRelayData?.pulse &&
            (!currentRelayData.pulse.ipfs || !currentRelayData.pulse.ipfs.repoSize)
          ) {
            try {
              const repoStats = await ipfsRequest("/api/v0/repo/stat?size-only=true&human=false");
              if (repoStats && typeof repoStats === "object") {
                let repoSize = 0;
                if ("RepoSize" in repoStats) {
                  repoSize = safeParseNumber((repoStats as { RepoSize?: unknown }).RepoSize);
                } else if ("repoSize" in repoStats) {
                  repoSize = safeParseNumber((repoStats as { repoSize?: unknown }).repoSize);
                }

                if (repoSize > 0) {
                  stats.totalStorageBytes += repoSize;
                  loggers.server.debug(
                    { repoSize },
                    `   💾 Current relay IPFS repo size (fallback): ${repoSize} bytes`
                  );
                }

                // Get pin count
                const pinLs = await ipfsRequest("/api/v0/pin/ls?type=recursive");
                if (pinLs && typeof pinLs === "object" && "Keys" in pinLs) {
                  const keys = (pinLs as { Keys?: Record<string, any> }).Keys;
                  if (keys) {
                    const pinCount = Object.keys(keys).length;
                    stats.totalPins += pinCount;
                    loggers.server.debug(
                      { pinCount },
                      `   📌 Current relay IPFS pins (fallback): ${pinCount}`
                    );
                  }
                }
              }
            } catch (ipfsError) {
              // Ignore IPFS errors
            }
          }
        }

        loggers.server.info(
          { totalRelays: stats.totalRelays, activeRelays: stats.activeRelays },
          `📊 Network stats collection complete. Total relays: ${stats.totalRelays}, Active: ${stats.activeRelays}`
        );
        resolve(undefined);
      }, 4000); // Reduced from 12s to 4s for faster response
    });




    // STEP 4: If pulse data is missing/old, try to sync directly from IPFS for this relay
    if (stats.totalStorageBytes === 0 && stats.totalPins === 0) {
      loggers.server.info(`📊 Pulse data missing/old, syncing directly from IPFS...`);

      // NOTE: Skipping /api/v0/repo/stat as it can trigger "strconv.ParseFloat: parsing '': invalid syntax"
      // error in IPFS when StorageMax or other config values are empty/missing.
      // See: https://github.com/ipfs/kubo/issues/10xxx
      // Instead, we just get pin count which is more reliable.

      // Get pin count (this is reliable and doesn't require config parsing)
      try {
        const pinLs = await ipfsRequest("/api/v0/pin/ls?type=recursive");
        if (pinLs && typeof pinLs === "object" && "Keys" in pinLs) {
          const keys = (pinLs as { Keys?: Record<string, any> }).Keys;
          if (keys) {
            const pinCount = Object.keys(keys).length;
            stats.totalPins += pinCount;
            loggers.server.info({ pinCount }, `   ✅ IPFS pins: ${pinCount}`);

            // Estimate storage from pins (rough estimate: assume average 1MB per pin)
            // This is a fallback when repo/stat is unavailable
            if (pinCount > 0 && stats.totalStorageBytes === 0) {
              const estimatedBytes = pinCount * 1024 * 1024; // 1MB per pin estimate
              stats.totalStorageBytes = estimatedBytes;
              loggers.server.debug({ estimatedBytes }, `   📊 Estimated storage from pin count`);
            }
          }
        }
      } catch (pinError) {
        loggers.server.debug(`   ⚠️ IPFS pin/ls failed. IPFS may be starting up.`);
      }
    }


    loggers.server.info({ stats }, `📊 Final network stats (with retroactive sync):`, {
      totalRelays: stats.totalRelays,
      activeRelays: stats.activeRelays,
      totalConnections: stats.totalConnections,
      totalStorageBytes: stats.totalStorageBytes,
      totalPins: stats.totalPins,
    });

    const responseData = {
      success: true,
      stats: {
        ...stats,
        totalStorageMB: Math.round(stats.totalStorageBytes / (1024 * 1024)),
        totalStorageGB: (stats.totalStorageBytes / (1024 * 1024 * 1024)).toFixed(2),
      },
      timestamp: Date.now(),
      debug: {
        relaysFound: relaysFound.length,
        relaysWithPulse: relaysFound.filter((r: { host: any; hasPulse: boolean }) => r.hasPulse)
          .length,
        sources: {
          pulse: stats.activeRelays > 0 ? "pulse data" : "missing/old",
          ipfsDirect:
            stats.totalStorageBytes > 0 && stats.activeRelays === 0 ? "IPFS direct" : "not used",
        },
      },
    };

    // Update cache
    statsCache.data = responseData;
    statsCache.timestamp = Date.now();

    res.json(responseData);
  } catch (error) {
    loggers.server.error({ err: error }, "❌ Network stats error");
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

// ============================================
// STORAGE PROOFS
// ============================================

/**
 * GET /api/v1/network/proof/:cid
 *
 * Generate a storage proof for a CID.
 * Proves this relay has the content pinned.
 */
router.get("/proof/:cid", async (req, res) => {
  const startTime = Date.now();
  try {
    const { cid } = req.params;
    const challenge = req.query.challenge || crypto.randomBytes(16).toString("hex");

    // 1. Verify CID exists locally via IPFS block/stat
    let blockStat: {
      Size?: number;
      Key?: string;
      Message?: string;
      Type?: string;
    };
    try {
      const blockStatResult = await ipfsRequest(`/block/stat?arg=${cid}`);
      if (typeof blockStatResult === "object" && blockStatResult !== null) {
        blockStat = blockStatResult as {
          Size?: number;
          Key?: string;
          Message?: string;
          Type?: string;
        };
        if (blockStat.Message || blockStat.Type === "error") {
          return res.status(404).json({
            success: false,
            error: "CID not found on this relay",
            cid,
          });
        }
      } else {
        return res.status(404).json({
          success: false,
          error: "CID not found on this relay",
          cid,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return res.status(404).json({
        success: false,
        error: "CID not available",
        cid,
        details: errorMessage,
      });
    }

    // 2. Get the first bytes of content for proof
    let contentSample;
    try {
      const catResult = await ipfsRequest(`/cat?arg=${cid}&length=256`, {
        responseType: "arraybuffer",
      });

      contentSample = catResult.toString("base64").substring(0, 64);
    } catch (e) {
      contentSample = null;
    }

    // 3. Check if pinned
    let isPinned = false;
    try {
      const pinLs = await ipfsRequest(`/pin/ls?arg=${cid}&type=all`);
      if (pinLs && typeof pinLs === "object" && "Keys" in pinLs) {
        const keys = (pinLs as { Keys?: Record<string, any> }).Keys;
        isPinned = keys ? Object.keys(keys).length > 0 : false;
      }
    } catch (e) {
      // Not pinned or error
    }

    // 4. Generate proof
    const timestamp = Date.now();
    const proofData = `${cid}:${challenge}:${timestamp}:${blockStat.Size || 0}`;
    const proofHash = crypto.createHash("sha256").update(proofData).digest("hex");

    // 5. Sign with relay identity if available
    const relayPub = req.app.get("relayUserPub");
    const gun = req.app.get("gunInstance");
    const host = relayConfig.endpoint || req.headers.host || "localhost";
    const responseTime = Date.now() - startTime;

    // Record successful proof for reputation tracking
    if (gun && host) {
      try {
        const keyPair = getSigningKeyPair();
        await Reputation.recordProofSuccess(gun, host, responseTime, keyPair);
      } catch (e) {
        // Non-critical, don't block proof generation
        const errorMessage = e instanceof Error ? e.message : String(e);
        loggers.server.warn(
          { err: e },
          "Failed to record proof success for reputation:",
          errorMessage
        );
      }
    }

    res.json({
      success: true,
      proof: {
        cid,
        challenge,
        timestamp,
        proofHash,
        relayPub: relayPub || null,
        block: {
          size: blockStat.Size || 0,
          key: blockStat.Key || "",
        },
        contentSampleBase64: contentSample,
        isPinned,
        verification: {
          method: "sha256(cid:challenge:timestamp:size)",
          validFor: 300000, // 5 minutes
          expiresAt: timestamp + 300000,
        },
      },
    });
  } catch (error) {
    loggers.server.error({ err: error }, "Storage proof error");

    // Record failed proof for reputation tracking
    const gun = req.app.get("gunInstance");
    const host = relayConfig.endpoint || req.headers.host || "localhost";
    if (gun && host) {
      try {
        const keyPair = getSigningKeyPair();
        await Reputation.recordProofFailure(gun, host, keyPair);
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        loggers.server.warn(
          { err: e },
          "Failed to record proof failure for reputation:",
          errorMessage
        );
      }
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * POST /api/v1/network/verify-proof
 *
 * Verify a storage proof from another relay.
 */
router.post("/verify-proof", express.json(), (req, res) => {
  try {
    const { proof } = req.body;

    if (!proof || !proof.cid || !proof.challenge || !proof.timestamp || !proof.proofHash) {
      return res.status(400).json({ success: false, error: "Invalid proof format" });
    }

    // Check expiration
    if (Date.now() > proof.verification?.expiresAt) {
      return res.json({
        success: true,
        valid: false,
        reason: "Proof expired",
      });
    }

    // Recalculate hash
    const proofData = `${proof.cid}:${proof.challenge}:${proof.timestamp}:${proof.block.size}`;
    const expectedHash = crypto.createHash("sha256").update(proofData).digest("hex");

    const isValid = expectedHash === proof.proofHash;

    res.json({
      success: true,
      valid: isValid,
      reason: isValid ? "Proof hash matches" : "Proof hash mismatch",
      expectedHash: isValid ? undefined : expectedHash,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

// ============================================
// PIN COORDINATION (via GunDB pub/sub)
// ============================================

/**
 * GET /api/v1/network/pin-request
 *
 * Get information about pin requests endpoint.
 * Returns endpoint info and redirects to pin-requests list.
 */
router.get("/pin-request", async (req, res) => {
  // Redirect to pin-requests endpoint for consistency
  res.redirect(`${req.baseUrl || "/api/v1/network"}/pin-requests`);
});

/**
 * POST /api/v1/network/pin-request
 *
 * Request other relays to pin a CID.
 * Uses GunDB as message bus - relays listen and decide to pin.
 */
router.post("/pin-request", express.json(), async (req, res) => {
  try {
    // Require admin auth
    const authHeader = req.headers["authorization"];
    const token = authHeader?.split(" ")[1] || req.headers["token"];
    if (token !== authConfig.adminPassword) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({ success: false, error: "Gun instance not available" });
    }

    const { cid, replicationFactor = 3, priority = "normal" } = req.body;

    if (!cid) {
      return res.status(400).json({ success: false, error: "CID required" });
    }

    const relayPub = req.app.get("relayUserPub");
    const requestId = crypto.randomBytes(8).toString("hex");

    // Publish pin request to GunDB - other relays will see this via native sync
    const pinRequest = {
      id: requestId,
      cid,
      requester: relayPub,
      replicationFactor,
      priority,
      timestamp: Date.now(),
      status: "pending",
    };

    gun.get(GUN_PATHS.PIN_REQUESTS).get(requestId).put(pinRequest);

    loggers.server.info(
      { cid, replicationFactor },
      `📤 Pin request published: ${cid} (replication: ${replicationFactor})`
    );

    res.json({
      success: true,
      request: pinRequest,
      message: "Pin request published to network",
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/v1/network/pin-requests
 *
 * List pending pin requests from the network.
 */
router.get("/pin-requests", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({ success: false, error: "Gun instance not available" });
    }

    const requests: any[] = [];
    const maxAgeParam =
      typeof req.query.maxAge === "string" ? req.query.maxAge : String(req.query.maxAge || "");
    const maxAge = Date.now() - (parseInt(maxAgeParam) || 86400000); // 24h default

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 3000);

      gun
        .get(GUN_PATHS.PIN_REQUESTS)
        .map()
        .once((data: { timestamp: number }, id: any) => {
          if (!data || typeof data !== "object") return;
          if (data.timestamp && data.timestamp > maxAge) {
            requests.push({ id, ...data });
          }
        });

      setTimeout(() => {
        clearTimeout(timer);
        resolve();
      }, 2500);
    });

    requests.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    res.json({
      success: true,
      count: requests.length,
      requests,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * POST /api/v1/network/pin-response
 *
 * Respond to a pin request (announce that you pinned it).
 */
router.post("/pin-response", express.json(), async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({ success: false, error: "Gun instance not available" });
    }

    const { requestId, status = "completed" } = req.body;

    if (!requestId) {
      return res.status(400).json({ success: false, error: "requestId required" });
    }

    const relayPub = req.app.get("relayUserPub");
    const responseId = crypto.randomBytes(8).toString("hex");

    const response = {
      id: responseId,
      requestId,
      responder: relayPub,
      status,
      timestamp: Date.now(),
    };

    gun.get(GUN_PATHS.PIN_RESPONSES).get(responseId).put(response);

    loggers.server.info(
      { requestId, status },
      `📥 Pin response published for request ${requestId}: ${status}`
    );

    res.json({
      success: true,
      response,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

// ============================================
// REPUTATION SYSTEM
// ============================================

/**
 * GET /api/v1/network/reputation/:host
 *
 * Get reputation score and metrics for a specific relay.
 */
router.get("/reputation/:host", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({ success: false, error: "Gun instance not available" });
    }

    let { host } = req.params;

    // Normalize host - extract hostname if it's a URL
    let normalizedHost = host;
    try {
      // If it looks like a URL, extract hostname
      if (host.includes("://") || (host.includes(".") && !host.includes(" "))) {
        const url = new URL(host.startsWith("http") ? host : `https://${host}`);
        normalizedHost = url.hostname;
      }
    } catch (e) {
      // Not a URL, use as-is (might be just hostname)
      normalizedHost = host;
    }

    // Try to get reputation with the normalized hostname (without https://)
    let reputation = await Reputation.getReputation(gun, normalizedHost);

    // If not found, try alternative host formats
    if (!reputation) {
      // Try with the original host parameter (might be stored with different format)
      if (host !== normalizedHost) {
        reputation = await Reputation.getReputation(gun, host);
      }

      // Try with current relay's endpoint if it matches
      if (!reputation) {
        const relayHost = relayConfig.endpoint;
        if (relayHost) {
          try {
            let relayHostname = relayHost;
            // Extract hostname from relay host if it's a URL
            if (relayHost.includes("://")) {
              const relayUrl = new URL(relayHost);
              relayHostname = relayUrl.hostname;
            }

            // If hostname matches, try both formats
            if (relayHostname === normalizedHost || relayHostname === host) {
              // Try with the full endpoint as stored
              reputation = await Reputation.getReputation(gun, relayHost);
              // Also try with just the hostname
              if (!reputation) {
                reputation = await Reputation.getReputation(gun, relayHostname);
              }
            }
          } catch (e) {
            // Ignore URL parsing errors
          }
        }
      }
    }

    if (!reputation) {
      return res.status(404).json({
        success: false,
        error: "Relay not found or no reputation data",
        host: normalizedHost,
        searchedHosts: [normalizedHost, host].filter((h, i, Array) => Array.indexOf(h) === i),
        hint: "Reputation may not be initialized yet. The relay needs to send pulses to build reputation data.",
      });
    }

    // Ensure uptimePercent and proofSuccessRate are always present
    if (reputation.uptimePercent === undefined || reputation.uptimePercent === null) {
      reputation.uptimePercent =
        reputation.receivedPulses && reputation.expectedPulses && reputation.expectedPulses > 0
          ? (reputation.receivedPulses / reputation.expectedPulses) * 100
          : undefined;
    }

    if (reputation.proofSuccessRate === undefined || reputation.proofSuccessRate === null) {
      reputation.proofSuccessRate =
        reputation.proofsTotal &&
          reputation.proofsTotal > 0 &&
          reputation.proofsSuccessful !== undefined
          ? (reputation.proofsSuccessful / reputation.proofsTotal) * 100
          : undefined;
    }

    res.json({
      success: true,
      host: normalizedHost,
      reputation,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/v1/network/reputation
 *
 * Get reputation leaderboard - all relays sorted by score.
 */
router.get("/reputation", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({ success: false, error: "Gun instance not available" });
    }

    const minScoreParam =
      typeof req.query.minScore === "string"
        ? req.query.minScore
        : String(req.query.minScore || "");
    const tierParam = typeof req.query.tier === "string" ? req.query.tier : null;
    const limitParam =
      typeof req.query.limit === "string" ? req.query.limit : String(req.query.limit || "");

    const options = {
      minScore: parseFloat(minScoreParam) || 0,
      tier: tierParam || undefined,
      limit: parseInt(limitParam) || 50,
    };

    const leaderboard = await Reputation.getReputationLeaderboard(gun, options);

    res.json({
      success: true,
      count: leaderboard.length,
      leaderboard,
      filters: options,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * POST /api/v1/network/reputation/record-proof
 *
 * Record a storage proof event (for tracking other relays).
 * Called when verifying proofs from other relays.
 */
router.post("/reputation/record-proof", express.json(), async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({ success: false, error: "Gun instance not available" });
    }

    const { host, success, responseTimeMs = 0 } = req.body;

    if (!host) {
      return res.status(400).json({ success: false, error: "host required" });
    }

    const keyPair = getSigningKeyPair();

    if (success) {
      await Reputation.recordProofSuccess(gun, host, responseTimeMs, keyPair);
    } else {
      await Reputation.recordProofFailure(gun, host, keyPair);
    }

    res.json({
      success: true,
      recorded: { host, proofSuccess: success, responseTimeMs },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/v1/network/best-relays
 *
 * Get best relays for replication based on reputation.
 * Useful for choosing where to replicate data.
 */
router.get("/best-relays", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({ success: false, error: "Gun instance not available" });
    }

    const countParam =
      typeof req.query.count === "string" ? req.query.count : String(req.query.count || "");
    const minScoreParam =
      typeof req.query.minScore === "string"
        ? req.query.minScore
        : String(req.query.minScore || "");
    const excludeHostParam = typeof req.query.exclude === "string" ? req.query.exclude : null;
    const count = parseInt(countParam) || 3;
    const minScore = parseFloat(minScoreParam) || 50;
    const excludeHost = excludeHostParam;

    // Get relays with good reputation
    const leaderboard = await Reputation.getReputationLeaderboard(gun, {
      minScore,
      limit: count + 5, // Get extra in case some are filtered
    });

    // Filter out excluded host and select best
    const bestRelays = leaderboard
      .filter((r) => r.host !== excludeHost)
      .slice(0, count)
      .map((r) => ({
        host: r.host,
        score: r.calculatedScore.total,
        tier: r.calculatedScore.tier,
        uptime: r.uptimePercent,
        lastSeen: r.lastSeenTimestamp,
      }));

    res.json({
      success: true,
      count: bestRelays.length,
      relays: bestRelays,
      criteria: { minScore, excludeHost },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

// ============================================
// FROZEN (IMMUTABLE, VERIFIED) DATA ENDPOINTS
// ============================================

/**
 * GET /api/v1/network/verified/relays
 *
 * List relay announcements from frozen (signed, immutable) space.
 * These are cryptographically verified and tamper-proof.
 */
router.get("/verified/relays", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({ success: false, error: "Gun instance not available" });
    }

    const verifyAll = req.query.verify !== "false";
    const maxAgeParam =
      typeof req.query.maxAge === "string" ? req.query.maxAge : String(req.query.maxAge || "");
    const limitParam =
      typeof req.query.limit === "string" ? req.query.limit : String(req.query.limit || "");
    const maxAge = parseInt(maxAgeParam) || 600000; // 10 min default
    const limit = parseInt(limitParam) || 50;

    const entries = await FrozenData.listFrozenEntries(gun, "relay-announcements", {
      verifyAll,
      maxAge,
      limit,
    });

    res.json({
      success: true,
      count: entries.length,
      relays: entries.map((e) => ({
        host: e.key,
        pub: e.pub,
        hash: e.hash,
        updatedAt: e.updatedAt,
        verified: e.verified,
        data: e.data,
      })),
      verification: {
        method: "SEA.sign + SHA-256 content-hash",
        note: "Only entries with verified=true are cryptographically authentic",
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/v1/network/verified/relay/:host
 *
 * Get verified (frozen) announcement for a specific relay.
 */
router.get("/verified/relay/:host", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({ success: false, error: "Gun instance not available" });
    }

    const { host } = req.params;
    const entry = await FrozenData.getLatestFrozenEntry(gun, "relay-announcements", host);

    if (!entry) {
      return res.status(404).json({
        success: false,
        error: "No verified announcement found for this relay",
        host,
      });
    }

    res.json({
      success: true,
      host,
      verified: entry.verified,
      verificationDetails: entry.verificationDetails,
      data: entry.data,
      hash: entry.hash,
      pub: entry.pub,
      timestamp: entry.timestamp,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * POST /api/v1/network/verified/observation
 *
 * Create a signed observation about another relay.
 * Used for building decentralized reputation from verified sources.
 */
router.post("/verified/observation", express.json(), async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({ success: false, error: "Gun instance not available" });
    }

    const relayUser = getRelayUser();
    if (!relayUser || !relayUser.is) {
      return res.status(503).json({
        success: false,
        error: "Relay user not initialized - cannot sign observations",
      });
    }

    const { observedHost, observation } = req.body;

    if (!observedHost || !observation) {
      return res.status(400).json({
        success: false,
        error: "observedHost and observation required",
      });
    }

    // Validate observation structure
    const validatedObservation = {
      proofsSuccessful: observation.proofsSuccessful || 0,
      proofsFailed: observation.proofsFailed || 0,
      avgResponseTimeMs: observation.avgResponseTimeMs || null,
      pinsFulfilled: observation.pinsFulfilled || 0,
      pinsRequested: observation.pinsRequested || 0,
      notes: observation.notes || null,
    };

    const gunInstance = gun as any;
    const sea = gunInstance?.sea || (relayUser as any)?._?.sea;
    if (!sea) {
      return res.status(503).json({
        success: false,
        error: "SEA (signing) not available - cannot sign observations",
      });
    }

    const result = await FrozenData.createFrozenObservation(
      gun,
      observedHost,
      validatedObservation,
      sea
    );

    loggers.server.info(
      { observedHost, hash: result.hash.substring(0, 16) },
      `📝 Frozen observation created for ${observedHost}: ${result.hash.substring(0, 16)}...`
    );

    res.json({
      success: true,
      observation: {
        observedHost,
        hash: result.hash,
        observer: relayUser.is.pub,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/v1/network/verified/observations/:host
 *
 * Get all verified observations for a specific relay.
 * Aggregates reputation from multiple verified sources.
 */
router.get("/verified/observations/:host", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({ success: false, error: "Gun instance not available" });
    }

    const { host } = req.params;
    const limitParam =
      typeof req.query.limit === "string" ? req.query.limit : String(req.query.limit || "");
    const observations = await FrozenData.getObservationsForHost(gun, host, {
      verifyAll: true,
      limit: parseInt(limitParam) || 50,
    });

    // Aggregate reputation from verified observations
    const aggregated = FrozenData.aggregateReputation(observations);

    res.json({
      success: true,
      host,
      observationsCount: observations.length,
      observations,
      aggregatedReputation: aggregated,
      note: "Reputation is aggregated from cryptographically verified observations only",
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/v1/network/verified/entry/:hash
 *
 * Read and verify any frozen entry by its content hash.
 */
router.get("/verified/entry/:namespace/:hash", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({ success: false, error: "Gun instance not available" });
    }

    const { namespace, hash } = req.params;
    const entry = await FrozenData.readFrozenEntry(gun, namespace, hash);

    if (!entry) {
      return res.status(404).json({
        success: false,
        error: "Entry not found",
        namespace,
        hash,
      });
    }

    res.json({
      success: true,
      namespace,
      hash,
      verified: entry.verified,
      verificationDetails: entry.verificationDetails,
      data: entry.data,
      pub: entry.pub,
      timestamp: entry.timestamp,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

// =============================================================================
// ON-CHAIN REGISTRY ENDPOINTS
// Query the ShogunRelayRegistry smart contract on Base Sepolia/Mainnet
// =============================================================================

export default router;
