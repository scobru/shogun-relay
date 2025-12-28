/**
 * Bridge State Management - L2 State in GunDB
 *
 * Manages the L2 state for the bridge:
 * - User balances (credited from deposits) - Uses frozen-data for immutability
 * - Pending withdrawals (queued for batch submission)
 * - Batch history
 *
 * SECURITY: Uses frozen-data pattern for balances
 * - Immutable, signed entries with content-addressed hashing
 * - Automatic signature verification on read
 * - Only registered relays can write (enforced by bridge-listener verification)
 *
 * IMPORTANT: Balance linking between Ethereum address and GunDB pub key
 * - Deposits arrive with Ethereum address (0x...)
 * - Client derives GunDB pub key from wallet (deterministic)
 * - Balance is stored using Ethereum address as key (for deposits)
 * - When user operates (transfer/withdraw), they provide GunDB pub key
 * - Relay verifies GunDB pub key can be derived from Ethereum address
 *
 * State structure in GunDB:
 * - frozen-bridge-balances/{hash} -> { data: { balance, updatedAt, ethereumAddress, gunPubKey? }, sig, hash }
 * - bridge/balances-index/{ethereumAddress} -> { latestHash, pub, updatedAt, gunPubKey? }
 * - bridge/address-to-gun/{ethereumAddress} -> { gunPubKey, verified, timestamp } (mapping)
 * - bridge/withdrawals/pending -> array of { user, amount, nonce, timestamp }
 * - bridge/batches/{batchId} -> { root: string, withdrawals: [...], timestamp }
 * - bridge/processed-deposits/{key} -> { txHash, user, amount, blockNumber, timestamp }
 */

import type { IGunInstance, GunMessagePut } from "gun";
import Gun from "gun";
import "gun/sea";
import * as FrozenData from "./frozen-data";
import { loggers } from "./logger";
import { userLockManager } from "./security";
import { createRegistryClient } from "./registry-client";
import { getRelayKeyPair } from "./relay-user";

const SEA = (Gun as any).SEA;
const log = loggers.bridge || {
  info: console.log,
  error: console.error,
  warn: console.warn,
};

// Track last used nonce per user (in-memory cache, backed by GunDB)
// Uses GunDB for persistence across restarts
const lastNonceByUser = new Map<string, bigint>();

// Track used nonces for replay attack prevention (in-memory cache)
// Maps user -> Set of used nonces
const usedNonces = new Map<string, Set<string>>();

/**
 * Get the maximum nonce from usedNonces for a user (for calculating next nonce)
 */
export function getMaxUsedNonce(userAddress: string): bigint {
  const normalizedAddress = userAddress.toLowerCase();
  const userUsedNonces = usedNonces.get(normalizedAddress);
  if (!userUsedNonces || userUsedNonces.size === 0) {
    return 0n;
  }
  
  // Find the maximum nonce from the set
  let maxNonce = 0n;
  for (const nonceStr of userUsedNonces) {
    try {
      const nonce = BigInt(nonceStr);
      if (nonce > maxNonce) {
        maxNonce = nonce;
      }
    } catch {
      // Skip invalid nonce strings
    }
  }
  
  return maxNonce;
}

// Reference to GunDB instance for nonce persistence
let nonceGunInstance: IGunInstance | null = null;

/**
 * Initialize the nonce persistence system with a GunDB instance.
 * Should be called at relay startup.
 */
export function initNoncePersistence(gun: IGunInstance): void {
  nonceGunInstance = gun;
  log.debug("Nonce persistence initialized with GunDB instance");
}

/**
 * Load persisted nonces from GunDB for known users.
 * Called during relay startup to restore state.
 */
export async function loadPersistedNonces(gun: IGunInstance): Promise<number> {
  return new Promise((resolve) => {
    let loadedCount = 0;
    const timeout = setTimeout(() => {
      log.debug({ loadedCount }, "Nonce loading timed out, continuing with loaded nonces");
      resolve(loadedCount);
    }, 5000);

    gun
      .get("bridge")
      .get("nonces")
      .map()
      .once((data: any, key: string) => {
        if (key && key !== "_" && data && typeof data.lastNonce === "string") {
          try {
            const nonce = BigInt(data.lastNonce);
            const normalizedKey = key.toLowerCase();
            lastNonceByUser.set(normalizedKey, nonce);
            loadedCount++;
            log.debug({ user: normalizedKey, nonce: nonce.toString() }, "Loaded persisted nonce");
          } catch (err) {
            log.warn({ key, data, err }, "Failed to parse persisted nonce");
          }
        }
      });

    // Wait a bit for GunDB to stream data, then resolve
    setTimeout(() => {
      clearTimeout(timeout);
      log.debug({ loadedCount }, "Completed loading persisted nonces");
      resolve(loadedCount);
    }, 2000);
  });
}

/**
 * Persist nonce to GunDB (called after successful withdrawal)
 */
async function persistNonce(userAddress: string, nonce: bigint): Promise<void> {
  if (!nonceGunInstance) {
    log.warn({ user: userAddress }, "Cannot persist nonce: GunDB instance not initialized");
    return;
  }

  return new Promise((resolve, reject) => {
    const normalizedAddress = userAddress.toLowerCase();
    const nonceData = {
      lastNonce: nonce.toString(),
      updatedAt: Date.now(),
    };

    const timeoutId = setTimeout(() => {
      log.warn({ user: normalizedAddress, nonce: nonce.toString() }, "Nonce persist timed out");
      resolve(); // Don't fail the withdrawal if persistence times out
    }, 3000);

    nonceGunInstance!
      .get("bridge")
      .get("nonces")
      .get(normalizedAddress)
      .put(nonceData, (ack: GunMessagePut) => {
        clearTimeout(timeoutId);
        if (ack && "err" in ack && ack.err) {
          log.error({ user: normalizedAddress, err: ack.err }, "Failed to persist nonce");
          resolve(); // Don't fail the withdrawal if persistence fails
        } else {
          log.debug(
            { user: normalizedAddress, nonce: nonce.toString() },
            "Nonce persisted to GunDB"
          );
          resolve();
        }
      });
  });
}

/**
 * Get the last used nonce for a user (from cache or GunDB)
 */
export function getLastNonce(userAddress: string): bigint {
  return lastNonceByUser.get(userAddress.toLowerCase()) || 0n;
}

/**
 * Get the last used nonce for a user, checking GunDB if not in cache
 * Always checks GunDB to ensure we have the latest value (cache may be stale)
 */
export async function getLastNonceAsync(gun: IGunInstance, userAddress: string): Promise<bigint> {
  const normalizedAddress = userAddress.toLowerCase();

  // Always read from GunDB to ensure we have the latest value
  // The cache might be stale after a relay restart or if persistence hasn't completed
  return new Promise((resolve) => {
    const cachedBeforeRead = lastNonceByUser.get(normalizedAddress);
    
    const timeout = setTimeout(() => {
      // Fallback to cache if GunDB read times out
      const cached = lastNonceByUser.get(normalizedAddress);
      log.debug(
        {
          user: normalizedAddress,
          cachedBeforeRead: cachedBeforeRead?.toString(),
          cachedAfterTimeout: cached?.toString(),
          source: "timeout",
        },
        "getLastNonceAsync: GunDB read timed out, using cache"
      );
      resolve(cached !== undefined ? cached : 0n);
    }, 2000);

    gun
      .get("bridge")
      .get("nonces")
      .get(normalizedAddress)
      .once((data: any) => {
        clearTimeout(timeout);
        if (data && typeof data.lastNonce === "string") {
          try {
            const nonce = BigInt(data.lastNonce);
            lastNonceByUser.set(normalizedAddress, nonce); // Update cache
            log.debug(
              {
                user: normalizedAddress,
                nonceFromGunDB: nonce.toString(),
                cachedBeforeRead: cachedBeforeRead?.toString(),
                source: "gunDB",
              },
              "getLastNonceAsync: Read nonce from GunDB"
            );
            resolve(nonce);
          } catch (err) {
            // Fallback to cache on parse error
            const cached = lastNonceByUser.get(normalizedAddress);
            log.warn(
              {
                user: normalizedAddress,
                data,
                err,
                cached: cached?.toString(),
                source: "parse-error",
              },
              "getLastNonceAsync: Failed to parse nonce from GunDB"
            );
            resolve(cached !== undefined ? cached : 0n);
          }
        } else {
          // No data in GunDB, return cached value or 0n
          const cached = lastNonceByUser.get(normalizedAddress);
          log.debug(
            {
              user: normalizedAddress,
              hasData: !!data,
              cachedBeforeRead: cachedBeforeRead?.toString(),
              cached: cached?.toString(),
              source: "no-data",
            },
            "getLastNonceAsync: No nonce data in GunDB"
          );
          resolve(cached !== undefined ? cached : 0n);
        }
      });
  });
}

/**
 * Set the last used nonce for a user (updates cache and persists to GunDB)
 */
export function setLastNonce(userAddress: string, nonce: bigint): void {
  const normalizedAddress = userAddress.toLowerCase();
  lastNonceByUser.set(normalizedAddress, nonce);

  // Persist asynchronously (don't block the caller)
  persistNonce(normalizedAddress, nonce).catch((err) => {
    log.error({ user: normalizedAddress, err }, "Background nonce persistence failed");
  });
}

/**
 * Validate that a nonce is greater than the last used nonce
 */
export function validateNonceIncremental(
  userAddress: string,
  nonce: bigint
): { valid: boolean; error?: string; lastNonce?: bigint } {
  const normalizedAddress = userAddress.toLowerCase();
  const lastNonce = getLastNonce(normalizedAddress);

  if (nonce <= lastNonce) {
    return {
      valid: false,
      error: `Nonce must be greater than last used nonce: ${lastNonce.toString()}`,
      lastNonce,
    };
  }

  return { valid: true, lastNonce };
}

export interface UserBalance {
  balance: string; // BigInt as string (wei)
  updatedAt: number; // Timestamp
}

export interface PendingWithdrawal {
  user: string;
  amount: string; // BigInt as string (wei)
  nonce: string; // BigInt as string
  timestamp: number;
  txHash?: string; // L2 transaction hash (if applicable)
  debitHash?: string; // Hash of the debit frozen entry (proof of balance deduction)
}

export interface ForceWithdrawal {
  withdrawalHash: string;
  user: string;
  amount: string;
  deadline: number;
  timestamp: number;
}

export interface Batch {
  batchId: string;
  root: string;
  withdrawals: PendingWithdrawal[];
  forceWithdrawals?: ForceWithdrawal[]; // Add force withdrawals to batch
  timestamp: number;
  blockNumber?: number;
  txHash?: string;
}

export interface ProcessedDeposit {
  txHash: string;
  user: string;
  amount: string;
  blockNumber: number;
  timestamp: number;
}

// Cache for trusted relay public keys (with TTL)
interface TrustedRelaysCache {
  pubKeys: string[];
  timestamp: number;
  ttl: number; // Cache TTL in milliseconds (default: 5 minutes)
}

let trustedRelaysCache: TrustedRelaysCache | null = null;
const DEFAULT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get trusted relay public keys (from registry + own relay)
 *
 * This function:
 * 1. Always includes the own relay's pub key
 * 2. Queries the on-chain registry for active relays
 * 3. Caches the result with TTL to avoid excessive queries
 * 4. Falls back to own relay only if registry is unavailable
 *
 * @param chainId - Optional chain ID (defaults to env var REGISTRY_CHAIN_ID)
 * @param forceRefresh - Force refresh cache (default: false)
 * @returns Array of trusted relay public keys
 */
export async function getTrustedRelayPubKeys(
  chainId?: number,
  forceRefresh: boolean = false
): Promise<string[]> {
  const now = Date.now();

  // Check cache validity
  if (
    !forceRefresh &&
    trustedRelaysCache &&
    now - trustedRelaysCache.timestamp < trustedRelaysCache.ttl
  ) {
    log.debug(
      {
        cachedCount: trustedRelaysCache.pubKeys.length,
        cacheAge: now - trustedRelaysCache.timestamp,
      },
      "Using cached trusted relay pub keys"
    );
    return [...trustedRelaysCache.pubKeys]; // Return copy
  }

  // Start with own relay (always trusted)
  const trusted = new Set<string>();
  const ownRelayKeyPair = getRelayKeyPair();
  if (ownRelayKeyPair?.pub) {
    trusted.add(ownRelayKeyPair.pub);
    log.debug(
      { ownRelayPub: ownRelayKeyPair.pub.substring(0, 16) },
      "Added own relay to trusted list"
    );
  }

  // Try to get active relays from registry
  try {
    const registryChainId = chainId || parseInt(process.env.REGISTRY_CHAIN_ID || "84532");
    const registryClient = createRegistryClient(registryChainId);
    const activeRelays = await registryClient.getActiveRelays();

    let addedCount = 0;
    for (const relay of activeRelays) {
      if (relay.gunPubKey && relay.status === "Active") {
        trusted.add(relay.gunPubKey);
        addedCount++;
      }
    }

    log.debug(
      {
        activeRelaysCount: activeRelays.length,
        addedCount,
        totalTrusted: trusted.size,
      },
      "Fetched active relays from registry"
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.warn(
      { error: errorMessage, chainId },
      "Failed to fetch active relays from registry, using own relay only"
    );
    // Fallback: continue with own relay only
  }

  const pubKeys = Array.from(trusted);

  // Update cache
  trustedRelaysCache = {
    pubKeys,
    timestamp: now,
    ttl: DEFAULT_CACHE_TTL,
  };

  log.debug({ trustedCount: pubKeys.length }, "Updated trusted relay pub keys cache");

  return pubKeys;
}

/**
 * Clear the trusted relays cache (useful for testing or forced refresh)
 */
export function clearTrustedRelaysCache(): void {
  trustedRelaysCache = null;
  log.debug("Cleared trusted relay pub keys cache");
}

/**
 * Force refresh the trusted relays cache
 *
 * @param chainId - Optional chain ID (defaults to env var REGISTRY_CHAIN_ID)
 * @returns Array of trusted relay public keys
 */
export async function refreshTrustedRelaysCache(chainId?: number): Promise<string[]> {
  log.debug("Forcing refresh of trusted relay pub keys cache");
  return await getTrustedRelayPubKeys(chainId, true); // forceRefresh = true
}

// ============================================================================
// DISTRIBUTED LOCK FOR RECONCILIATION
// Prevents race conditions when multiple relays try to reconcile the same user
// ============================================================================

/**
 * Interface for a distributed reconciliation lock
 */
export interface ReconciliationLock {
  relayPub: string;
  userAddress: string;
  acquiredAt: number;
  expiresAt: number;
}

const DEFAULT_LOCK_TTL_MS = 30000; // 30 seconds default TTL for reconciliation lock

/**
 * Acquire a distributed lock for reconciling a user's balance
 * 
 * This prevents multiple relays from reconciling the same user simultaneously,
 * which could lead to balance overwrites and inconsistencies.
 * 
 * @param gun - GunDB instance
 * @param userAddress - User's Ethereum address
 * @param relayPub - Current relay's public key
 * @param ttlMs - Lock time-to-live in milliseconds (default: 30 seconds)
 * @returns true if lock was acquired, false if held by another relay
 */
export async function acquireReconciliationLock(
  gun: IGunInstance,
  userAddress: string,
  relayPub: string,
  ttlMs: number = DEFAULT_LOCK_TTL_MS
): Promise<boolean> {
  const lockPath = `bridge/reconciliation-locks/${userAddress.toLowerCase()}`;
  const now = Date.now();

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      log.warn({ userAddress, lockPath }, "Timeout acquiring reconciliation lock");
      resolve(false);
    }, 5000);

    gun.get(lockPath).once((existingLock: ReconciliationLock | null) => {
      clearTimeout(timeout);

      // Check if there's an existing valid lock from another relay
      if (existingLock && existingLock.expiresAt > now && existingLock.relayPub !== relayPub) {
        log.debug(
          { 
            userAddress, 
            ownedBy: existingLock.relayPub.substring(0, 16), 
            expiresIn: existingLock.expiresAt - now 
          },
          "Reconciliation lock held by another relay"
        );
        resolve(false);
        return;
      }

      // Lock is available or expired - try to acquire it
      const lock: ReconciliationLock = {
        relayPub,
        userAddress: userAddress.toLowerCase(),
        acquiredAt: now,
        expiresAt: now + ttlMs,
      };

      gun.get(lockPath).put(lock as any, (ack: GunMessagePut) => {
        if (ack && "err" in ack && ack.err) {
          log.warn({ userAddress, error: ack.err }, "Failed to acquire reconciliation lock");
          resolve(false);
        } else {
          log.debug(
            { userAddress, relayPub: relayPub.substring(0, 16), ttlMs },
            "Acquired reconciliation lock"
          );
          resolve(true);
        }
      });
    });
  });
}

