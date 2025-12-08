/**
 * Deal Synchronization Service
 *
 * Syncs active on-chain deals with IPFS pins.
 * Ensures all active deals have their files pinned on this relay.
 */

// Interfaces
interface PinFailureInfo {
  lastAttempt: num;
  consecutiveFailures: num;
}

interface PinResult {
  success: bool;
  error?: str;
  pending?: bool;
  retryable?: bool;
  shutdownError?: bool;
  alreadyPinned?: bool;
  result?: obj;
}

interface SyncOptions {
  onlyActive?: bool;
  dryRun?: bool;
  gun?: mb<IGunInstanceRoot<any, any>>;
  relayKeyPair?: mb<SEAKeyPair>;
  fastSync?: bool;
}

interface SyncResults {
  synced: num;
  alreadyPinned: num;
  failed: num;
  gunDBSynced: num;
  gunDBFailed: num;
  errors: arr<SyncError>;
}

interface SyncError {
  dealId: str;
  cid?: str;
  error: str;
  pending?: bool;
}

interface OnChainDeal {
  dealId: str;
  cid: str;
  client: str;
  relay: str;
  active: bool;
  createdAt: str | num;
  expiresAt: str | num;
  sizeMB: num;
  priceUSDC: str;
  clientStake?: str;
}

interface GunDBDeal {
  id: str;
  version: num;
  cid: str;
  clientAddress: str;
  providerPub: str;
  tier: str;
  sizeMB: num;
  durationDays: num;
  pricing: DealPricing;
  createdAt: num;
  activatedAt: num;
  expiresAt: num;
  paymentRequired: num;
  paymentTx: mb<str>;
  paymentVerified: bool;
  erasureCoding: bool;
  erasureMetadata: mb<obj>;
  replicationFactor: num;
  replicas: obj;
  replicaCount: num;
  status: str;
  onChainDealId: str;
  onChainRelay: str;
  clientStake: str;
  syncedFromOnChain: bool;
  syncedAt: num;
}

interface DealPricing {
  tier: str;
  sizeMB: num;
  durationDays: num;
  months: num;
  pricePerMBMonth: num;
  basePrice: num;
  storageOverheadPercent: num;
  replicationFactor: num;
  totalPriceUSDC: num;
  features: {
    erasureCoding: bool;
    slaGuarantee: bool;
  };
}

interface DealSyncStatus {
  dealId: str;
  cid: str;
  active: bool;
  expiresAt: str | num;
  pinned: bool;
  needsSync: bool;
}

import type { IGunInstanceRoot } from "gun/types/gun";

interface SEAKeyPair {
  pub: str;
  priv: str;
  epub?: str;
  epriv?: str;
}

interface RequestOptions {
  hostname: str;
  port: num;
  path: str;
  method: str;
  headers: Record<str, str>;
}

const IPFS_API_URL = ipfsConfig.apiUrl || "http://127.0.0.1:5001";
const IPFS_API_TOKEN = ipfsConfig.apiToken;

import { createLogger } from "./logger";
import { ipfsConfig } from "../config";
const log = createLogger("deal-sync");

// Global flag to indicate shutdown is in progress
let isShuttingDown: bool = false;

// Track CIDs that recently failed pinning to avoid immediate retries
// Map of CID -> { lastAttempt: timestamp, consecutiveFailures: number }
const pinFailureCache = new Map<str, PinFailureInfo>();
const PIN_RETRY_DELAY_MS = 5 * 60 * 1000; // Wait 5 minutes before retrying a failed CID
const MAX_CONSECUTIVE_FAILURES = 10; // After 10 failures, only retry once per hour
const CACHE_CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // Cleanup every 30 minutes
const CACHE_MAX_AGE_MS = 4 * 60 * 60 * 1000; // Remove entries older than 4 hours

// Periodic cleanup of stale cache entries to prevent memory leaks
let cleanupIntervalId: mb<ReturnType<typeof setInterval>> = und;