/**
 * Release a distributed reconciliation lock
 * 
 * Only releases the lock if it's owned by the current relay.
 * 
 * @param gun - GunDB instance
 * @param userAddress - User's Ethereum address
 * @param relayPub - Current relay's public key
 */
export async function releaseReconciliationLock(
  gun: IGunInstance,
  userAddress: string,
  relayPub: string
): Promise<void> {
  const lockPath = `bridge/reconciliation-locks/${userAddress.toLowerCase()}`;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      log.warn({ userAddress, lockPath }, "Timeout releasing reconciliation lock");
      resolve();
    }, 3000);

    gun.get(lockPath).once((existingLock: ReconciliationLock | null) => {
      clearTimeout(timeout);

      // Only release if we own the lock
      if (existingLock && existingLock.relayPub === relayPub) {
        gun.get(lockPath).put(null as any, () => {
          log.debug({ userAddress, relayPub: relayPub.substring(0, 16) }, "Released reconciliation lock");
          resolve();
        });
      } else {
        // Lock not owned by us, nothing to release
        resolve();
      }
    });
  });
}

/**
 * Check if a reconciliation lock is currently held for a user
 * 
 * @param gun - GunDB instance
 * @param userAddress - User's Ethereum address
 * @returns Lock info if held, null if not locked
 */