function startCacheCleanup(): void {
  if (cleanupIntervalId) return;

  cleanupIntervalId = setInterval(() => {
    if (isShuttingDown) {
      clearInterval(cleanupIntervalId!);
      cleanupIntervalId = und;
      return;
    }

    const now = Date.now();
    let cleaned = 0;

    for (const [cid, info] of pinFailureCache.entries()) {
      if (now - info.lastAttempt > CACHE_MAX_AGE_MS) {
        pinFailureCache.delete(cid);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.info(`Cleaned ${cleaned} stale entries from pin failure cache`);
    }
  }, CACHE_CLEANUP_INTERVAL_MS);
}

// Start cleanup on module load
startCacheCleanup();

/**
 * Mark that shutdown is in progress (call this when SIGTERM/SIGINT received)
 */
export function markShutdownInProgress(): void {
  isShuttingDown = true;
}

/**
 * Check if shutdown is in progress
 */
export function isShutdownInProgress(): bool {
  return isShuttingDown;
}

/**
 * Check if a CID is pinned in IPFS
 * @param cid - IPFS CID to check
 * @returns Promise with boolean
 */
async function isPinned(cid: str): prm<bool> {
  try {
    const gatewayUrl = new URL(IPFS_API_URL);
    const protocolModule =
      gatewayUrl.protocol === "https:"
        ? await import("https")
        : await import("http");

    const requestOptions: RequestOptions = {
      hostname: gatewayUrl.hostname,
      port: gatewayUrl.port
        ? Number(gatewayUrl.port)
        : gatewayUrl.protocol === "https:"
        ? 443
        : 80,
      path: `/api/v0/pin/ls?arg=${encodeURIComponent(cid)}&type=all`,
      method: "GET",
      headers: {},
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    return new Promise((resolve) => {
      const req = protocolModule.request(requestOptions, (res) => {
        let data = "";
        res.on("data", (chunk: str) => (data += chunk));
        res.on("end", () => {
          try {
            const result = JSON.parse(data);
            // Check if CID is in the Keys object
            if (result && result.Keys && result.Keys[cid]) {
              resolve(true);
            } else {
              // Try listing all pins and checking if CID is in the list
              resolve(false);
            }
          } catch (e) {
            // If parsing fails, try listing all pins
            resolve(false);
          }
        });
      });

      req.on("error", () => resolve(false));
      req.setTimeout(5000, () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  } catch (error) {
    log.warn({ err: error }, `Error checking pin status for ${cid}`);
    return false;
  }
}

/**
 * Pin a CID to IPFS with retry logic
 * @param cid - IPFS CID to pin
 * @param maxRetries - Maximum number of retry attempts (default: 2)
 * @returns Promise with result
 */
async function pinCid(cid: str, maxRetries: num = 2): prm<PinResult> {
  // Check if shutdown is in progress - abort immediately if so
  if (isShuttingDown) {
    return {
      success: false,
      error: "Pin aborted due to shutdown",
      pending: true,
    };
  }

  const PIN_TIMEOUT =
    ipfsConfig.pinTimeoutMs || 120000; // Default: 120 seconds (2 minutes)

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check shutdown status before each attempt
    if (isShuttingDown) {
      return {
        success: false,
        error: "Pin aborted due to shutdown",
        pending: true,
      };
    }
    try {
      const gatewayUrl = new URL(IPFS_API_URL);
      const protocolModule =
        gatewayUrl.protocol === "https:"
          ? await import("https")
          : await import("http");

      const requestOptions: RequestOptions = {
        hostname: gatewayUrl.hostname,
        port: gatewayUrl.port
          ? Number(gatewayUrl.port)
          : gatewayUrl.protocol === "https:"
          ? 443
          : 80,
        path: `/api/v0/pin/add?arg=${encodeURIComponent(cid)}&progress=false`,
        method: "POST",
        headers: {
          "Content-Length": "0",
        },
      };

      if (IPFS_API_TOKEN) {
        requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const result = await new Promise<PinResult>((resolve) => {
        const req = protocolModule.request(requestOptions, (res) => {
          let data = "";
          res.on("data", (chunk: str) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode === 200) {
              try {
                const parsed = JSON.parse(data);
                log.info(
                  `CID ${cid} pinned successfully${
                    attempt > 0 ? ` (attempt ${attempt + 1})` : ""
                  }`
                );
                resolve({ success: true, result: parsed });
              } catch (e) {
                log.info(
                  `CID ${cid} pinned (response: ${data})${
                    attempt > 0 ? ` (attempt ${attempt + 1})` : ""
                  }`
                );
                resolve({ success: true });
              }
            } else {
              // Check if already pinned
              if (
                data.includes("already pinned") ||
                data.includes("is already pinned")
              ) {
                log.info(
                  `CID ${cid} was already pinned${
                    attempt > 0 ? ` (attempt ${attempt + 1})` : ""
                  }`
                );
                resolve({ success: true, alreadyPinned: true });
              } else {
                // Check if error is due to shutdown (promise channel closed during shutdown)
                // Also check if shutdown is in progress when we receive the response
                const isShutdownError =
                  isShuttingDown ||
                  data.includes("promise channel was closed") ||
                  data.includes("channel was closed");

                const error = `IPFS pin add failed with status ${
                  res.statusCode
                }: ${data.substring(0, 200)}`;
                resolve({
                  success: false,
                  error,
                  retryable: (res.statusCode || 0) >= 500 && !isShutdownError,
                  shutdownError: isShutdownError,
                });
              }
            }
          });
        });

        req.on("error", (err: Error) => {
          // Check if error is due to shutdown
          const isShutdownError =
            isShuttingDown &&
            (err.message.includes("ECONNRESET") ||
              err.message.includes("ECONNREFUSED") ||
              err.message.includes("socket hang up"));

          const error = `IPFS pin add error: ${err.message}`;
          resolve({
            success: false,
            error,
            retryable: !isShutdownError,
            shutdownError: isShutdownError,
          });
        });

        req.setTimeout(PIN_TIMEOUT, () => {
          req.destroy();
          // Timeout doesn't necessarily mean failure - pin might continue in background
          const error = `IPFS pin add timeout after ${
            PIN_TIMEOUT / 1000
          }s (CID may still be pinning in background)`;
          log.warn(`${error}${attempt > 0 ? ` (attempt ${attempt + 1})` : ""}`);
          resolve({
            success: false,
            error,
            pending: true,
            retryable: attempt < maxRetries,
          });
        });

        req.end();
      });

      // If successful, return immediately
      if (result.success) {
        return result;
      }

      // If pending (timeout but might still be processing), check if we should retry
      if (result.pending && attempt < maxRetries && !isShuttingDown) {
        const retryDelay = Math.min(5000 * Math.pow(2, attempt), 30000); // Exponential backoff: 5s, 10s, 20s, max 30s
        log.info(
          `CID ${cid} pin may still be processing. Retrying in ${
            retryDelay / 1000
          }s...`
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        // Check again after delay in case shutdown started during wait
        if (isShuttingDown) {
          return {
            success: false,
            error: "Pin aborted due to shutdown",
            pending: true,
            shutdownError: true,
          };
        }
        continue;
      }

      // If retryable error and we have retries left
      if (result.retryable && attempt < maxRetries && !isShuttingDown) {
        const retryDelay = Math.min(2000 * Math.pow(2, attempt), 10000); // Exponential backoff: 2s, 4s, 8s, max 10s
        log.info(
          `Retrying pin for CID ${cid} in ${retryDelay / 1000}s (attempt ${
            attempt + 2
          }/${maxRetries + 1})...`
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        // Check again after delay in case shutdown started during wait
        if (isShuttingDown) {
          return {
            success: false,
            error: "Pin aborted due to shutdown",
            pending: true,
            shutdownError: true,
          };
        }
        continue;
      }

      // Final failure
      if (!result.success) {
        // Only log as warning if not a shutdown error and shutdown is not in progress
        if (!result.shutdownError && !isShuttingDown) {
          log.warn({ err: result.error }, `CID ${cid} failed`);
        }
        // If shutdown is in progress, mark it as shutdown error even if not already marked
        if (isShuttingDown && !result.shutdownError) {
          result.shutdownError = true;
        }
        return result;
      }
    } catch (error) {
      // Check if shutdown happened during error handling
      if (isShuttingDown) {
        return {
          success: false,
          error: "Pin aborted due to shutdown",
          pending: true,
          shutdownError: true,
        };
      }

      if (attempt < maxRetries && !isShuttingDown) {
        const retryDelay = Math.min(2000 * Math.pow(2, attempt), 10000);
        log.warn(
          { err: error },
          `Error pinning CID ${cid} (attempt ${attempt + 1}). Retrying in ${
            retryDelay / 1000
          }s...`
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        // Check again after delay
        if (isShuttingDown) {
          return {
            success: false,
            error: "Pin aborted due to shutdown",
            pending: true,
            shutdownError: true,
          };
        }
        continue;
      }
      const errorMsg = `Error pinning CID ${cid}: ${(error as Error).message}`;
      if (!isShuttingDown) {
        log.error(errorMsg);
      }
      return { success: false, error: errorMsg, shutdownError: isShuttingDown };
    }
  }

  // Should never reach here, but just in case
  return { success: false, error: "Pin failed after all retries" };
}

/**
 * Convert on-chain deal to GunDB deal format
 * @param onChainDeal - Deal from on-chain registry
 * @param relayPub - GunDB pub key of this relay
 * @returns Deal in GunDB format
 */
async function convertOnChainDealToGunDB(
  onChainDeal: OnChainDeal,
  relayPub: str
): prm<GunDBDeal> {
  const { ethers } = await import("ethers");

  // Use on-chain dealId as the GunDB deal ID (convert bytes32 to hex string)
  const dealId = onChainDeal.dealId.startsWith("0x")
    ? onChainDeal.dealId
    : `0x${onChainDeal.dealId}`;

  // Calculate duration from createdAt and expiresAt
  const createdAt = new Date(onChainDeal.createdAt as unknown as str).getTime();
  const expiresAt = new Date(onChainDeal.expiresAt as unknown as str).getTime();
  const durationMs = expiresAt - createdAt;
  const durationDays = Math.ceil(durationMs / (1000 * 60 * 60 * 24));

  // Determine tier based on size (simple heuristic)
  let tier = "standard";
  if (onChainDeal.sizeMB >= 1000) {
    tier = "enterprise";
  } else if (onChainDeal.sizeMB >= 100) {
    tier = "premium";
  }

  // Create pricing object (simplified)
  const pricing: DealPricing = {
    tier,
    sizeMB: onChainDeal.sizeMB,
    durationDays,
    months: durationDays / 30,
    pricePerMBMonth:
      parseFloat(onChainDeal.priceUSDC) /
      (onChainDeal.sizeMB * (durationDays / 30)),
    basePrice: parseFloat(onChainDeal.priceUSDC),
    storageOverheadPercent: 0,
    replicationFactor: 1,
    totalPriceUSDC: parseFloat(onChainDeal.priceUSDC),
    features: {
      erasureCoding: false,
      slaGuarantee: false,
    },
  };

  return {
    id: dealId,
    version: 1,
    // Parties
    cid: onChainDeal.cid,
    clientAddress: onChainDeal.client.toLowerCase(),
    providerPub: relayPub,
    // Terms
    tier,
    sizeMB: onChainDeal.sizeMB,
    durationDays,
    pricing,
    // Dates
    createdAt,
    activatedAt: createdAt, // Assume activated when created on-chain
    expiresAt,
    // Payment
    paymentRequired: parseFloat(onChainDeal.priceUSDC),
    paymentTx: und, // On-chain deals don't have a single payment TX
    paymentVerified: true, // On-chain deals are verified by contract
    // Storage
    erasureCoding: false,
    erasureMetadata: und,
    replicationFactor: 1,
    replicas: {},
    replicaCount: 0,
    // Status
    status: onChainDeal.active ? "active" : "expired",
    // On-chain metadata
    onChainDealId: dealId,
    onChainRelay: onChainDeal.relay.toLowerCase(),
    clientStake: onChainDeal.clientStake || "0",
    syncedFromOnChain: true,
    syncedAt: Date.now(),
  };
}

/**
 * Sync active deals from on-chain registry with IPFS pins and GunDB
 * @param relayAddress - Address of this relay
 * @param chainId - Chain ID for the registry
 * @param options - Sync options
 * @returns Promise with sync results
 */
export async function syncDealsWithIPFS(
  relayAddress: str,
  chainId: num,
  options: SyncOptions = {}
): prm<SyncResults> {
  const {
    onlyActive = true,
    dryRun = false,
    gun = und,
    relayKeyPair = und,
    fastSync = false,
  } = options;

  if (fastSync) {
    // Fast sync: minimal logging, skip expensive operations
    // Only log if there are issues
  } else {
    log.info(
      { relayAddress, chainId, options: { onlyActive, dryRun, gunDB: !!gun } },
      `Starting deal sync`
    );
  }

  try {
    // Import registry client
    const { createStorageDealRegistryClient } = await import(
      "./registry-client"
    );
    const storageDealRegistryClient = createStorageDealRegistryClient(chainId);

    // Fetch all deals for this relay
    const deals: arr<OnChainDeal> =
      await storageDealRegistryClient.getRelayDeals(relayAddress);

    if (!fastSync) {
      log.info(
        `Found ${deals.length} deals on-chain for relay ${relayAddress}`
      );
    }

    // Filter active deals if requested
    const dealsToSync = onlyActive
      ? deals.filter(
          (deal) =>
            deal.active &&
            new Date(deal.expiresAt as unknown as str) > new Date()
        )
      : deals;

    if (!fastSync) {
      log.info(
        `Syncing ${dealsToSync.length} ${onlyActive ? "active" : ""} deals...`
      );
    }

    const results: SyncResults = {
      synced: 0,
      alreadyPinned: 0,
      failed: 0,
      gunDBSynced: 0,
      gunDBFailed: 0,
      errors: [],
    };

    // Get relay pub key if GunDB sync is enabled
    let relayPub: mb<str> = und;
    if (gun && relayKeyPair) {
      relayPub = relayKeyPair.pub;
    }

    // Process each deal
    for (const deal of dealsToSync) {
      // Check if shutdown started during processing
      if (isShuttingDown) {
        log.info(`Deal sync interrupted (shutdown in progress)`);
        break;
      }

      const { cid, dealId } = deal;

      if (!cid) {
        log.warn(`Deal ${dealId} has no CID, skipping`);
        continue;
      }

      try {
        // Check if already pinned
        const pinned = await isPinned(cid);

        if (pinned) {
          if (!fastSync) {
            log.info(`Deal ${dealId}: CID ${cid} already pinned`);
          }
          // Clear from failure cache if it was there
          pinFailureCache.delete(cid);
          results.alreadyPinned++;

          // In fast sync mode, still sync to GunDB even if already pinned
          // This ensures GunDB is up to date
          if (fastSync && gun && relayKeyPair && relayPub) {
            try {
              const { getDeal } = await import("./storage-deals");
              const { saveDeal } = await import("./storage-deals");
              const existingDeal = await getDeal(gun, dealId);
              if (!existingDeal || existingDeal.syncedFromOnChain !== true) {
                const gunDBDeal = await convertOnChainDealToGunDB(
                  deal,
                  relayPub
                );
                await saveDeal(gun, gunDBDeal as any, relayKeyPair);
                results.gunDBSynced++;
              }
            } catch (gunDBError) {
              // Silent in fast sync mode
            }
          }
          continue;
        }

        // Check if this CID recently failed pinning
        const failureInfo = pinFailureCache.get(cid);
        if (failureInfo) {
          const timeSinceLastAttempt = Date.now() - failureInfo.lastAttempt;
          const shouldRetry =
            failureInfo.consecutiveFailures < MAX_CONSECUTIVE_FAILURES
              ? timeSinceLastAttempt >= PIN_RETRY_DELAY_MS
              : timeSinceLastAttempt >= PIN_RETRY_DELAY_MS * 12; // 1 hour for high failure count

          if (!shouldRetry) {
            if (!fastSync) {
              const minutesSinceAttempt = Math.floor(
                timeSinceLastAttempt / 60000
              );
              log.info(
                `Deal ${dealId}: CID ${cid} failed ${failureInfo.consecutiveFailures} time(s) recently (${minutesSinceAttempt}m ago). Skipping retry for now.`
              );
            }
            continue;
          }
        }

        // Pin the CID if not in dry run mode
        if (dryRun) {
          if (!fastSync) {
            log.info(`[DRY RUN] Would pin CID ${cid} for deal ${dealId}`);
          }
          results.synced++;
        } else {
          // Try to pin the CID (IPFS will attempt to fetch it from the network)
          // Note: Even if the CID is not immediately available, IPFS will continue trying in background
          // The pin request itself will succeed once IPFS retrieves the content
          if (!fastSync) {
            log.info(`Attempting to pin CID ${cid} for deal ${dealId}...`);
          }
          const pinResult = await pinCid(cid);
          if (pinResult.success) {
            if (!fastSync) {
              log.info(`Deal ${dealId}: CID ${cid} pinned successfully`);
            }
            // Clear from failure cache on success
            pinFailureCache.delete(cid);
            results.synced++;
          } else {
            // Check if error is due to shutdown
            if (pinResult.shutdownError || isShuttingDown) {
              // Don't log as error during shutdown - just skip silently or with minimal info
              if (!isShuttingDown) {
                // Only log if shutdown wasn't in progress (might be a different shutdown-related error)
                log.info(`Deal ${dealId}: Pin aborted due to shutdown`);
              }
              continue;
            }

            // If pending, the pin might still be processing in background
            if (pinResult.pending) {
              log.warn(
                `Deal ${dealId}: CID ${cid} pin timed out but may still be processing in background. Will retry later.`
              );
              // Track failure for rate limiting, but don't count as hard failure
              const existingFailure = pinFailureCache.get(cid) || {
                consecutiveFailures: 0,
                lastAttempt: 0,
              };
              pinFailureCache.set(cid, {
                lastAttempt: Date.now(),
                consecutiveFailures: existingFailure.consecutiveFailures + 1,
              });
              // Don't count as failed - it might succeed later, but track it
              results.errors.push({
                dealId,
                cid,
                error: pinResult.error || "Unknown error",
                pending: true,
              });
            } else {
              // Only log and track as failed if not a shutdown error
              if (!pinResult.shutdownError && !isShuttingDown) {
                log.warn(
                  { err: pinResult.error },
                  `Deal ${dealId}: Failed to pin CID ${cid}`
                );
                // Track failure for rate limiting
                const existingFailure = pinFailureCache.get(cid) || {
                  consecutiveFailures: 0,
                  lastAttempt: 0,
                };
                pinFailureCache.set(cid, {
                  lastAttempt: Date.now(),
                  consecutiveFailures: existingFailure.consecutiveFailures + 1,
                });
                results.failed++;
                results.errors.push({
                  dealId,
                  cid,
                  error: pinResult.error || "Unknown error",
                });
              }
              // If shutdown error, silently skip (already handled above)
            }
          }
        }

        // Sync to GunDB if enabled (skip if shutdown in progress)
        if (gun && relayKeyPair && relayPub && !dryRun && !isShuttingDown) {
          try {
            const { getDeal } = await import("./storage-deals");
            const { saveDeal } = await import("./storage-deals");

            // Check if deal already exists in GunDB
            const existingDeal = await getDeal(gun, dealId);

            // Convert on-chain deal to GunDB format
            const gunDBDeal = await convertOnChainDealToGunDB(deal, relayPub);

            // Only save if it doesn't exist or if it's different
            if (!existingDeal || existingDeal.syncedFromOnChain !== true) {
              await saveDeal(gun, gunDBDeal as any, relayKeyPair);
              if (!fastSync) {
                log.info(`Deal ${dealId}: Synced to GunDB`);
              }
              results.gunDBSynced++;
            } else if (!fastSync) {
              log.info(`Deal ${dealId}: Already exists in GunDB`);
            }
          } catch (gunDBError) {
            // Ignore errors if shutdown is in progress (database may be closed)
            if (isShuttingDown) {
              if (!fastSync) {
                log.info(
                  `GunDB sync skipped for deal ${dealId} (shutdown in progress)`
                );
              }
              break;
            }
            if (!fastSync) {
              log.warn(
                { err: gunDBError },
                `Deal ${dealId}: Failed to sync to GunDB`
              );
            }
            results.gunDBFailed++;
            results.errors.push({
              dealId,
              cid: deal.cid,
              error: `GunDB sync failed: ${(gunDBError as Error).message}`,
            });
          }
        }

        // Small delay to avoid overwhelming IPFS/GunDB
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        log.error({ err: error }, `Error processing deal ${dealId}`);
        results.failed++;
        results.errors.push({
          dealId,
          cid: deal.cid,
          error: (error as Error).message,
        });
      }
    }

    if (!fastSync) {
      log.info(
        {
          ipfsPinned: results.synced,
          alreadyPinned: results.alreadyPinned,
          ipfsFailed: results.failed,
          gunDBSynced: gun && relayKeyPair ? results.gunDBSynced : undefined,
          gunDBFailed: gun && relayKeyPair ? results.gunDBFailed : undefined,
        },
        `Deal sync completed`
      );
    }

    return results;
  } catch (error) {
    log.error({ err: error }, `Deal sync error`);
    throw error;
  }
}

/**
 * Get sync status for all active deals
 * @param relayAddress - Address of this relay
 * @param chainId - Chain ID for the registry
 * @returns Array of deals with pin status
 */
export async function getDealSyncStatus(
  relayAddress: str,
  chainId: num
): prm<arr<DealSyncStatus>> {
  try {
    const { createStorageDealRegistryClient } = await import(
      "./registry-client"
    );
    const storageDealRegistryClient = createStorageDealRegistryClient(chainId);

    const deals: arr<OnChainDeal> =
      await storageDealRegistryClient.getRelayDeals(relayAddress);
    const activeDeals = deals.filter(
      (deal) =>
        deal.active && new Date(deal.expiresAt as unknown as str) > new Date()
    );

    const status: arr<DealSyncStatus> = [];
    for (const deal of activeDeals) {
      const pinned = deal.cid ? await isPinned(deal.cid) : false;
      status.push({
        dealId: deal.dealId,
        cid: deal.cid,
        active: deal.active,
        expiresAt: deal.expiresAt,
        pinned,
        needsSync: !pinned && !!deal.cid,
      });
    }

    return status;
  } catch (error) {
    log.error({ err: error }, `❌ Error getting deal sync status`);
    throw error;
  }
}