export async function isReconciliationLockHeld(
  gun: IGunInstance,
  userAddress: string
): Promise<ReconciliationLock | null> {
  const lockPath = `bridge/reconciliation-locks/${userAddress.toLowerCase()}`;
  const now = Date.now();

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(null);
    }, 3000);

    gun.get(lockPath).once((existingLock: ReconciliationLock | null) => {
      clearTimeout(timeout);

      // Check if lock exists and is not expired
      if (existingLock && existingLock.expiresAt > now) {
        resolve(existingLock);
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Get user balance from GunDB
 * Uses frozen-data pattern for secure, verifiable balance storage
 *
 * @param gun - GunDB instance
 * @param userAddress - User's Ethereum address
 * @param relayPub - Optional: Single relay's public key (backward compatibility).
 *                   If not provided, uses all trusted relays from registry.
 * @param chainId - Optional: Chain ID for registry lookup (if relayPub not provided)
 */
export async function getUserBalance(
  gun: IGunInstance,
  userAddress: string,
  relayPub?: string,
  chainId?: number
): Promise<bigint> {
  try {
    const indexKey = userAddress.toLowerCase();

    // Determine trusted signers
    let trustedSigners: string | string[];

    if (relayPub) {
      // Backward compatibility: use single relay if provided
      trustedSigners = relayPub;
      log.debug(
        { user: indexKey, enforceRelayPub: relayPub.substring(0, 16) },
        "Looking up balance with single relay"
      );
    } else {
      // New behavior: use all trusted relays from registry
      const trustedRelays = await getTrustedRelayPubKeys(chainId);
      trustedSigners = trustedRelays;
      log.debug(
        {
          user: indexKey,
          trustedRelaysCount: trustedRelays.length,
          trustedRelays: trustedRelays.map((p) => p.substring(0, 16)),
        },
        "Looking up balance with trusted relays from registry"
      );
    }

    // Get latest frozen entry for this user
    // Accept entries signed by any trusted relay
    const entry = await FrozenData.getLatestFrozenEntry(
      gun,
      "bridge-balances",
      indexKey,
      trustedSigners // Pass trusted signers (single or array)
    );

    log.debug(
      {
        user: indexKey,
        hasEntry: !!entry,
        verified: entry?.verified,
        hasData: !!entry?.data,
      },
      "Balance entry lookup result"
    );

    if (!entry || !entry.verified) {
      // If no verified entry found, try refreshing cache and retry once
      // This handles cases where a new relay was just registered
      if (!relayPub && Array.isArray(trustedSigners) && trustedSigners.length > 0) {
        // Only retry if we're using trusted relays (not single relay mode)
        log.debug(
          { user: indexKey, trustedCount: trustedSigners.length },
          "No verified entry found, attempting cache refresh and retry"
        );

        try {
          const refreshedTrusted = await getTrustedRelayPubKeys(chainId, true); // Force refresh
          if (refreshedTrusted.length > trustedSigners.length) {
            // New relays found, retry with updated list
            log.debug(
              {
                user: indexKey,
                oldCount: trustedSigners.length,
                newCount: refreshedTrusted.length,
              },
              "Cache refreshed, retrying balance lookup with updated relay list"
            );

            const retryEntry = await FrozenData.getLatestFrozenEntry(
              gun,
              "bridge-balances",
              indexKey,
              refreshedTrusted
            );

            if (retryEntry && retryEntry.verified) {
              const retryBalanceData = retryEntry.data as {
                balance?: string;
                user?: string;
                ethereumAddress?: string;
              };

              if (retryBalanceData?.balance) {
                const balance = BigInt(retryBalanceData.balance);
                log.debug(
                  { user: indexKey, balance: balance.toString() },
                  "Balance found after cache refresh"
                );
                return balance;
              }
            }
          }
        } catch (refreshError) {
          log.warn(
            { error: refreshError, user: indexKey },
            "Failed to refresh cache and retry, returning 0"
          );
        }
      }

      // If no verified entry found, return 0
      // Unverified entries are ignored for security
      log.debug({ user: indexKey }, "No verified entry found, returning 0");
      return 0n;
    }

    const balanceData = entry.data as {
      balance?: string;
      user?: string;
      ethereumAddress?: string;
    };

    log.debug(
      {
        user: indexKey,
        balance: balanceData?.balance,
        ethereumAddress: balanceData?.ethereumAddress,
      },
      "Balance data retrieved"
    );

    if (!balanceData || !balanceData.balance) {
      log.debug({ user: indexKey }, "No balance in data, returning 0");
      return 0n;
    }

    try {
      const balance = BigInt(balanceData.balance);
      log.debug({ user: indexKey, balance: balance.toString() }, "Balance retrieved successfully");
      return balance;
    } catch (error) {
      throw new Error(`Invalid balance format: ${error}`);
    }
  } catch (error) {
    // On error, return 0 (fail-safe)
    log.warn({ error, user: userAddress }, "Error getting user balance");
    return 0n;
  }
}

/**
 * Credit user balance (from deposit)
 *
 * SECURITY: Uses frozen-data pattern for immutable, verifiable balance storage
 * - Creates a new frozen entry with signature
 * - Updates index to point to latest balance
 * - Old balances remain immutable (audit trail)
 *
 * @param userAddress - Ethereum address (0x...) from deposit event
 * @param gunPubKey - Optional GunDB pub key if user has linked it
 */
export async function creditBalance(
  gun: IGunInstance,
  userAddress: string,
  amount: bigint,
  relayKeyPair?: {
    pub: string;
    priv: string;
    epub?: string;
    epriv?: string;
  } | null,
  gunPubKey?: string
): Promise<void> {
  if (!relayKeyPair) {
    throw new Error("Relay keypair required for secure balance updates");
  }

  // Normalize Ethereum address
  const ethereumAddress = userAddress.toLowerCase();

  // Use lock manager to prevent race conditions - only one operation per user at a time
  return userLockManager.executeWithLock(ethereumAddress, async () => {
    try {
      log.debug({ user: ethereumAddress, amount: amount.toString() }, "Crediting balance");

      // Retry loop to handle eventual consistency
      // If multiple deposits are processed simultaneously, we need to ensure
      // we read the latest balance before creating a new entry
      const maxRetries = 5;
      let retryCount = 0;
      let success = false;
      let initialBalance = 0n; // Capture initial balance for final verification

      while (retryCount < maxRetries && !success) {
        // Get current balance (by Ethereum address)
        // Wait a bit if retrying to allow GunDB to propagate previous updates
        if (retryCount > 0) {
          await new Promise((resolve) => setTimeout(resolve, 100 * retryCount)); // Exponential backoff
        }

        // Get current balance from any trusted relay to allow balance updates
        // even when the last balance was written by a different trusted relay
        const currentBalance = await getUserBalance(gun, ethereumAddress);
        if (retryCount === 0) {
          initialBalance = currentBalance; // Capture initial balance on first attempt
        }
        const newBalance = currentBalance + amount;

        log.debug(
          {
            user: ethereumAddress,
            currentBalance: currentBalance.toString(),
            amount: amount.toString(),
            newBalance: newBalance.toString(),
            retryAttempt: retryCount + 1,
          },
          "Balance calculation"
        );

        // Create balance data
        const balanceData: any = {
          balance: newBalance.toString(),
          ethereumAddress: ethereumAddress,
          updatedAt: Date.now(),
          type: "bridge-balance",
        };

        // If GunDB pub key is provided, include it in the balance data
        if (gunPubKey) {
          balanceData.gunPubKey = gunPubKey;
        }

        log.debug({ user: ethereumAddress, balanceData }, "Creating frozen entry");

        // Create frozen entry (immutable, signed)
        // Use Ethereum address as index key (deposits come with Ethereum address)
        const indexKey = ethereumAddress;
        await FrozenData.createFrozenEntry(
          gun,
          balanceData,
          relayKeyPair,
          "bridge-balances",
          indexKey
        );

        log.debug({ user: indexKey }, "Frozen entry created successfully");

        // Verify the entry was created and balance is correct
        // Wait a bit for GunDB to propagate the update
        await new Promise((resolve) => setTimeout(resolve, 200));

        const verifyBalance = await getUserBalance(gun, ethereumAddress);
        log.debug(
          {
            user: ethereumAddress,
            expectedBalance: newBalance.toString(),
            actualBalance: verifyBalance.toString(),
            retryAttempt: retryCount + 1,
          },
          "Balance verification after credit"
        );

        // Check if the balance matches what we expected
        // Allow for small differences due to concurrent updates (as long as balance increased)
        if (verifyBalance >= newBalance) {
          // Balance is correct or higher (another deposit was processed concurrently)
          success = true;
        } else if (verifyBalance < currentBalance) {
          // Balance decreased - something went wrong, retry
          log.warn(
            {
              user: ethereumAddress,
              expectedBalance: newBalance.toString(),
              actualBalance: verifyBalance.toString(),
              previousBalance: currentBalance.toString(),
              retryAttempt: retryCount + 1,
            },
            "Balance decreased after credit, retrying"
          );
          retryCount++;
        } else {
          // Balance increased but not as much as expected - concurrent update, retry to get latest
          log.debug(
            {
              user: ethereumAddress,
              expectedBalance: newBalance.toString(),
              actualBalance: verifyBalance.toString(),
              previousBalance: currentBalance.toString(),
              retryAttempt: retryCount + 1,
            },
            "Balance partially updated (concurrent deposit), retrying to ensure consistency"
          );
          retryCount++;
        }
      }

      if (!success) {
        // Final verification after all retries
        // Check if balance increased at least by the amount we're crediting
        await new Promise((resolve) => setTimeout(resolve, 500));
        const finalBalance = await getUserBalance(gun, ethereumAddress);

        if (finalBalance >= initialBalance + amount) {
          // Balance was eventually updated correctly (might be higher due to concurrent deposits)
          success = true;
          log.debug(
            {
              user: ethereumAddress,
              initialBalance: initialBalance.toString(),
              finalBalance: finalBalance.toString(),
              amount: amount.toString(),
              expectedMinBalance: (initialBalance + amount).toString(),
            },
            "Balance eventually updated correctly after retries"
          );
        } else {
          throw new Error(
            `Failed to credit balance after ${maxRetries} retries. Initial: ${initialBalance.toString()}, Final: ${finalBalance.toString()}, Expected at least: ${(initialBalance + amount).toString()}`
          );
        }
      }
    } catch (error) {
      log.error({ error, user: userAddress, amount: amount.toString() }, "Error crediting balance");
      throw new Error(`Failed to credit balance: ${error}`);
    }
  });
}

/**
 * Debit user balance (for withdrawal request)
 * Uses frozen-data pattern for secure, verifiable balance updates
 *
 * @returns The hash of the debit frozen entry (proof of balance deduction)
 */
export async function debitBalance(
  gun: IGunInstance,
  userAddress: string,
  amount: bigint,
  relayKeyPair?: {
    pub: string;
    priv: string;
    epub?: string;
    epriv?: string;
  } | null,
  nonce?: string // Optional nonce to include in the debit entry for linking
): Promise<string> {
  if (!relayKeyPair) {
    throw new Error("Relay keypair required for secure balance updates");
  }

  // Normalize address
  const normalizedAddress = userAddress.toLowerCase();

  // Use lock manager to prevent race conditions
  return userLockManager.executeWithLock(normalizedAddress, async () => {
    try {
      // Get current balance from any trusted relay to allow balance updates
      // even when the last balance was written by a different trusted relay
      const currentBalance = await getUserBalance(gun, normalizedAddress);

      if (currentBalance < amount) {
        throw new Error("Insufficient balance");
      }

      const newBalance = currentBalance - amount;

      // Create balance data with debit tracking
      const balanceData: any = {
        balance: newBalance.toString(),
        user: normalizedAddress,
        updatedAt: Date.now(),
        type: "bridge-balance",
        debit: amount.toString(), // Track what was debited
      };

      // Include nonce if provided (for withdrawal linking)
      if (nonce) {
        balanceData.withdrawalNonce = nonce;
      }

      // Create frozen entry (immutable, signed) and return the hash
      const indexKey = normalizedAddress;
      const result = await FrozenData.createFrozenEntry(
        gun,
        balanceData,
        relayKeyPair,
        "bridge-balances",
        indexKey
      );

      log.debug(
        {
          user: indexKey,
          amount: amount.toString(),
          newBalance: newBalance.toString(),
          debitHash: result.hash,
        },
        "Balance debited successfully"
      );

      return result.hash; // Return the debit proof hash
    } catch (error) {
      throw new Error(`Failed to debit balance: ${error}`);
    }
  });
}

/**
 * Verify that a pending withdrawal is backed by a valid debit entry
 *
 * SECURITY: This ensures that every withdrawal in a batch is legitimate:
 * 1. The debit hash exists in frozen-data
 * 2. The debit entry is signed by the relay (not spoofed)
 * 3. The debit amount and user match the withdrawal
 * 4. The withdrawal nonce matches the debit entry (if present)
 *
 * @param gun - GunDB instance
 * @param withdrawal - The pending withdrawal to verify
 * @param relayPub - The relay's public key (required for signature verification)
 * @returns true if the withdrawal is backed by a valid debit, false otherwise
 */
export async function verifyWithdrawalDebit(
  gun: IGunInstance,
  withdrawal: PendingWithdrawal,
  relayPub?: string,
  chainId?: number
): Promise<{ valid: boolean; reason?: string }> {
  try {
    // If no debitHash, this is an old-style withdrawal (pre-security hardening)
    // TODO: After migration, make debitHash mandatory
    if (!withdrawal.debitHash) {
      log.warn(
        {
          user: withdrawal.user,
          amount: withdrawal.amount,
          nonce: withdrawal.nonce,
        },
        "Withdrawal missing debitHash - cannot verify"
      );
      return {
        valid: false,
        reason: "Missing debitHash - withdrawal was not properly created",
      };
    }

    // Determine trusted signers (same logic as getUserBalance)
    let trustedSigners: string | string[];
    if (relayPub) {
      trustedSigners = relayPub; // Backward compatibility
    } else {
      trustedSigners = await getTrustedRelayPubKeys(chainId);
    }

    // Read the debit frozen entry, accepting entries signed by any trusted relay
    const debitEntry = await FrozenData.readFrozenEntry(
      gun,
      "bridge-balances",
      withdrawal.debitHash,
      trustedSigners
    );

    if (!debitEntry) {
      log.warn(
        {
          user: withdrawal.user,
          debitHash: withdrawal.debitHash,
        },
        "Debit entry not found"
      );
      return {
        valid: false,
        reason: "Debit entry not found in frozen-data",
      };
    }

    if (!debitEntry.verified) {
      log.warn(
        {
          user: withdrawal.user,
          debitHash: withdrawal.debitHash,
          verificationDetails: debitEntry.verificationDetails,
        },
        "Debit entry verification failed"
      );
      return {
        valid: false,
        reason:
          debitEntry.verificationDetails?.reason ||
          "Debit entry signature/hash verification failed",
      };
    }

    // Verify the debit entry matches the withdrawal
    const debitData = debitEntry.data as {
      user?: string;
      debit?: string;
      withdrawalNonce?: string;
      type?: string;
    };

    // Check type
    if (debitData.type !== "bridge-balance") {
      return {
        valid: false,
        reason: `Invalid entry type: expected 'bridge-balance', got '${debitData.type}'`,
      };
    }

    // Check user matches
    if (debitData.user?.toLowerCase() !== withdrawal.user.toLowerCase()) {
      return {
        valid: false,
        reason: `User mismatch: debit=${debitData.user}, withdrawal=${withdrawal.user}`,
      };
    }

    // Check debit amount matches withdrawal amount
    if (debitData.debit !== withdrawal.amount) {
      return {
        valid: false,
        reason: `Amount mismatch: debit=${debitData.debit}, withdrawal=${withdrawal.amount}`,
      };
    }

    // Check nonce if present in debit entry
    if (debitData.withdrawalNonce && debitData.withdrawalNonce !== withdrawal.nonce) {
      return {
        valid: false,
        reason: `Nonce mismatch: debit=${debitData.withdrawalNonce}, withdrawal=${withdrawal.nonce}`,
      };
    }

    log.debug(
      {
        user: withdrawal.user,
        amount: withdrawal.amount,
        nonce: withdrawal.nonce,
        debitHash: withdrawal.debitHash,
      },
      "Withdrawal debit verified successfully"
    );

    return { valid: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(
      {
        error,
        user: withdrawal.user,
        debitHash: withdrawal.debitHash,
      },
      "Error verifying withdrawal debit"
    );
    return {
      valid: false,
      reason: `Verification error: ${errorMessage}`,
    };
  }
}

/**
 * Verify dual signatures: SEA (GunDB) + Ethereum (Wallet)
 *
 * SECURITY: This ensures the user controls both:
 * 1. The GunDB keypair (derived from Ethereum address)
 * 2. The Ethereum wallet (that owns the balance)
 *
 * The message must include: ethereumAddress, to (if transfer), amount, timestamp, nonce
 * to prevent replay attacks and ensure message integrity.
 *
 * @param message - The plain message that was signed (must be JSON string with required fields)
 * @param seaSignature - SEA signature from GunDB keypair (signs the message)
 * @param ethSignature - Ethereum signature (EIP-191) from wallet (signs the message)
 * @param ethAddress - Ethereum address that should match the signer
 * @param gunPubKey - GunDB public key (derived from ethAddress)
 * @param expectedFields - Optional: expected fields in message (for validation)
 * @returns verified message data if signatures are valid, null otherwise
 */
export async function verifyDualSignatures(
  message: string,
  seaSignature: string,
  ethSignature: string,
  ethAddress: string,
  gunPubKey: string,
  expectedFields?: {
    to?: string;
    amount?: string;
    timestamp?: number;
    nonce?: string;
  }
): Promise<{ ethereumAddress: string; [key: string]: any } | null> {
  try {
    // 1. Verify SEA signature (GunDB keypair)
    // SEA.verify returns the original data if signature is valid
    const seaVerified = await SEA.verify(seaSignature, gunPubKey);
    if (!seaVerified) {
      log.warn({ ethAddress }, "SEA signature verification failed");
      return null;
    }

    // Check that the verified data matches the message
    // SEA can return string or object, so we normalize and compare by parsing both
    // CRITICAL: JSON.stringify may produce different key order, so we compare parsed objects
    let seaDataObj: any;
    let messageObj: any;

    try {
      seaDataObj = typeof seaVerified === "string" ? JSON.parse(seaVerified) : seaVerified;
    } catch {
      // If not JSON, treat as plain string
      seaDataObj = seaVerified;
    }

    try {
      messageObj = typeof message === "string" ? JSON.parse(message) : message;
    } catch {
      // If not JSON, treat as plain string
      messageObj = message;
    }

    // Compare objects by deep equality (not string comparison)
    // This handles cases where JSON.stringify produces different key orders
    function deepEqual(obj1: any, obj2: any): boolean {
      if (obj1 === obj2) return true;

      if (obj1 == null || obj2 == null) return false;
      if (typeof obj1 !== typeof obj2) return false;

      if (typeof obj1 !== "object") {
        return obj1 === obj2;
      }

      // Both are objects - compare keys and values
      const keys1 = Object.keys(obj1).sort();
      const keys2 = Object.keys(obj2).sort();

      if (keys1.length !== keys2.length) return false;

      for (let i = 0; i < keys1.length; i++) {
        if (keys1[i] !== keys2[i]) return false;
        if (!deepEqual(obj1[keys1[i]], obj2[keys2[i]])) return false;
      }

      return true;
    }

    // Normalize message for logging and signature verification
    const normalizedMessage = typeof message === "string" ? message : JSON.stringify(message);

    // Compare objects using deep equality
    if (
      typeof seaDataObj === "object" &&
      typeof messageObj === "object" &&
      seaDataObj !== null &&
      messageObj !== null &&
      !Array.isArray(seaDataObj) &&
      !Array.isArray(messageObj)
    ) {
      if (!deepEqual(seaDataObj, messageObj)) {
        log.warn(
          {
            ethAddress,
            seaDataPreview: JSON.stringify(seaDataObj).substring(0, 200),
            messagePreview: JSON.stringify(messageObj).substring(0, 200),
          },
          "SEA verified data does not match message (deep comparison)"
        );
        return null;
      }
    } else {
      // If one is not an object, compare as strings
      const seaData = typeof seaVerified === "string" ? seaVerified : JSON.stringify(seaVerified);

      if (seaData !== normalizedMessage) {
        log.warn(
          {
            ethAddress,
            seaDataLength: seaData.length,
            messageLength: normalizedMessage.length,
            seaDataPreview: seaData.substring(0, 200),
            messagePreview: normalizedMessage.substring(0, 200),
          },
          "SEA verified data does not match message (string comparison)"
        );
        return null;
      }
    }

    // 2. Verify Ethereum signature (wallet)
    // Use ethers to recover the signer from the signature
    const { ethers } = await import("ethers");
    let recoveredAddress: string;
    try {
      recoveredAddress = ethers.verifyMessage(message, ethSignature);
    } catch (error) {
      log.warn({ ethAddress, error }, "Ethereum signature verification failed");
      return null;
    }

    // Check that recovered address matches the provided address
    if (recoveredAddress.toLowerCase() !== ethAddress.toLowerCase()) {
      log.warn(
        {
          ethAddress,
          recoveredAddress,
          messagePreview: normalizedMessage.substring(0, 200),
        },
        "Recovered Ethereum address does not match provided address"
      );
      return null;
    }

    // 3. Parse and validate message content
    let messageData: { ethereumAddress?: string; [key: string]: any };
    try {
      messageData = typeof seaVerified === "string" ? JSON.parse(seaVerified) : seaVerified;
    } catch {
      // If not JSON, treat as plain string (less secure, but backward compatible)
      messageData = { ethereumAddress: ethAddress };
    }

    // Verify ethereumAddress in message matches
    if (
      !messageData.ethereumAddress ||
      messageData.ethereumAddress.toLowerCase() !== ethAddress.toLowerCase()
    ) {
      return null;
    }

    // 4. Validate expected fields (if provided)
    if (expectedFields) {
      if (expectedFields.to && messageData.to?.toLowerCase() !== expectedFields.to.toLowerCase()) {
        log.warn({ expectedTo: expectedFields.to, actualTo: messageData.to }, "To field mismatch");
        return null;
      }
      if (expectedFields.amount && messageData.amount !== expectedFields.amount) {
        log.warn(
          {
            expectedAmount: expectedFields.amount,
            actualAmount: messageData.amount,
          },
          "Amount field mismatch"
        );
        return null;
      }
      if (expectedFields.nonce && messageData.nonce !== expectedFields.nonce) {
        log.warn(
          {
            expectedNonce: expectedFields.nonce,
            actualNonce: messageData.nonce,
          },
          "Nonce field mismatch"
        );
        return null;
      }
      // Timestamp validation: must be recent (within 5 minutes) to prevent replay
      // Use the message timestamp as the reference point, not the server time
      if (expectedFields.timestamp !== undefined && messageData.timestamp) {
        const messageTime =
          typeof messageData.timestamp === "number"
            ? messageData.timestamp
            : parseInt(messageData.timestamp);
        const now = expectedFields.timestamp; // Use provided timestamp (server time) as reference
        const maxAge = 5 * 60 * 1000; // 5 minutes (reduced from 1 hour)
        const timeDiff = Math.abs(now - messageTime);
        if (timeDiff > maxAge) {
          log.warn(
            {
              messageTime,
              serverTime: now,
              timeDiff,
              maxAge,
            },
            "Message timestamp too old or from future"
          );
          return null; // Message too old or from future
        }
      }

      // Nonce tracking for replay attack prevention
      // Check if this nonce has already been used
      if (expectedFields.nonce && messageData.nonce) {
        const normalizedAddress = ethAddress.toLowerCase();
        const userNonces = usedNonces.get(normalizedAddress) || new Set<string>();
        const nonceStr = String(messageData.nonce);

        if (userNonces.has(nonceStr)) {
          log.warn({ ethAddress, nonce: nonceStr }, "Nonce already used - replay attack detected");
          return null; // Replay attack detected
        }

        // Mark nonce as used
        userNonces.add(nonceStr);
        usedNonces.set(normalizedAddress, userNonces);

        // Cleanup old nonces (keep last 1000 per user)
        if (userNonces.size > 1000) {
          const noncesArray = Array.from(userNonces);
          const toRemove = noncesArray.slice(0, noncesArray.length - 1000);
          toRemove.forEach((n) => userNonces.delete(n));
        }
      }
    }

    // All checks passed!
    return {
      ...messageData,
      ethereumAddress: messageData.ethereumAddress,
    } as { ethereumAddress: string; [key: string]: any };
  } catch (error) {
    return null;
  }
}

/**
 * Transfer balance from one user to another (L2 -> L2)
 *
 * SECURITY:
 * - Requires dual signatures: SEA (GunDB) + Ethereum (Wallet)
 * - Verifies user controls both the GunDB keypair AND the Ethereum wallet
 * - Uses frozen-data pattern for immutable, verifiable transfers
 * - Creates frozen entries for both sender (debit) and receiver (credit)
 * - Both entries are signed by relay
 * - Transfer is atomic (both succeed or both fail)
 *
 * @param fromEthAddress - Ethereum address of sender
 * @param toEthAddress - Ethereum address of receiver
 * @param amount - Amount to transfer
 * @param message - Plain message that was signed (must include fromEthAddress)
 * @param seaSignature - SEA signature from GunDB keypair (derived from fromEthAddress)
 * @param ethSignature - Ethereum signature (EIP-191) from wallet
 * @param gunPubKey - GunDB public key (derived from fromEthAddress)
 */
export async function transferBalance(
  gun: IGunInstance,
  fromEthAddress: string,
  toEthAddress: string,
  amount: bigint,
  relayKeyPair: { pub: string; priv: string; epub?: string; epriv?: string },
  message: string,
  seaSignature: string,
  ethSignature: string,
  gunPubKey: string
): Promise<{ txHash: string; fromBalance: string; toBalance: string }> {
  if (!relayKeyPair) {
    throw new Error("Relay keypair required for secure transfers");
  }

  try {
    // Normalize addresses
    const fromAddress = fromEthAddress.toLowerCase();
    const toAddress = toEthAddress.toLowerCase();

    // SECURITY: Verify dual signatures - client must prove control of BOTH:
    // 1. GunDB keypair (derived from Ethereum address)
    // 2. Ethereum wallet (that owns the balance)
    // Also verify message content matches the transfer parameters
    const verifiedMessage = await verifyDualSignatures(
      message,
      seaSignature,
      ethSignature,
      fromAddress,
      gunPubKey,
      {
        to: toAddress,
        amount: amount.toString(),
        timestamp: Date.now(), // Will check message timestamp is recent (5 min window)
      }
    );

    if (!verifiedMessage) {
      throw new Error(
        "Invalid signatures or message content mismatch: must provide valid SEA and Ethereum signatures with correct message content"
      );
    }

    // SECURITY: Get current balances from any trusted relay
    // Accept balances signed by any trusted relay from the registry to allow
    // transfers across different relays in the network
    const fromBalance = await getUserBalance(gun, fromAddress);
    const toBalance = await getUserBalance(gun, toAddress);

    // Check sufficient balance
    if (fromBalance < amount) {
      throw new Error("Insufficient balance");
    }

    // Create transfer ID (hash of transfer data for idempotency)
    const transferId = `${fromAddress.toLowerCase()}:${toAddress.toLowerCase()}:${amount}:${Date.now()}`;
    const transferHash = await (Gun as any).SEA.work(transferId, null, null, {
      name: "SHA-256",
    });

    // Create transfer data (frozen entry) - do this first for audit trail
    const transferData = {
      type: "bridge-transfer",
      from: fromAddress.toLowerCase(),
      to: toAddress.toLowerCase(),
      amount: amount.toString(),
      transferHash,
      timestamp: Date.now(),
    };

    // Create frozen entry for transfer record
    await FrozenData.createFrozenEntry(
      gun,
      transferData,
      relayKeyPair,
      "bridge-transfers",
      transferHash
    );

    // IMPORTANT: Use debitBalance and creditBalance functions instead of creating entries directly
    // These functions handle race conditions and ensure balance consistency
    // Debit sender balance first (atomic operation with retry logic)
    await debitBalance(gun, fromAddress, amount, relayKeyPair);

    // Credit receiver balance (atomic operation with retry logic)
    // Note: creditBalance expects amount as bigint and handles the addition internally
    await creditBalance(gun, toAddress, amount, relayKeyPair);

    // Get final balances for return value (after operations complete)
    // Use trusted relays to get balances that may have been written by this or other trusted relays
    const finalFromBalance = await getUserBalance(gun, fromAddress);
    const finalToBalance = await getUserBalance(gun, toAddress);

    log.debug(
      {
        from: fromAddress,
        to: toAddress,
        amount: amount.toString(),
        finalFromBalance: finalFromBalance.toString(),
        finalToBalance: finalToBalance.toString(),
        transferHash,
      },
      "Transfer completed successfully"
    );

    return {
      txHash: transferHash,
      fromBalance: finalFromBalance.toString(),
      toBalance: finalToBalance.toString(),
    };
  } catch (error) {
    throw new Error(`Failed to transfer balance: ${error}`);
  }
}

/**
 * Add pending withdrawal
 */
export async function addPendingWithdrawal(
  gun: IGunInstance,
  withdrawal: PendingWithdrawal
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Use individual nodes: bridge/withdrawals/pending/{userAddress}:{nonce}
    // This avoids GunDB array handling issues
    const withdrawalKey = `${withdrawal.user.toLowerCase()}:${withdrawal.nonce}`;
    const withdrawalNode = gun.get("bridge/withdrawals/pending").get(withdrawalKey);

    const timeout = setTimeout(() => {
      reject(new Error("Timeout waiting for GunDB response"));
    }, 10000); // 10 second timeout

    const cleanup = () => clearTimeout(timeout);

    try {
      // Check if withdrawal already exists
      withdrawalNode.once((existing: PendingWithdrawal | null | undefined) => {
        try {
          if (existing && typeof existing === "object" && existing.user && existing.nonce) {
            log.warn({ withdrawal, existing }, "Withdrawal with this nonce already exists");
            cleanup();
            reject(new Error("Withdrawal with this nonce already exists"));
            return;
          }

          // Save the withdrawal as an individual node
          withdrawalNode.put(withdrawal, (ack: GunMessagePut) => {
            if (ack && "err" in ack && ack.err) {
              const errorMsg = typeof ack.err === "string" ? ack.err : String(ack.err);
              log.error(
                { error: errorMsg, withdrawalKey, withdrawal },
                "Error saving pending withdrawal"
              );
              cleanup();
              reject(new Error(errorMsg));
            } else {
              log.debug({ withdrawalKey, withdrawal }, "Pending withdrawal added successfully");
              cleanup();
              resolve();
            }
          });
        } catch (innerError) {
          cleanup();
          log.error({ error: innerError, withdrawal }, "Error processing pending withdrawal");
          reject(innerError instanceof Error ? innerError : new Error(String(innerError)));
        }
      });
    } catch (outerError) {
      cleanup();
      log.error({ error: outerError, withdrawal }, "Error setting up pending withdrawal listener");
      reject(outerError instanceof Error ? outerError : new Error(String(outerError)));
    }
  });
}

/**
 * Get all pending withdrawals
 */
export async function getPendingWithdrawals(gun: IGunInstance): Promise<PendingWithdrawal[]> {
  return new Promise((resolve, reject) => {
    const withdrawalsPath = "bridge/withdrawals/pending";
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // Resolve with whatever we collected so far
        const normalized = withdrawals.filter(
          (w): w is PendingWithdrawal =>
            w &&
            typeof w === "object" &&
            typeof w.user === "string" &&
            typeof w.amount === "string" &&
            typeof w.nonce === "string" &&
            typeof w.timestamp === "number"
        );
        log.debug(
          { totalFound: withdrawals.length, normalized: normalized.length },
          "Retrieved pending withdrawals (timeout)"
        );
        resolve(normalized);
      }
    }, 10000);

    const withdrawals: PendingWithdrawal[] = [];
    let resolved = false;
    let mapSubscription: any = null;

    const cleanup = () => {
      clearTimeout(timeout);
      if (mapSubscription) {
        try {
          gun.get(withdrawalsPath).map().off();
        } catch (e) {
          // Ignore unsubscribe errors
        }
      }
      resolved = true;
    };

    // First, try reading the parent node directly (for backward compatibility and immediate data)
    const parentNode = gun.get(withdrawalsPath);

    // Use map to iterate through all child nodes (one-time collection)
    const collectedKeys = new Set<string>();
    mapSubscription = parentNode.map().on((withdrawal: PendingWithdrawal | null, key: string) => {
      if (resolved) return;

      // Skip metadata keys
      if (key === "_" || key.startsWith("_")) {
        return;
      }

      // Skip 'list' key (old format)
      if (key === "list") {
        return;
      }

      // Skip if we've already processed this key
      if (collectedKeys.has(key)) {
        return;
      }
      collectedKeys.add(key);

      // Validate withdrawal object
      if (
        withdrawal &&
        typeof withdrawal === "object" &&
        typeof withdrawal.user === "string" &&
        typeof withdrawal.amount === "string" &&
        typeof withdrawal.nonce === "string" &&
        typeof withdrawal.timestamp === "number"
      ) {
        // Check if already added (deduplicate)
        const exists = withdrawals.some(
          (w) =>
            w.user.toLowerCase() === withdrawal.user.toLowerCase() && w.nonce === withdrawal.nonce
        );

        if (!exists) {
          withdrawals.push(withdrawal as PendingWithdrawal);
          log.debug(
            { key, withdrawal, total: withdrawals.length },
            "Found pending withdrawal node"
          );
        }
      }
    });

    // Also try reading the parent node directly (for backward compatibility)
    parentNode.once(
      (
        data:
          | Record<string, PendingWithdrawal>
          | PendingWithdrawal[]
          | { list?: PendingWithdrawal[] }
          | null
          | undefined
      ) => {
        if (resolved) return;

        try {
          // Handle different data formats for backward compatibility
          if (Array.isArray(data)) {
            // Old format: direct array
            data.forEach((w) => {
              if (
                w &&
                typeof w === "object" &&
                typeof w.user === "string" &&
                typeof w.amount === "string" &&
                typeof w.nonce === "string" &&
                typeof w.timestamp === "number"
              ) {
                const exists = withdrawals.some(
                  (w2) => w2.user.toLowerCase() === w.user.toLowerCase() && w2.nonce === w.nonce
                );
                if (!exists) {
                  withdrawals.push(w as PendingWithdrawal);
                }
              }
            });
          } else if (data && typeof data === "object") {
            // Check for old format: { list: [...] }
            if ("list" in data && Array.isArray(data.list)) {
              data.list.forEach((w) => {
                if (
                  w &&
                  typeof w === "object" &&
                  typeof w.user === "string" &&
                  typeof w.amount === "string" &&
                  typeof w.nonce === "string" &&
                  typeof w.timestamp === "number"
                ) {
                  const exists = withdrawals.some(
                    (w2) => w2.user.toLowerCase() === w.user.toLowerCase() && w2.nonce === w.nonce
                  );
                  if (!exists) {
                    withdrawals.push(w as PendingWithdrawal);
                  }
                }
              });
            } else {
              // New format: individual nodes { "user:nonce": withdrawal, ... }
              for (const [key, value] of Object.entries(data)) {
                if (key === "_" || key.startsWith("_") || key === "list") {
                  continue;
                }

                if (
                  value &&
                  typeof value === "object" &&
                  typeof value.user === "string" &&
                  typeof value.amount === "string" &&
                  typeof value.nonce === "string" &&
                  typeof value.timestamp === "number"
                ) {
                  const exists = withdrawals.some(
                    (w) =>
                      w.user.toLowerCase() === value.user.toLowerCase() && w.nonce === value.nonce
                  );
                  if (!exists) {
                    withdrawals.push(value as PendingWithdrawal);
                  }
                }
              }
            }
          }

          // Wait a bit to let .map() collect all nodes, then resolve
          setTimeout(() => {
            if (resolved) return;

            // Normalize and filter withdrawals
            const normalized = withdrawals.filter(
              (w): w is PendingWithdrawal =>
                w &&
                typeof w === "object" &&
                typeof w.user === "string" &&
                typeof w.amount === "string" &&
                typeof w.nonce === "string" &&
                typeof w.timestamp === "number"
            );

            // Retrieved pending withdrawals - only log if count is unusual or for debugging

            cleanup();
            resolve(normalized);
          }, 1000); // Give GunDB time to propagate (increased from 500ms)
        } catch (error) {
          if (resolved) return;
          cleanup();
          log.error({ error, data }, "Error retrieving pending withdrawals");
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    );
  });
}

/**
 * Remove pending withdrawals (after batch submission)
 */
export async function removePendingWithdrawals(
  gun: IGunInstance,
  withdrawalsToRemove: PendingWithdrawal[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const withdrawalsPath = "bridge/withdrawals/pending";
    const timeout = setTimeout(() => {
      reject(new Error("Timeout waiting for GunDB response"));
    }, 10000);

    // Create a set of withdrawal keys to remove
    const toRemoveKeys = new Set(
      withdrawalsToRemove.map((w) => `${w.user.toLowerCase()}:${w.nonce}`)
    );

    // Delete individual nodes
    let deleted = 0;
    let errors: string[] = [];

    const deleteNode = (key: string, index: number) => {
      const withdrawalNode = gun.get(withdrawalsPath).get(key);

      withdrawalNode.put(null, (ack: GunMessagePut) => {
        if (ack && "err" in ack && ack.err) {
          const errorMsg = typeof ack.err === "string" ? ack.err : String(ack.err);
          errors.push(`Error deleting ${key}: ${errorMsg}`);
        } else {
          deleted++;
          // Deleted pending withdrawal node - too verbose for production
        }

        // When all deletions are attempted, resolve/reject
        if (deleted + errors.length === toRemoveKeys.size) {
          clearTimeout(timeout);
          if (errors.length > 0) {
            log.warn({ errors, deleted }, "Some withdrawals failed to delete");
            // Still resolve if at least some were deleted
            if (deleted > 0) {
              resolve();
            } else {
              reject(new Error(`Failed to delete withdrawals: ${errors.join(", ")}`));
            }
          } else {
            // All pending withdrawals removed successfully - only log if issues occur
            resolve();
          }
        }
      });
    };

    // Delete all withdrawal nodes
    if (toRemoveKeys.size === 0) {
      clearTimeout(timeout);
      resolve();
      return;
    }

    let index = 0;
    for (const key of toRemoveKeys) {
      deleteNode(key, index++);
    }
  });
}

/**
 * Save batch to GunDB with reliable persistence
 *
 * Strategy:
 * 1. Save withdrawals as a JSON string in batch metadata (most reliable)
 * 2. Also save individual withdrawal nodes (for backward compatibility)
 * 3. Verify the data is readable before returning
 */
export async function saveBatch(gun: IGunInstance, batch: Batch): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const batchPath = `bridge/batches/${batch.batchId}`;
    const batchesParentPath = `bridge/batches`;
    const withdrawalsPath = `${batchPath}/withdrawals`;

    try {
      // Serialize withdrawals to JSON string for reliable storage
      const withdrawalsJson = JSON.stringify(batch.withdrawals);

      // First, save the batch metadata WITH withdrawals as JSON string
      const batchData = {
        batchId: batch.batchId,
        root: batch.root,
        withdrawalsCount: batch.withdrawals.length,
        withdrawalsJson, // Store as JSON string for reliability
        timestamp: batch.timestamp,
        blockNumber: batch.blockNumber,
        txHash: batch.txHash,
      };

      // Save batch metadata with retries
      const saveWithRetry = async (attempt: number = 1, maxAttempts: number = 3): Promise<void> => {
        return new Promise<void>((res, rej) => {
          const timeout = setTimeout(() => {
            if (attempt < maxAttempts) {
              log.warn({ batchId: batch.batchId, attempt }, "Timeout saving batch, retrying...");
              saveWithRetry(attempt + 1, maxAttempts)
                .then(res)
                .catch(rej);
            } else {
              rej(new Error("Timeout saving batch metadata after retries"));
            }
          }, 10000);

          gun.get(batchPath).put(batchData, (ack: GunMessagePut) => {
            clearTimeout(timeout);
            if (ack && "err" in ack && ack.err) {
              const errorMsg = typeof ack.err === "string" ? ack.err : String(ack.err);
              if (attempt < maxAttempts) {
                log.warn(
                  { error: errorMsg, batchId: batch.batchId, attempt },
                  "Error saving batch, retrying..."
                );
                setTimeout(
                  () =>
                    saveWithRetry(attempt + 1, maxAttempts)
                      .then(res)
                      .catch(rej),
                  500 * attempt
                );
              } else {
                log.error(
                  { error: errorMsg, batchPath, batchId: batch.batchId },
                  "Error saving batch metadata to GunDB after retries"
                );
                rej(new Error(errorMsg));
              }
            } else {
              log.debug(
                {
                  batchId: batch.batchId,
                  withdrawalCount: batch.withdrawals.length,
                  withdrawalsJsonLength: withdrawalsJson.length,
                },
                "Batch metadata saved to GunDB"
              );
              res();
            }
          });
        });
      };

      await saveWithRetry();

      // Also save a reference in the parent node so it's immediately visible
      await new Promise<void>((res) => {
        const timeout = setTimeout(() => {
          log.warn(
            { batchId: batch.batchId },
            "Timeout saving batch reference in parent node (non-critical)"
          );
          res();
        }, 5000);

        gun
          .get(batchesParentPath)
          .get(batch.batchId)
          .put(batchData, (ack: GunMessagePut) => {
            clearTimeout(timeout);
            if (ack && "err" in ack && ack.err) {
              const errorMsg = typeof ack.err === "string" ? ack.err : String(ack.err);
              log.warn(
                { error: errorMsg, batchId: batch.batchId },
                "Warning: Error saving batch reference in parent node (non-critical)"
              );
            } else {
              // Batch reference saved in parent node - too verbose for production
            }
            res();
          });
      });

      // Also save each withdrawal as a separate node (for backward compatibility)
      // These are saved in parallel with a shorter timeout since we have the JSON backup
      const savePromises: Promise<void>[] = [];
      batch.withdrawals.forEach((withdrawal, index) => {
        savePromises.push(
          new Promise((res) => {
            const withdrawalKey = `${index}`;
            const withdrawalNodePath = `${withdrawalsPath}/${withdrawalKey}`;
            const timeout = setTimeout(() => {
              log.warn(
                { withdrawalNodePath, index },
                "Timeout saving individual withdrawal node (non-critical, JSON backup exists)"
              );
              res();
            }, 5000);

            gun.get(withdrawalNodePath).put(withdrawal, (ack: GunMessagePut) => {
              clearTimeout(timeout);
              if (ack && "err" in ack && ack.err) {
                const errorMsg = typeof ack.err === "string" ? ack.err : String(ack.err);
                log.warn(
                  { error: errorMsg, withdrawalNodePath, index },
                  "Error saving individual withdrawal node (non-critical, JSON backup exists)"
                );
              } else {
                // Individual withdrawal node saved to GunDB - too verbose for production
              }
              res();
            });
          })
        );
      });

      await Promise.all(savePromises);

      // Verify the batch is readable by attempting to read it back
      await new Promise<void>((verifyRes, verifyRej) => {
        const verifyTimeout = setTimeout(() => {
          log.warn(
            { batchId: batch.batchId },
            "Timeout verifying batch readability (proceeding anyway)"
          );
          verifyRes();
        }, 5000);

        gun.get(batchPath).once((readData: any) => {
          clearTimeout(verifyTimeout);
          if (readData && readData.batchId && readData.withdrawalsJson) {
            try {
              const parsedWithdrawals = JSON.parse(readData.withdrawalsJson);
              if (
                Array.isArray(parsedWithdrawals) &&
                parsedWithdrawals.length === batch.withdrawals.length
              ) {
                log.debug(
                  { batchId: batch.batchId, readBackWithdrawals: parsedWithdrawals.length },
                  "Batch verified: successfully read back with correct withdrawal count"
                );
              } else {
                log.warn(
                  {
                    batchId: batch.batchId,
                    expected: batch.withdrawals.length,
                    got: parsedWithdrawals?.length,
                  },
                  "Batch verification: withdrawal count mismatch but JSON is present"
                );
              }
            } catch (parseErr) {
              log.warn(
                { batchId: batch.batchId, parseErr },
                "Batch verification: failed to parse withdrawalsJson"
              );
            }
            verifyRes();
          } else {
            log.warn(
              { batchId: batch.batchId, readData: !!readData },
              "Batch verification: could not read back batch data immediately"
            );
            verifyRes();
          }
        });
      });

      // Batch saved and verified successfully to GunDB - only log errors
      resolve();
    } catch (error) {
      log.error(
        { error, batchId: batch.batchId, withdrawalCount: batch.withdrawals.length },
        "Error saving batch to GunDB"
      );
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Get batch by ID
 */
export async function getBatch(gun: IGunInstance, batchId: string): Promise<Batch | null> {
  return new Promise((resolve) => {
    const batchPath = `bridge/batches/${batchId}`;
    const withdrawalsPath = `${batchPath}/withdrawals`;
    const timeout = setTimeout(() => {
      log.warn({ batchPath }, "Timeout waiting for GunDB response in getBatch");
      resolve(null);
    }, 15000); // Increased timeout to 15 seconds

    let batchMetadata: any = null;
    const withdrawalsObj: Record<number, PendingWithdrawal> = {};
    const collectedKeys = new Set<string>();
    let resolved = false;
    let lastUpdateTime = Date.now();

    const cleanup = () => {
      clearTimeout(timeout);
      resolved = true;
    };

    // First, read the batch metadata
    gun.get(batchPath).once((data: any) => {
      if (resolved) return;

      if (!data || !data.batchId) {
        log.warn({ batchPath }, "No batch metadata found");
        cleanup();
        resolve(null);
        return;
      }

      batchMetadata = data;
      lastUpdateTime = Date.now();

      log.debug(
        {
          batchId,
          withdrawalsCount: data.withdrawalsCount || 0,
          hasWithdrawalsJson: !!data.withdrawalsJson,
        },
        "Batch metadata retrieved, reading withdrawals"
      );

      // PREFERRED: Try to read withdrawals from JSON string first (most reliable)
      if (data.withdrawalsJson && typeof data.withdrawalsJson === "string") {
        try {
          const withdrawals = JSON.parse(data.withdrawalsJson) as PendingWithdrawal[];
          if (Array.isArray(withdrawals) && withdrawals.length > 0) {
            cleanup();

            const batch: Batch = {
              batchId: data.batchId,
              root: data.root,
              withdrawals,
              timestamp: data.timestamp,
              blockNumber: data.blockNumber,
              txHash: data.txHash,
            };

            log.debug(
              {
                batchId: data.batchId,
                withdrawalCount: withdrawals.length,
                source: "withdrawalsJson",
                withdrawals: withdrawals.map((w) => ({
                  user: w.user,
                  amount: w.amount,
                  nonce: w.nonce,
                })),
              },
              "Batch retrieved from GunDB (via withdrawalsJson)"
            );
            resolve(batch);
            return;
          }
        } catch (parseErr) {
          log.warn(
            { batchId, parseErr, withdrawalsJsonLength: data.withdrawalsJson?.length },
            "Failed to parse withdrawalsJson, falling back to individual nodes"
          );
        }
      }

      // FALLBACK: Read from individual withdrawal nodes (for backward compatibility)

      // Also try reading the parent withdrawals node directly (for backward compatibility)
      gun.get(withdrawalsPath).once((parentData: any) => {
        if (resolved) return;

        if (parentData && typeof parentData === "object") {
          Object.keys(parentData).forEach((key) => {
            if (key === "_" || key.startsWith("_")) return;
            if (collectedKeys.has(key)) return;

            const withdrawal = parentData[key];
            if (
              withdrawal &&
              typeof withdrawal === "object" &&
              typeof withdrawal.user === "string" &&
              typeof withdrawal.amount === "string" &&
              typeof withdrawal.nonce === "string" &&
              typeof withdrawal.timestamp === "number"
            ) {
              const index = parseInt(key, 10);
              if (!isNaN(index)) {
                collectedKeys.add(key);
                withdrawalsObj[index] = withdrawal as PendingWithdrawal;
                lastUpdateTime = Date.now();
                log.debug(
                  {
                    batchId,
                    index,
                    user: withdrawal.user,
                    amount: withdrawal.amount,
                    nonce: withdrawal.nonce,
                    source: "direct-read",
                  },
                  "Added withdrawal from direct read in getBatch"
                );
              }
            }
          });
        }
      });

      // Use map().on() to collect withdrawals (more reliable than .once() for new data)
      const parentNode = gun.get(withdrawalsPath);
      parentNode.map().on((withdrawal: PendingWithdrawal | null, key: string) => {
        if (resolved) return;

        if (key === "_" || key.startsWith("_") || !key) {
          return;
        }

        if (collectedKeys.has(key)) {
          return;
        }

        lastUpdateTime = Date.now();

        log.debug(
          { batchId, key, withdrawal, withdrawalType: typeof withdrawal },
          "Reading withdrawal from batch in getBatch (map)"
        );

        if (
          withdrawal &&
          typeof withdrawal === "object" &&
          typeof withdrawal.user === "string" &&
          typeof withdrawal.amount === "string" &&
          typeof withdrawal.nonce === "string" &&
          typeof withdrawal.timestamp === "number"
        ) {
          const index = parseInt(key, 10);
          if (!isNaN(index)) {
            collectedKeys.add(key);
            withdrawalsObj[index] = withdrawal as PendingWithdrawal;
            log.debug(
              {
                batchId,
                index,
                user: withdrawal.user,
                amount: withdrawal.amount,
                nonce: withdrawal.nonce,
                source: "map",
              },
              "Added withdrawal from map in getBatch"
            );
          } else {
            log.warn({ batchId, key, withdrawal }, "Invalid index key for withdrawal in getBatch");
          }
        } else {
          log.warn(
            { batchId, key, withdrawal, withdrawalType: typeof withdrawal },
            "Invalid withdrawal format in getBatch"
          );
        }
      });

      // If we know the withdrawalsCount, try reading individual nodes directly (with retries)
      const withdrawalsCount = batchMetadata.withdrawalsCount || 0;

      // Helper function to read a withdrawal by index with retries
      const readWithdrawalByIndex = (index: number, retries = 5, delay = 500) => {
        if (resolved) return;

        const attemptRead = (attempt: number) => {
          if (resolved || attempt > retries) return;

          const withdrawalNode = gun.get(`${withdrawalsPath}/${index}`);

          // Try .once() first
          withdrawalNode.once((withdrawal: PendingWithdrawal | null) => {
            if (resolved) return;

            if (
              withdrawal &&
              typeof withdrawal === "object" &&
              typeof withdrawal.user === "string" &&
              typeof withdrawal.amount === "string" &&
              typeof withdrawal.nonce === "string" &&
              typeof withdrawal.timestamp === "number"
            ) {
              const key = index.toString();
              if (!collectedKeys.has(key)) {
                collectedKeys.add(key);
                withdrawalsObj[index] = withdrawal as PendingWithdrawal;
                lastUpdateTime = Date.now();
                log.debug(
                  {
                    batchId,
                    index,
                    user: withdrawal.user,
                    amount: withdrawal.amount,
                    nonce: withdrawal.nonce,
                    source: "direct-index",
                    attempt,
                  },
                  "Added withdrawal from direct index read in getBatch"
                );
              }
            } else if (attempt < retries) {
              // Retry if withdrawal not found
              setTimeout(() => attemptRead(attempt + 1), delay * attempt);
            }
          });

          // Also try .on() for real-time updates
          withdrawalNode.on((withdrawal: PendingWithdrawal | null) => {
            if (resolved) return;

            if (
              withdrawal &&
              typeof withdrawal === "object" &&
              typeof withdrawal.user === "string" &&
              typeof withdrawal.amount === "string" &&
              typeof withdrawal.nonce === "string" &&
              typeof withdrawal.timestamp === "number"
            ) {
              const key = index.toString();
              if (!collectedKeys.has(key)) {
                collectedKeys.add(key);
                withdrawalsObj[index] = withdrawal as PendingWithdrawal;
                lastUpdateTime = Date.now();
                log.debug(
                  {
                    batchId,
                    index,
                    user: withdrawal.user,
                    amount: withdrawal.amount,
                    nonce: withdrawal.nonce,
                    source: "direct-index-realtime",
                  },
                  "Added withdrawal from direct index read (realtime) in getBatch"
                );
              }
            }
          });
        };

        attemptRead(1);
      };

      if (withdrawalsCount > 0) {
        log.debug(
          { batchId, withdrawalsCount },
          "Attempting to read withdrawals directly by index with retries"
        );

        for (let i = 0; i < withdrawalsCount; i++) {
          readWithdrawalByIndex(i, 5, 500);
        }
      }

      // Check and resolve at multiple intervals
      const checkAndResolve = () => {
        if (resolved) return;

        const timeSinceLastUpdate = Date.now() - lastUpdateTime;
        const expectedCount = withdrawalsCount || Object.keys(withdrawalsObj).length;
        const foundCount = Object.keys(withdrawalsObj).length;

        log.debug(
          {
            batchId,
            withdrawalsFound: foundCount,
            expectedCount,
            timeSinceLastUpdate,
            metadataReadTime: lastUpdateTime,
          },
          "Checking withdrawals collection status in getBatch"
        );

        // If we have all expected withdrawals, resolve immediately
        if (expectedCount > 0 && foundCount >= expectedCount) {
          cleanup();
          parentNode.off(); // Unsubscribe from map events

          // Convert object to sorted array
          const sortedIndices = Object.keys(withdrawalsObj)
            .map((k) => parseInt(k, 10))
            .sort((a, b) => a - b);

          const withdrawals: PendingWithdrawal[] = [];
          sortedIndices.forEach((index) => {
            withdrawals.push(withdrawalsObj[index]);
          });

          const batch: Batch = {
            batchId: batchMetadata.batchId,
            root: batchMetadata.root,
            withdrawals,
            timestamp: batchMetadata.timestamp,
            blockNumber: batchMetadata.blockNumber,
            txHash: batchMetadata.txHash,
          };

          log.debug(
            {
              batchId: batchMetadata.batchId,
              withdrawalCount: withdrawals.length,
              withdrawals: withdrawals.map((w) => ({
                user: w.user,
                amount: w.amount,
                nonce: w.nonce,
              })),
            },
            "Batch retrieved from GunDB (all withdrawals found)"
          );
          resolve(batch);
          return;
        }

        // If we have some withdrawals or we've waited long enough (increased timeout)
        if (foundCount > 0 || timeSinceLastUpdate > 8000) {
          // If we expected withdrawals but haven't found any, wait even more
          if (expectedCount > 0 && foundCount === 0 && timeSinceLastUpdate < 10000) {
            log.debug(
              { batchId, expectedCount, timeSinceLastUpdate },
              "Still waiting for withdrawals in getBatch"
            );
            return; // Wait more
          }

          cleanup();
          parentNode.off(); // Unsubscribe from map events

          // Convert object to sorted array
          const sortedIndices = Object.keys(withdrawalsObj)
            .map((k) => parseInt(k, 10))
            .sort((a, b) => a - b);

          const withdrawals: PendingWithdrawal[] = [];
          sortedIndices.forEach((index) => {
            withdrawals.push(withdrawalsObj[index]);
          });

          // Backward compatibility: try to read from old format if no withdrawals found
          if (withdrawals.length === 0 && batchMetadata.withdrawals) {
            if (Array.isArray(batchMetadata.withdrawals)) {
              withdrawals.push(...batchMetadata.withdrawals);
              log.debug(
                { batchId, source: "old-array-format" },
                "Using old array format for withdrawals"
              );
            } else if (typeof batchMetadata.withdrawals === "object") {
              const oldWithdrawalsObj = batchMetadata.withdrawals;
              const indices = Object.keys(oldWithdrawalsObj)
                .filter((key) => /^\d+$/.test(key))
                .map((key) => parseInt(key, 10))
                .sort((a, b) => a - b);

              indices.forEach((index) => {
                const w = oldWithdrawalsObj[index.toString()];
                if (w) withdrawals.push(w);
              });
              log.debug(
                { batchId, source: "old-object-format" },
                "Using old object format for withdrawals"
              );
            }
          }

          const batch: Batch = {
            batchId: batchMetadata.batchId,
            root: batchMetadata.root,
            withdrawals,
            timestamp: batchMetadata.timestamp,
            blockNumber: batchMetadata.blockNumber,
            txHash: batchMetadata.txHash,
          };

          log.debug(
            {
              batchId: batchMetadata.batchId,
              withdrawalCount: withdrawals.length,
              expectedCount,
              withdrawals: withdrawals.map((w) => ({
                user: w.user,
                amount: w.amount,
                nonce: w.nonce,
              })),
            },
            "Batch retrieved from GunDB"
          );
          resolve(batch);
        }
      };

      // Check at multiple intervals to balance speed and completeness (longer intervals)
      setTimeout(checkAndResolve, 1000);
      setTimeout(checkAndResolve, 2000);
      setTimeout(checkAndResolve, 4000);
      setTimeout(checkAndResolve, 6000);
      setTimeout(checkAndResolve, 8000);
      setTimeout(checkAndResolve, 10000);
    });
  });
}

/**
 * Get latest batch
 */
export async function getLatestBatch(gun: IGunInstance): Promise<Batch | null> {
  return new Promise((resolve) => {
    const batchesPath = "bridge/batches";
    const timeout = setTimeout(() => {
      log.warn({ batchesPath }, "Timeout waiting for GunDB response in getLatestBatch");
      resolve(null);
    }, 15000); // 15 second timeout

    const batchIdsMap = new Map<string, string>(); // key -> batchId
    const collectedKeys = new Set<string>();
    let resolved = false;
    let lastUpdateTime = Date.now();

    const cleanup = () => {
      clearTimeout(timeout);
      resolved = true;
    };

    log.debug({ batchesPath }, "Starting to read batches from GunDB");

    const parentNode = gun.get(batchesPath);

    // Use map().on() with a timeout to collect batch IDs more reliably
    parentNode.map().on((batch: any, key: string) => {
      if (resolved) return;

      // Skip metadata keys
      if (key === "_" || key.startsWith("_") || !key) {
        return;
      }

      lastUpdateTime = Date.now();

      if (
        batch &&
        typeof batch === "object" &&
        typeof batch.batchId === "string" &&
        typeof batch.root === "string"
      ) {
        if (!collectedKeys.has(key)) {
          collectedKeys.add(key);
          batchIdsMap.set(key, batch.batchId);
          log.debug(
            { key, batchId: batch.batchId, totalFound: batchIdsMap.size },
            "Found batch ID in GunDB"
          );
        }
      }
    });

    // Also try reading the parent node directly to get immediate data
    parentNode.once((parentData: any) => {
      if (resolved) return;

      log.debug(
        {
          batchesPath,
          hasData: !!parentData,
          keys: parentData ? Object.keys(parentData).filter((k) => !k.startsWith("_")) : [],
        },
        "Read parent node directly"
      );

      if (parentData && typeof parentData === "object") {
        Object.keys(parentData).forEach((key) => {
          if (key === "_" || key.startsWith("_")) return;

          const batch = parentData[key];
          if (
            batch &&
            typeof batch === "object" &&
            typeof batch.batchId === "string" &&
            typeof batch.root === "string"
          ) {
            if (!collectedKeys.has(key)) {
              collectedKeys.add(key);
              batchIdsMap.set(key, batch.batchId);
              log.debug(
                {
                  key,
                  batchId: batch.batchId,
                  source: "direct-read",
                  totalFound: batchIdsMap.size,
                },
                "Found batch ID via direct read"
              );
            }
          }
        });
      }
    });

    // Wait for data to accumulate, with multiple checkpoints
    const checkAndResolve = async () => {
      if (resolved) return;

      const timeSinceLastUpdate = Date.now() - lastUpdateTime;
      const batchIds = Array.from(batchIdsMap.values());

      log.debug(
        { batchesPath, batchIdsCount: batchIds.length, batchIds, timeSinceLastUpdate },
        "Checking batches collection status"
      );

      if (batchIds.length === 0) {
        // No batches found yet, wait a bit more
        if (timeSinceLastUpdate < 3000) {
          // Still actively receiving data, wait more
          return;
        }
        // No batches found and no updates for 3 seconds
        log.debug({ batchesPath }, "No batches found in GunDB after waiting");
        cleanup();
        parentNode.off(); // Unsubscribe from all events
        resolve(null);
        return;
      }

      // We have some batches, but wait a bit more to ensure we got them all
      if (timeSinceLastUpdate < 2000) {
        // Still receiving data, wait more
        return;
      }

      // Data collection seems complete
      cleanup();
      parentNode.off(); // Unsubscribe from all events

      log.debug(
        { batchesPath, batchIdsCount: batchIds.length, batchIds },
        "Finished collecting batch IDs, fetching full batch data"
      );

      // Fetch all batches using getBatch to properly read withdrawals
      const batchPromises = batchIds.map((id) => getBatch(gun, id));
      const batches = await Promise.all(batchPromises);
      const validBatches = batches.filter((b): b is Batch => b !== null);

      log.debug(
        { batchesPath, requestedCount: batchIds.length, validCount: validBatches.length },
        "Fetched batch data from GunDB"
      );

      if (validBatches.length === 0) {
        log.warn({ batchesPath }, "No valid batches found after fetching");
        resolve(null);
        return;
      }

      // Find the batch with the highest batchId
      let latest: Batch | null = null;
      let latestId = -1;

      log.debug(
        {
          validBatchesCount: validBatches.length,
          batchSummaries: validBatches.map((b) => ({
            batchId: b.batchId,
            batchIdNum: parseInt(b.batchId, 10),
            withdrawalCount: b.withdrawals.length,
            root: b.root,
          })),
        },
        "Analyzing batches to find latest"
      );

      validBatches.forEach((batch) => {
        const batchIdNum = parseInt(batch.batchId, 10);
        if (!isNaN(batchIdNum) && batchIdNum > latestId) {
          latestId = batchIdNum;
          latest = batch;
          log.debug(
            {
              batchId: batch.batchId,
              batchIdNum,
              withdrawalCount: batch.withdrawals.length,
              withdrawals: batch.withdrawals.map((w) => ({
                user: w.user,
                amount: w.amount,
                nonce: w.nonce,
              })),
            },
            "Updated latest batch candidate"
          );
        }
      });

      if (latest) {
        const latestBatch: Batch = latest;
        log.debug(
          {
            latestBatchId: latestBatch.batchId,
            latestBatchRoot: latestBatch.root,
            withdrawalCount: latestBatch.withdrawals.length,
            withdrawals: latestBatch.withdrawals.map((w) => ({
              user: w.user,
              amount: w.amount,
              nonce: w.nonce,
            })),
          },
          "Resolved latest batch from GunDB"
        );
      } else {
        log.warn(
          { batchesPath, validBatchesCount: validBatches.length },
          "Could not determine latest batch"
        );
      }
      resolve(latest);
    };

    // Check at multiple intervals to balance speed and completeness
    setTimeout(checkAndResolve, 500);
    setTimeout(checkAndResolve, 1500);
    setTimeout(checkAndResolve, 3000);
    setTimeout(checkAndResolve, 5000);
  });
}

/**
 * Get all batches from GunDB
 */
export async function getAllBatches(gun: IGunInstance): Promise<Batch[]> {
  return new Promise((resolve) => {
    const batchesPath = "bridge/batches";
    const timeout = setTimeout(() => {
      log.warn({ batchesPath }, "Timeout waiting for GunDB response in getAllBatches");
      resolve([]);
    }, 15000); // 15 second timeout

    const batchIdsMap = new Map<string, string>(); // key -> batchId
    const collectedKeys = new Set<string>();
    let resolved = false;
    let lastUpdateTime = Date.now();

    const cleanup = () => {
      clearTimeout(timeout);
      resolved = true;
    };

    log.debug({ batchesPath }, "Starting to read all batches from GunDB");

    const parentNode = gun.get(batchesPath);

    // Use map().on() to collect batch IDs
    parentNode.map().on((batch: any, key: string) => {
      if (resolved) return;

      // Skip metadata keys
      if (key === "_" || key.startsWith("_") || !key) {
        return;
      }

      lastUpdateTime = Date.now();

      if (
        batch &&
        typeof batch === "object" &&
        typeof batch.batchId === "string" &&
        typeof batch.root === "string"
      ) {
        if (!collectedKeys.has(key)) {
          collectedKeys.add(key);
          batchIdsMap.set(key, batch.batchId);
          log.debug(
            { key, batchId: batch.batchId, totalFound: batchIdsMap.size },
            "Found batch ID in GunDB"
          );
        }
      }
    });

    // Also try reading the parent node directly to get immediate data
    parentNode.once((parentData: any) => {
      if (resolved) return;

      if (parentData && typeof parentData === "object") {
        Object.keys(parentData).forEach((key) => {
          if (key === "_" || key.startsWith("_")) return;

          const batch = parentData[key];
          if (
            batch &&
            typeof batch === "object" &&
            typeof batch.batchId === "string" &&
            typeof batch.root === "string"
          ) {
            if (!collectedKeys.has(key)) {
              collectedKeys.add(key);
              batchIdsMap.set(key, batch.batchId);
            }
          }
        });
      }
    });

    // Wait for data to accumulate, with multiple checkpoints
    const checkAndResolve = async () => {
      if (resolved) return;

      const timeSinceLastUpdate = Date.now() - lastUpdateTime;
      const batchIds = Array.from(batchIdsMap.values());

      log.debug(
        { batchesPath, batchIdsCount: batchIds.length, timeSinceLastUpdate },
        "Checking batches collection status"
      );

      // Wait a bit for data to accumulate
      if (timeSinceLastUpdate < 2000) {
        return;
      }

      // Data collection seems complete
      cleanup();
      parentNode.off(); // Unsubscribe from all events

      log.debug(
        { batchesPath, batchIdsCount: batchIds.length },
        "Finished collecting batch IDs, fetching full batch data"
      );

      // Fetch all batches using getBatch
      const batchPromises = batchIds.map((id) => getBatch(gun, id));
      const batches = await Promise.all(batchPromises);
      const validBatches = batches.filter((b): b is Batch => b !== null);

      log.debug(
        { batchesPath, requestedCount: batchIds.length, validCount: validBatches.length },
        "Fetched all batches from GunDB"
      );

      resolve(validBatches);
    };

    // Check at multiple intervals
    setTimeout(checkAndResolve, 1000);
    setTimeout(checkAndResolve, 2000);
    setTimeout(checkAndResolve, 4000);
    setTimeout(checkAndResolve, 6000);
    setTimeout(checkAndResolve, 8000);
    setTimeout(checkAndResolve, 10000);
  });
}

/**
 * Check if a deposit has already been processed (idempotency)
 * @param depositKey Unique key: "txHash:user:amount"
 */
export async function isDepositProcessed(gun: IGunInstance, depositKey: string): Promise<boolean> {
  return new Promise((resolve) => {
    const processedPath = `bridge/processed-deposits/${depositKey}`;

    gun.get(processedPath).once((data: ProcessedDeposit | null) => {
      resolve(data !== null);
    });
  });
}

/**
 * Mark a deposit as processed (idempotency)
 */
export async function markDepositProcessed(
  gun: IGunInstance,
  depositKey: string,
  deposit: ProcessedDeposit
): Promise<void> {
  return new Promise((resolve, reject) => {
    const processedPath = `bridge/processed-deposits/${depositKey}`;

    gun.get(processedPath).put(deposit, (ack: GunMessagePut) => {
      if (ack && "err" in ack && ack.err) {
        const errorMsg = typeof ack.err === "string" ? ack.err : String(ack.err);
        reject(new Error(errorMsg));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Get all processed deposits for a user from GunDB
 */
export async function getProcessedDepositsForUser(
  gun: IGunInstance,
  userAddress: string
): Promise<ProcessedDeposit[]> {
  return new Promise((resolve) => {
    const deposits: ProcessedDeposit[] = [];
    const normalizedUser = userAddress.toLowerCase();
    const seenKeys = new Set<string>(); // Deduplicate deposits
    const timeout = setTimeout(() => resolve(deposits), 10000);
    let lastUpdateTime = Date.now();

    const depositsNode = gun
      .get("bridge")
      .get("processed-deposits");

    // Use .on() for better data collection from GunDB's eventual consistency
    depositsNode.map().on((deposit: ProcessedDeposit | null, key?: string) => {
      if (!deposit || !key || seenKeys.has(key)) return;

      const depositUser = (deposit.user || "").toLowerCase();
      if (depositUser === normalizedUser) {
        seenKeys.add(key);
        deposits.push(deposit);
        lastUpdateTime = Date.now();
      }
    });

    // Wait for data to settle - resolve when no new updates for 2 seconds
    const checkAndResolve = () => {
      const timeSinceLastUpdate = Date.now() - lastUpdateTime;
      if (timeSinceLastUpdate >= 2000) {
        clearTimeout(timeout);
        depositsNode.map().off(); // Unsubscribe
        resolve(deposits);
      }
    };

    setTimeout(checkAndResolve, 3000);
    setTimeout(checkAndResolve, 5000);
    setTimeout(checkAndResolve, 7000);
  });
}

/**
 * Add a pending force withdrawal to the queue
 */
export async function addPendingForceWithdrawal(
  gun: IGunInstance,
  forceWithdrawal: ForceWithdrawal
): Promise<void> {
  log.debug({ forceWithdrawal }, "Adding pending force withdrawal");

  // Store in simple list/set structure
  // Keyed by withdrawalHash
  gun
    .get("bridge")
    .get("force-withdrawals")
    .get("pending")
    .get(forceWithdrawal.withdrawalHash)
    .put(forceWithdrawal as any);
}

/**
 * Get all pending force withdrawals
 */
export async function getPendingForceWithdrawals(gun: IGunInstance): Promise<ForceWithdrawal[]> {
  return new Promise((resolve) => {
    // const minTimestamp = Date.now() - 24 * 60 * 60 * 1000 * 7; // Last 7 days to be safe
    const withdrawals: ForceWithdrawal[] = [];

    gun
      .get("bridge")
      .get("force-withdrawals")
      .get("pending")
      .once((data: any) => {
        if (!data) {
          resolve([]);
          return;
        }

        // Iterate through keys
        Object.keys(data).forEach((key) => {
          if (key === "_" || !data[key]) return;

          const w = data[key];
          // Basic validation
          if (w.withdrawalHash && w.user && w.amount && w.deadline) {
            withdrawals.push(w);
          }
        });

        resolve(withdrawals);
      });
  });
}

/**
 * Remove pending force withdrawals (after batching)
 */
export async function removePendingForceWithdrawals(
  gun: IGunInstance,
  withdrawals: ForceWithdrawal[]
): Promise<void> {
  log.debug({ count: withdrawals.length }, "Removing pending force withdrawals");

  for (const w of withdrawals) {
    // Nullify entry to remove
    gun
      .get("bridge")
      .get("force-withdrawals")
      .get("pending")
      .get(w.withdrawalHash)
      .put(null as any);
  }
}

// ============================================================================
// ON-CHAIN BALANCE VERIFICATION
// These functions query the blockchain directly to verify balance consistency
// ============================================================================

/**
 * Result from on-chain balance query
 */
export interface OnChainBalanceResult {
  totalDeposits: bigint;
  totalWithdrawals: bigint;
  netBalance: bigint;
  depositCount: number;
  withdrawalCount: number;
}

/**
 * Get user's on-chain balance by querying deposit and withdrawal events
 *
 * This is the SOURCE OF TRUTH for user balances. It queries the blockchain
 * directly to get all deposits and withdrawals for a user.
 *
 * @param bridgeClient - Bridge client for querying events
 * @param userAddress - User's Ethereum address
 * @param startBlock - Block to start querying from (default: 0)
 * @returns On-chain balance information
 */
export async function getOnChainUserBalance(
  bridgeClient: {
    queryDeposits: (fromBlock: number, toBlock: number | "latest", userAddress?: string) => Promise<Array<{ amount: bigint }>>;
    queryWithdrawals: (fromBlock: number, toBlock: number | "latest", userAddress?: string) => Promise<Array<{ amount: bigint }>>;
  },
  userAddress: string,
  startBlock: number = 0
): Promise<OnChainBalanceResult> {
  const normalizedUser = userAddress.toLowerCase();

  log.debug({ user: normalizedUser, startBlock }, "Querying on-chain balance");

  // Query all deposits for this user from the blockchain
  const deposits = await bridgeClient.queryDeposits(startBlock, "latest", normalizedUser);
  const totalDeposits = deposits.reduce((sum, d) => sum + d.amount, 0n);

  // Query all withdrawals for this user from the blockchain
  const withdrawals = await bridgeClient.queryWithdrawals(startBlock, "latest", normalizedUser);
  const totalWithdrawals = withdrawals.reduce((sum, w) => sum + w.amount, 0n);

  const result = {
    totalDeposits,
    totalWithdrawals,
    netBalance: totalDeposits - totalWithdrawals,
    depositCount: deposits.length,
    withdrawalCount: withdrawals.length,
  };

  log.debug(
    {
      user: normalizedUser,
      totalDeposits: totalDeposits.toString(),
      totalWithdrawals: totalWithdrawals.toString(),
      netBalance: result.netBalance.toString(),
      depositCount: deposits.length,
      withdrawalCount: withdrawals.length,
    },
    "On-chain balance query complete"
  );

  return result;
}

/**
 * Compare on-chain balance with GunDB balance
 *
 * @param gun - GunDB instance
 * @param bridgeClient - Bridge client for querying events
 * @param userAddress - User's Ethereum address
 * @param relayPub - Optional relay public key for GunDB balance query
 * @returns Comparison result with discrepancy details
 */
export async function compareBalances(
  gun: IGunInstance,
  bridgeClient: {
    queryDeposits: (fromBlock: number, toBlock: number | "latest", userAddress?: string) => Promise<Array<{ amount: bigint }>>;
    queryWithdrawals: (fromBlock: number, toBlock: number | "latest", userAddress?: string) => Promise<Array<{ amount: bigint }>>;
  },
  userAddress: string,
  relayPub?: string
): Promise<{
  onChain: OnChainBalanceResult;
  gunDb: bigint;
  discrepancy: bigint;
  hasDiscrepancy: boolean;
}> {
  const normalizedUser = userAddress.toLowerCase();

  // Get on-chain balance
  const onChain = await getOnChainUserBalance(bridgeClient, normalizedUser);

  // Get GunDB balance
  const gunDb = await getUserBalance(gun, normalizedUser, relayPub);

  // Calculate discrepancy (positive = on-chain has more, should credit)
  const discrepancy = onChain.netBalance - gunDb;

  if (discrepancy !== 0n) {
    log.warn(
      {
        user: normalizedUser,
        onChainBalance: onChain.netBalance.toString(),
        gunDbBalance: gunDb.toString(),
        discrepancy: discrepancy.toString(),
      },
      "Balance discrepancy detected between on-chain and GunDB"
    );
  }

  return {
    onChain,
    gunDb,
    discrepancy,
    hasDiscrepancy: discrepancy !== 0n,
  };
}

/**
 * Sync missing deposits from on-chain to GunDB
 *
 * This function queries all deposits from the blockchain and ensures
 * each one is properly credited in GunDB. This handles cases where:
 * - A relay was offline when deposits occurred
 * - A deposit event was missed due to network issues
 * - GunDB data was lost or corrupted
 *
 * @param gun - GunDB instance
 * @param bridgeClient - Bridge client for querying events
 * @param relayKeyPair - Relay keypair for signing balance updates
 * @param startBlock - Block to start querying from (default: 0)
 * @returns Sync result with count of synced deposits
 */
export async function syncMissingDeposits(
  gun: IGunInstance,
  bridgeClient: {
    queryDeposits: (fromBlock: number, toBlock: number | "latest", userAddress?: string) => Promise<Array<{
      txHash: string;
      user: string;
      amount: bigint;
      blockNumber: number;
    }>>;
  },
  relayKeyPair: { pub: string; priv: string; epub?: string; epriv?: string },
  startBlock: number = 0
): Promise<{ synced: number; skipped: number; errors: number; details: string[] }> {
  log.info({ startBlock }, "Starting sync of missing deposits from on-chain");

  // Query all deposits from the blockchain
  const deposits = await bridgeClient.queryDeposits(startBlock, "latest");

  let synced = 0;
  let skipped = 0;
  let errors = 0;
  const details: string[] = [];

  for (const deposit of deposits) {
    const normalizedUser = deposit.user.toLowerCase();
    const depositKey = `${deposit.txHash}:${normalizedUser}:${deposit.amount.toString()}`;

    try {
      // Check if already processed
      const alreadyProcessed = await isDepositProcessed(gun, depositKey);

      if (alreadyProcessed) {
        skipped++;
        continue;
      }

      log.info(
        {
          txHash: deposit.txHash,
          user: normalizedUser,
          amount: deposit.amount.toString(),
        },
        "Syncing missing deposit from on-chain"
      );

      // Credit the balance
      await creditBalance(gun, normalizedUser, deposit.amount, relayKeyPair);

      // Mark as processed
      await markDepositProcessed(gun, depositKey, {
        txHash: deposit.txHash,
        user: normalizedUser,
        amount: deposit.amount.toString(),
        blockNumber: deposit.blockNumber,
        timestamp: Date.now(),
      });

      synced++;
      details.push(`Synced: ${deposit.txHash} for ${normalizedUser} amount ${deposit.amount.toString()}`);
    } catch (error) {
      errors++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error({ error: errorMsg, deposit }, "Failed to sync deposit");
      details.push(`Error: ${deposit.txHash} - ${errorMsg}`);
    }
  }

  log.info(
    { synced, skipped, errors, totalDeposits: deposits.length },
    "Completed sync of missing deposits"
  );

  return { synced, skipped, errors, details };
}

/**
 * Reconcile user balance by recalculating from deposits, withdrawals, and L2 transfers
 * This fixes balance discrepancies caused by old transfer implementations
 *
 * SYNCHRONIZATION: Uses distributed lock to prevent multiple relays from reconciling
 * the same user simultaneously, which could lead to balance overwrites.
 *
 * @param gun - GunDB instance
 * @param userAddress - User's Ethereum address to reconcile
 * @param relayKeyPair - Relay keypair for signing corrected balances
 * @param bridgeClient - Bridge client for querying on-chain deposits/withdrawals
 * @returns Reconciliation result with corrected balance
 */
export async function reconcileUserBalance(
  gun: IGunInstance,
  userAddress: string,
  relayKeyPair: { pub: string; priv: string; epub?: string; epriv?: string },
  bridgeClient: any
): Promise<{
  success: boolean;
  currentBalance: string;
  calculatedBalance: string;
  targetBalance?: string; // Target balance (0 if calculated was negative)
  corrected: boolean;
  skipped?: boolean; // True if skipped due to lock held by another relay
  reason?: string; // Reason for skipping
  error?: string;
}> {
  const normalizedAddress = userAddress.toLowerCase();

  // Try to acquire distributed lock to prevent race conditions between relays
  const lockAcquired = await acquireReconciliationLock(gun, normalizedAddress, relayKeyPair.pub);

  if (!lockAcquired) {
    log.debug(
      { user: normalizedAddress, relayPub: relayKeyPair.pub.substring(0, 16) },
      "Skipping reconciliation - lock held by another relay"
    );
    return {
      success: true,
      currentBalance: "0",
      calculatedBalance: "0",
      corrected: false,
      skipped: true,
      reason: "Lock held by another relay",
    };
  }

  try {
    // Get current balance from GunDB (without specifying relayPub to get balance from any trusted relay)
    // This ensures we see the most up-to-date balance across all relays
    const currentBalance = await getUserBalance(gun, normalizedAddress);

    log.debug(
      { user: normalizedAddress, currentBalance: currentBalance.toString() },
      "Starting balance reconciliation (lock acquired)"
    );

    // First, sync any missing deposits from on-chain to GunDB
    // This ensures all on-chain deposits are processed before reconciliation
    // This is critical to avoid discrepancies between bridge contract and L2 balance
    try {
      const syncResult = await syncMissingDeposits(gun, bridgeClient, relayKeyPair, 0);
      if (syncResult.synced > 0) {
        log.info(
          {
            user: normalizedAddress,
            synced: syncResult.synced,
            skipped: syncResult.skipped,
            errors: syncResult.errors,
          },
          "Synced missing deposits before reconciliation"
        );
        // Wait a bit for GunDB to propagate the balance updates
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (syncError) {
      log.warn(
        { error: syncError, user: normalizedAddress },
        "Failed to sync missing deposits before reconciliation, continuing anyway"
      );
    }

    // Use on-chain deposits as source of truth to ensure consistency across all relays
    // This ensures that even if a relay was offline when deposits were processed,
    // it will still see all deposits from the blockchain
    const onChainBalance = await getOnChainUserBalance(bridgeClient, normalizedAddress);
    const totalDeposits: bigint = onChainBalance.totalDeposits;

    // Get processed withdrawals from batches (on-chain withdrawals that have been processed)
    // We use batches instead of queryWithdrawals to only count withdrawals that have been
    // successfully processed and included in a batch
    const allBatches = await getAllBatches(gun);
    let totalWithdrawals: bigint = 0n;
    
    // Sum withdrawals from all batches for this user
    for (const batch of allBatches) {
      if (batch.withdrawals) {
        for (const withdrawal of batch.withdrawals) {
          const withdrawalUser = (withdrawal.user || "").toLowerCase();
          if (withdrawalUser === normalizedAddress) {
            totalWithdrawals = totalWithdrawals + BigInt(withdrawal.amount || "0");
          }
        }
      }
    }

    // Calculate base balance from on-chain deposits - processed withdrawals
    let calculatedBalance: bigint = totalDeposits - totalWithdrawals;

    // Now account for L2 transfers
    // Get all transfers where this user is sender (subtract) or receiver (add)
    // Use all trusted relays to see transfers from all relays, not just this one
    const allTransfers = await listL2Transfers(gun);

    for (const transfer of allTransfers) {
      const from = transfer.from?.toLowerCase();
      const to = transfer.to?.toLowerCase();
      const amount = BigInt(transfer.amount || "0");

      if (from === normalizedAddress) {
        // User sent this amount - subtract
        calculatedBalance = calculatedBalance - amount;
      }
      if (to === normalizedAddress) {
        // User received this amount - add
        calculatedBalance = calculatedBalance + amount;
      }
    }

    log.debug(
      {
        user: normalizedAddress,
        currentBalance: currentBalance.toString(),
        calculatedBalance: calculatedBalance.toString(),
        totalDeposits: totalDeposits.toString(),
        totalWithdrawals: totalWithdrawals.toString(),
        depositCount: onChainBalance.depositCount,
        withdrawalCount: onChainBalance.withdrawalCount,
        transferCount: allTransfers.length,
      },
      "Balance reconciliation calculation complete"
    );

    // Handle negative calculated balance (shouldn't happen, but can occur due to data inconsistencies)
    // If calculated balance is negative, set it to 0 (minimum possible balance)
    const targetBalance = calculatedBalance < 0n ? 0n : calculatedBalance;

    if (calculatedBalance < 0n) {
      log.warn(
        {
          user: normalizedAddress,
          calculatedBalance: calculatedBalance.toString(),
          totalDeposits: totalDeposits.toString(),
          totalWithdrawals: totalWithdrawals.toString(),
        },
        "⚠️  Calculated balance is negative (more withdrawals than deposits). This may indicate missing deposit records. Setting balance to 0."
      );
    }

    // Compare and correct if needed
    const difference = targetBalance - currentBalance;
    const corrected = difference !== 0n;

    if (corrected) {
      log.warn(
        {
          user: normalizedAddress,
          currentBalance: currentBalance.toString(),
          calculatedBalance: calculatedBalance.toString(),
          targetBalance: targetBalance.toString(),
          difference: difference.toString(),
        },
        "Balance discrepancy detected, correcting..."
      );

      if (difference > 0n) {
        // Current balance is too low - set directly to target balance
        // Using creditBalance would add to existing balance, causing double-counting
        const balanceData: any = {
          balance: targetBalance.toString(),
          user: normalizedAddress,
          ethereumAddress: normalizedAddress,
          updatedAt: Date.now(),
          type: "bridge-balance",
          corrected: true,
          reconciliation: true,
        };

        await FrozenData.createFrozenEntry(
          gun,
          balanceData,
          relayKeyPair,
          "bridge-balances",
          normalizedAddress
        );

        log.debug(
          {
            user: normalizedAddress,
            previousBalance: currentBalance.toString(),
            newBalance: targetBalance.toString(),
          },
          "Balance corrected via direct frozen entry (reconciliation - too low)"
        );
      } else if (difference < 0n) {
        // Current balance is too high - need to reduce it
        // If target balance is 0 and current balance is positive, set directly to 0
        // Otherwise, try to debit the difference
        if (targetBalance === 0n && currentBalance > 0n) {
          // Set balance directly to 0 using frozen entry (more reliable than debit when balance might be inconsistent)
          const balanceData: any = {
            balance: "0",
            user: normalizedAddress,
            ethereumAddress: normalizedAddress,
            updatedAt: Date.now(),
            type: "bridge-balance",
            corrected: true,
            reconciliation: true, // Flag to indicate this was a reconciliation correction
          };

          await FrozenData.createFrozenEntry(
            gun,
            balanceData,
            relayKeyPair,
            "bridge-balances",
            normalizedAddress
          );

          log.debug(
            {
              user: normalizedAddress,
              previousBalance: currentBalance.toString(),
              newBalance: "0",
            },
            "Balance set to 0 via direct frozen entry (reconciliation)"
          );
        } else {
          // Normal case: debit the absolute difference
          const debitAmount = difference * -1n; // Convert negative to positive
          try {
            await debitBalance(gun, normalizedAddress, debitAmount, relayKeyPair);
          } catch (error) {
            // If debit fails (e.g., insufficient balance), fall back to direct balance setting
            log.warn(
              {
                user: normalizedAddress,
                error: error instanceof Error ? error.message : String(error),
                debitAmount: debitAmount.toString(),
                currentBalance: currentBalance.toString(),
              },
              "Debit failed during reconciliation, setting balance directly"
            );

            const balanceData: any = {
              balance: targetBalance.toString(),
              user: normalizedAddress,
              ethereumAddress: normalizedAddress,
              updatedAt: Date.now(),
              type: "bridge-balance",
              corrected: true,
              reconciliation: true,
            };

            await FrozenData.createFrozenEntry(
              gun,
              balanceData,
              relayKeyPair,
              "bridge-balances",
              normalizedAddress
            );
          }
        }
      }

      // Verify correction
      await new Promise((resolve) => setTimeout(resolve, 300)); // Wait for GunDB propagation
      const verifiedBalance = await getUserBalance(gun, normalizedAddress, relayKeyPair.pub);
      log.debug(
        {
          user: normalizedAddress,
          expectedBalance: targetBalance.toString(),
          verifiedBalance: verifiedBalance.toString(),
        },
        "Balance correction completed"
      );
    }

    return {
      success: true,
      currentBalance: currentBalance.toString(),
      calculatedBalance: calculatedBalance.toString(),
      targetBalance: targetBalance.toString(), // Include target balance (0 if calculated was negative)
      corrected,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error({ error: errorMsg, user: userAddress }, "Balance reconciliation failed");
    return {
      success: false,
      currentBalance: "0",
      calculatedBalance: "0",
      corrected: false,
      error: errorMsg,
    };
  } finally {
    // Always release the lock, even if reconciliation fails
    await releaseReconciliationLock(gun, normalizedAddress, relayKeyPair.pub);
  }
}

/**
 * List all L2 transfers from frozen entries
 * 
 * @param gun - GunDB instance
 * @param relayPub - Optional: Single relay's public key (backward compatibility).
 *                   If not provided, uses all trusted relays from registry.
 *                   Can also be an array of trusted relay pub keys.
 * @param chainId - Optional: Chain ID for registry lookup (if relayPub not provided)
 */
export async function listL2Transfers(
  gun: IGunInstance,
  relayPub?: string | string[],
  chainId?: number
): Promise<
  Array<{ from: string; to: string; amount: string; transferHash: string; timestamp: number }>
> {
  return new Promise(async (resolve) => {
    const transfers: Array<{
      from: string;
      to: string;
      amount: string;
      transferHash: string;
      timestamp: number;
    }> = [];
    const timeout = setTimeout(() => resolve(transfers), 10000);

    // Determine trusted signers (same logic as getUserBalance)
    let trustedSigners: string | string[];
    if (relayPub) {
      // Backward compatibility: use single relay or provided array
      trustedSigners = Array.isArray(relayPub) ? relayPub : relayPub;
      log.debug(
        { 
          relayPubCount: Array.isArray(relayPub) ? relayPub.length : 1,
          relayPubPreview: Array.isArray(relayPub) 
            ? relayPub.map(p => p.substring(0, 16))
            : relayPub.substring(0, 16)
        },
        "Looking up transfers with specified relay(s)"
      );
    } else {
      // New behavior: use all trusted relays from registry
      const trustedRelays = await getTrustedRelayPubKeys(chainId);
      trustedSigners = trustedRelays;
      log.debug(
        {
          trustedRelaysCount: trustedRelays.length,
          trustedRelays: trustedRelays.map((p) => p.substring(0, 16)),
        },
        "Looking up transfers with trusted relays from registry"
      );
    }

    // Get all transfer entries from the index
    gun
      .get("shogun-index")
      .get("bridge-transfers")
      .map()
      .once(async (index: any, transferHash?: string) => {
        if (!index || !index.latestHash || !transferHash) return;

        try {
          const entry = await FrozenData.readFrozenEntry(
            gun,
            "bridge-transfers",
            index.latestHash,
            trustedSigners
          );

          if (entry && entry.verified && entry.data) {
            const transferData = entry.data as {
              from?: string;
              to?: string;
              amount?: string;
              transferHash?: string;
              timestamp?: number;
              type?: string;
            };

            if (
              transferData.type === "bridge-transfer" &&
              transferData.from &&
              transferData.to &&
              transferData.amount
            ) {
              transfers.push({
                from: transferData.from,
                to: transferData.to,
                amount: transferData.amount,
                transferHash: transferData.transferHash || transferHash,
                timestamp: transferData.timestamp || 0,
              });
            }
          }
        } catch (error) {
          log.warn({ error, transferHash }, "Error reading transfer entry");
        }
      });

    setTimeout(() => {
      clearTimeout(timeout);
      resolve(transfers);
    }, 5000);
  });
}

// ============================================================================
// GLOBAL SUPPLY VALIDATION
// These functions validate that total L2 circulating supply matches contract
// ============================================================================

/**
 * Result from total supply calculation
 */
export interface TotalSupplyResult {
  totalSupply: bigint;
  userCount: number;
  balances: Map<string, bigint>;
}

/**
 * Result from global supply validation
 */
export interface GlobalSupplyValidation {
  l2Supply: bigint;
  l2SupplyEth: string;
  contractBalance: bigint;
  contractBalanceEth: string;
  discrepancy: bigint;
  discrepancyEth: string;
  isHealthy: boolean;
  userCount: number;
  usersWithBalance: Array<{ address: string; balance: string; balanceEth: string }>;
}

/**
 * Get total L2 circulating supply by summing all user balances
 * 
 * @param gun - GunDB instance
 * @param chainId - Optional chain ID for registry lookup
 * @returns Total supply and individual user balances
 */
export async function getTotalL2Supply(
  gun: IGunInstance,
  chainId?: number
): Promise<TotalSupplyResult> {
  return new Promise(async (resolve) => {
    const balances = new Map<string, bigint>();
    const seenAddresses = new Set<string>();
    const timeout = setTimeout(() => {
      log.warn("Timeout in getTotalL2Supply, returning partial results");
      finalize();
    }, 30000);

    log.debug(
      { chainId },
      "Starting total L2 supply calculation"
    );

    // Read all balance indices to find users with balances
    const balancesIndex = gun.get("bridge").get("balances-index");
    let lastUpdateTime = Date.now();

    balancesIndex.map().on(async (index: any, ethereumAddress?: string) => {
      if (!index || !ethereumAddress || seenAddresses.has(ethereumAddress.toLowerCase())) {
        return;
      }

      // Skip metadata keys
      if (ethereumAddress === "_" || ethereumAddress.startsWith("_")) {
        return;
      }

      lastUpdateTime = Date.now();
      const normalizedAddress = ethereumAddress.toLowerCase();
      seenAddresses.add(normalizedAddress);

      try {
        // Get actual balance for this user
        // Don't pass trustedRelays explicitly - getUserBalance will fetch them internally
        const balance = await getUserBalance(gun, normalizedAddress);
        if (balance > 0n) {
          balances.set(normalizedAddress, balance);
          log.debug(
            { user: normalizedAddress, balance: balance.toString() },
            "Found user balance for supply calculation"
          );
        }
      } catch (error) {
        log.warn({ error, user: normalizedAddress }, "Error getting balance for supply calculation");
      }
    });

    const finalize = () => {
      clearTimeout(timeout);
      balancesIndex.map().off();

      // Calculate total
      let totalSupply = 0n;
      for (const balance of balances.values()) {
        totalSupply = totalSupply + balance;
      }

      log.info(
        {
          totalSupply: totalSupply.toString(),
          userCount: balances.size,
        },
        "Total L2 supply calculated"
      );

      resolve({
        totalSupply,
        userCount: balances.size,
        balances,
      });
    };

    // Check for completion at intervals
    const checkAndFinalize = () => {
      const timeSinceLastUpdate = Date.now() - lastUpdateTime;
      if (timeSinceLastUpdate >= 3000) {
        finalize();
      }
    };

    setTimeout(checkAndFinalize, 5000);
    setTimeout(checkAndFinalize, 8000);
    setTimeout(checkAndFinalize, 12000);
    setTimeout(checkAndFinalize, 15000);
  });
}

/**
 * Validate global L2 supply against bridge contract balance
 * 
 * This is a critical health check that ensures:
 * - Total L2 circulating supply <= Contract balance
 * - No money has been created out of thin air
 * 
 * @param gun - GunDB instance
 * @param bridgeClient - Bridge client for querying contract balance
 * @param chainId - Optional chain ID
 * @returns Validation result with discrepancy details
 */
export async function validateGlobalSupply(
  gun: IGunInstance,
  bridgeClient: {
    getBalance: () => Promise<bigint>;
  },
  chainId?: number
): Promise<GlobalSupplyValidation> {
  const { ethers } = await import("ethers");

  log.info("Starting global supply validation");

  // Get total L2 supply
  const supplyResult = await getTotalL2Supply(gun, chainId);

  // Get contract balance
  const contractBalance = await bridgeClient.getBalance();

  // Calculate discrepancy (negative = L2 supply exceeds contract = BAD)
  const discrepancy = contractBalance - supplyResult.totalSupply;
  const isHealthy = discrepancy >= 0n;

  // Prepare user list sorted by balance (highest first)
  const usersWithBalance = Array.from(supplyResult.balances.entries())
    .map(([address, balance]) => ({
      address,
      balance: balance.toString(),
      balanceEth: ethers.formatEther(balance),
    }))
    .sort((a, b) => {
      const balA = BigInt(a.balance);
      const balB = BigInt(b.balance);
      if (balB > balA) return 1;
      if (balB < balA) return -1;
      return 0;
    });

  const result: GlobalSupplyValidation = {
    l2Supply: supplyResult.totalSupply,
    l2SupplyEth: ethers.formatEther(supplyResult.totalSupply),
    contractBalance,
    contractBalanceEth: ethers.formatEther(contractBalance),
    discrepancy,
    discrepancyEth: ethers.formatEther(discrepancy),
    isHealthy,
    userCount: supplyResult.userCount,
    usersWithBalance,
  };

  if (!isHealthy) {
    log.error(
      {
        l2Supply: result.l2SupplyEth,
        contractBalance: result.contractBalanceEth,
        discrepancy: result.discrepancyEth,
        userCount: result.userCount,
      },
      "⚠️  CRITICAL: L2 supply exceeds contract balance! Bridge is insolvent."
    );
  } else {
    log.info(
      {
        l2Supply: result.l2SupplyEth,
        contractBalance: result.contractBalanceEth,
        surplus: result.discrepancyEth,
        userCount: result.userCount,
      },
      "✅ Global supply validation passed"
    );
  }

  return result;
}

/**
 * Fix global supply discrepancy by proportionally reducing user balances
 * 
 * This is a DESTRUCTIVE operation that should only be used when:
 * - L2 supply exceeds contract balance
 * - The root cause has been identified
 * - Admin has approved the correction
 * 
 * Strategy: Reduce all user balances proportionally to match contract balance
 * 
 * @param gun - GunDB instance
 * @param bridgeClient - Bridge client
 * @param relayKeyPair - Relay keypair for signing
 * @param dryRun - If true, only calculate what would happen without making changes
 * @returns Correction result
 */
export async function fixGlobalSupply(
  gun: IGunInstance,
  bridgeClient: { getBalance: () => Promise<bigint> },
  relayKeyPair: { pub: string; priv: string; epub?: string; epriv?: string },
  dryRun: boolean = true
): Promise<{
  success: boolean;
  dryRun: boolean;
  beforeValidation: GlobalSupplyValidation;
  corrections: Array<{
    user: string;
    oldBalance: string;
    newBalance: string;
    reduction: string;
  }>;
  error?: string;
}> {
  const { ethers } = await import("ethers");

  log.info({ dryRun }, "Starting global supply fix");

  // First, validate current state
  const beforeValidation = await validateGlobalSupply(gun, bridgeClient);

  if (beforeValidation.isHealthy) {
    log.info("Supply is healthy, no fix needed");
    return {
      success: true,
      dryRun,
      beforeValidation,
      corrections: [],
    };
  }

  // Calculate correction ratio
  // If L2 supply is 10 ETH but contract only has 8 ETH, ratio = 0.8
  const l2Supply = beforeValidation.l2Supply;
  const contractBalance = beforeValidation.contractBalance;

  if (l2Supply === 0n) {
    return {
      success: false,
      dryRun,
      beforeValidation,
      corrections: [],
      error: "L2 supply is zero, nothing to correct",
    };
  }

  // Calculate the scale factor (using 18 decimal precision)
  const PRECISION = 10n ** 18n;
  const scaleFactor = (contractBalance * PRECISION) / l2Supply;

  log.warn(
    {
      l2Supply: beforeValidation.l2SupplyEth,
      contractBalance: beforeValidation.contractBalanceEth,
      scaleFactor: Number(scaleFactor) / Number(PRECISION),
    },
    "Calculating proportional balance reductions"
  );

  const corrections: Array<{
    user: string;
    oldBalance: string;
    newBalance: string;
    reduction: string;
  }> = [];

  // Get all user balances
  const supplyResult = await getTotalL2Supply(gun);

  for (const [address, oldBalance] of supplyResult.balances) {
    // Calculate new balance proportionally
    const newBalance = (oldBalance * scaleFactor) / PRECISION;
    const reduction = oldBalance - newBalance;

    corrections.push({
      user: address,
      oldBalance: ethers.formatEther(oldBalance),
      newBalance: ethers.formatEther(newBalance),
      reduction: ethers.formatEther(reduction),
    });

    if (!dryRun && reduction > 0n) {
      // Actually apply the correction
      try {
        const balanceData: any = {
          balance: newBalance.toString(),
          user: address,
          ethereumAddress: address,
          updatedAt: Date.now(),
          type: "bridge-balance",
          corrected: true,
          supplyCorrection: true,
          previousBalance: oldBalance.toString(),
        };

        await FrozenData.createFrozenEntry(
          gun,
          balanceData,
          relayKeyPair,
          "bridge-balances",
          address
        );

        log.info(
          {
            user: address,
            oldBalance: ethers.formatEther(oldBalance),
            newBalance: ethers.formatEther(newBalance),
          },
          "Applied balance correction"
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log.error({ error: errorMsg, user: address }, "Failed to apply balance correction");
        return {
          success: false,
          dryRun,
          beforeValidation,
          corrections,
          error: `Failed to correct balance for ${address}: ${errorMsg}`,
        };
      }
    }
  }

  return {
    success: true,
    dryRun,
    beforeValidation,
    corrections,
  };
}

