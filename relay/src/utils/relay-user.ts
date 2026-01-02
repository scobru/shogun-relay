/**
 * Relay User Management for GunDB
 *
 * Initializes the relay's GunDB user account with a direct SEA keypair.
 * Subscription data is stored in the relay's user space,
 * ensuring only the relay can modify or delete this data.
 *
 * The relay MUST use a SEA keypair for initialization (no username/password).
 * This prevents "Signature did not match" errors when using frozen data.
 */

import { loggers } from "./logger";
const log = loggers.relayUser;
import { authConfig } from "../config/env-config";
import { GUN_PATHS, getGunNode } from "./gun-paths";

// Module state
let relayUser: GunUser | undefined = undefined;
let relayPub: string | undefined = undefined;
let relayKeyPair: ISEAPair | undefined = undefined;
let isInitialized: boolean = false;
let initPromise: Promise<RelayUserResult> | undefined = undefined;

// Interfaces - Import native Gun types
import type { IGunChain, GunCallbackPut, GunMessagePut } from "gun/types/gun";
import { IGunUserInstance, IGunInstance, ISEAPair, GunCallbackUserAuth } from "gun";

// Type aliases for Gun types
type GunInstance = IGunInstance<any>;
type GunNode = IGunChain<any, any, any, any>;
type GunUser = IGunUserInstance<any, any, any, any>;

// Alias for GunMessagePut (used in callback)
type GunAck = GunMessagePut;

interface RelayUserResult {
  user: GunUser;
  pub: string;
  keyPair: ISEAPair;
}

interface SubscriptionData {
  userAddress?: string;
  updatedAt?: number;
  updatedBy?: string;
  [key: string]: unknown;
}

interface UploadData {
  hash?: string;
  name?: string;
  size?: number;
  sizeMB?: number;
  uploadedAt?: number;
  savedAt?: number;
  userAddress?: string;
  savedBy?: string;
  [key: string]: unknown;
}

interface UploadInfo {
  hash: string;
  name?: string;
  size: number;
  sizeMB: number;
  uploadedAt?: number;
}

/**
 * Initialize relay user with direct SEA keypair (no login needed)
 * @param gun - GunDB instance
 * @param keyPair - SEA keypair object {pub, priv, epub, epriv}
 * @returns Promise with user, pub, and keyPair
 */
async function initRelayUserWithKeyPair(
  gun: GunInstance,
  keyPair: ISEAPair
): Promise<RelayUserResult> {
  if (isInitialized && relayUser && relayKeyPair) {
    return { user: relayUser, pub: relayPub!, keyPair: relayKeyPair };
  }

  log.debug("Initializing relay user with direct SEA keypair...");

  return new Promise((resolve, reject) => {
    const user = gun.user();

    // Authenticate directly with keypair (no username/password needed)
    (user as any).auth(keyPair, (ack: { err?: string; soul?: string; sea?: ISEAPair }) => {
      if (ack.err) {
        log.error({ err: ack.err }, "Failed to authenticate with keypair");
        reject(new Error(ack.err));
        return;
      }

      relayUser = user;
      relayPub = keyPair.pub;
      relayKeyPair = keyPair;
      isInitialized = true;

      // IMPORTANT: Explicitly publish epub to user graph for encrypted chat
      // This ensures other relays can find our encryption key
      if (keyPair.epub) {
        user.get('epub').put(keyPair.epub);
        user.get('pub').put(keyPair.pub);
        log.debug({ pub: relayPub }, "Published epub key for encrypted chat");
      }

      log.debug({ pub: relayPub, pubLength: relayPub?.length }, "Relay user authenticated with keypair");
      resolve({ user: relayUser, pub: relayPub!, keyPair: relayKeyPair });
    });
  });
}

/**
 * Initialize the relay user with a direct SEA keypair (REQUIRED)
 * @param gun - GunDB instance
 * @param keyPair - SEA keypair object {pub, priv, epub, epriv}
 * @returns Promise with user, pub, and keyPair
 */
export async function initRelayUser(gun: GunInstance, keyPair: ISEAPair): Promise<RelayUserResult> {
  if (isInitialized && relayUser) {
    return {
      user: relayUser,
      pub: relayPub!,
      keyPair: relayKeyPair!,
    };
  }

  // Prevent multiple simultaneous initializations
  if (initPromise) {
    return initPromise;
  }

  // Validate keypair
  if (!keyPair || typeof keyPair !== "object") {
    throw new Error(
      "RELAY_SEA_KEYPAIR is required. Please configure a keypair via RELAY_SEA_KEYPAIR or RELAY_SEA_KEYPAIR_PATH environment variable."
    );
  }

  if (!keyPair.pub || !keyPair.priv) {
    throw new Error(
      "Invalid keypair: missing pub or priv fields. Please generate a new keypair using: node scripts/generate-relay-keys.js"
    );
  }

  // Use the existing keypair initialization function
  initPromise = initRelayUserWithKeyPair(gun, keyPair);
  return initPromise;
}

/**
 * Get the relay user instance
 * @returns GunUser or undefined
 */
export function getRelayUser(): GunUser | undefined {
  return relayUser;
}

/**
 * Get the relay user's public key
 * @returns Public key or undefined
 */
export function getRelayPub(): string | undefined {
  return relayPub;
}

/**
 * Get the relay user's SEA keypair
 * @returns SEA keypair or undefined
 */
export function getRelayKeyPair(): ISEAPair | undefined {
  return relayKeyPair;
}

/**
 * Check if relay user is initialized
 * @returns True if initialized
 */
export function isRelayUserInitialized(): boolean {
  return isInitialized && relayUser !== undefined;
}

/**
 * Get the subscriptions node in the relay user's space
 * @returns GunNode or undefined
 */
export function getSubscriptionsNode(): GunNode | undefined {
  if (!relayUser) {
    log.warn("Relay user not initialized, cannot access subscriptions node");
    return undefined;
  }
  return getGunNode(relayUser, GUN_PATHS.X402).get(GUN_PATHS.SUBSCRIPTIONS);
}

/**
 * Get subscription data for a user address
 * Uses robust reading with retry logic and .on() for better sync
 * @param userAddress - The user's wallet address
 * @param options - Optional settings for retry behavior
 * @returns Promise with subscription data or undefined
 */
export async function getSubscription(
  userAddress: string,
  options?: { maxRetries?: number; retryDelayMs?: number; timeoutMs?: number }
): Promise<SubscriptionData | undefined> {
  if (!relayUser) {
    throw new Error("Relay user not initialized");
  }

  const maxRetries = options?.maxRetries ?? 3;
  const retryDelayMs = options?.retryDelayMs ?? 1000;
  const timeoutMs = options?.timeoutMs ?? 10000;

  // Helper function for single read attempt using .on() for better sync
  const attemptRead = (attemptNumber: number): Promise<SubscriptionData | undefined> => {
    return new Promise((resolve) => {
      let resolved = false;
      let subscription: any = null;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          subscription?.off?.(); // Cleanup listener
          log.debug({ userAddress, attempt: attemptNumber }, "Read attempt timed out");
          resolve(undefined);
        }
      }, timeoutMs);

      // Use .on() instead of .once() to get updates as data syncs
      subscription = getGunNode(relayUser!, GUN_PATHS.X402)
        .get(GUN_PATHS.SUBSCRIPTIONS)
        .get(userAddress)
        .on((data: Record<string, any>) => {
          if (resolved) return;

          // Check if we have valid data
          if (data && typeof data === "object") {
            // Filter out Gun metadata
            const cleanData: SubscriptionData = {};
            let hasRealData = false;

            Object.keys(data).forEach((key) => {
              if (!["_", "#", ">", "<"].includes(key)) {
                cleanData[key] = data[key];
                hasRealData = true;
              }
            });

            // Only resolve if we have actual subscription data (not just metadata)
            if (hasRealData && (cleanData.tier || cleanData.expiresAt || cleanData.purchasedAt)) {
              resolved = true;
              clearTimeout(timeout);
              subscription?.off?.(); // Cleanup listener
              log.debug({ userAddress, attempt: attemptNumber }, "Subscription read successfully");
              resolve(cleanData);
            }
          }
        });

      // Also check with .once() for immediate local data
      getGunNode(relayUser!, GUN_PATHS.X402)
        .get(GUN_PATHS.SUBSCRIPTIONS)
        .get(userAddress)
        .once((data: Record<string, any>) => {
          if (resolved) return;

          if (data && typeof data === "object") {
            const cleanData: SubscriptionData = {};
            let hasRealData = false;

            Object.keys(data).forEach((key) => {
              if (!["_", "#", ">", "<"].includes(key)) {
                cleanData[key] = data[key];
                hasRealData = true;
              }
            });

            if (hasRealData && (cleanData.tier || cleanData.expiresAt || cleanData.purchasedAt)) {
              resolved = true;
              clearTimeout(timeout);
              subscription?.off?.();
              log.debug(
                { userAddress, attempt: attemptNumber },
                "Subscription read from local cache"
              );
              resolve(cleanData);
            }
          }
        });
    });
  };

  // Try with retries
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await attemptRead(attempt);

    if (result) {
      return result;
    }

    // If not last attempt, wait before retry
    if (attempt < maxRetries) {
      log.debug(
        { userAddress, attempt, nextRetryMs: retryDelayMs * attempt },
        "Subscription not found, retrying..."
      );
      await new Promise((r) => setTimeout(r, retryDelayMs * attempt)); // Exponential backoff
    }
  }

  log.warn({ userAddress, maxRetries }, "Subscription not found after all retries");
  return undefined;
}

/**
 * Save subscription data for a user address
 * Includes post-save verification to ensure data persistence
 * @param userAddress - The user's wallet address
 * @param subscriptionData - The subscription data to save
 * @param options - Optional settings for save behavior
 * @returns Promise
 */
export async function saveSubscription(
  userAddress: string,
  subscriptionData: SubscriptionData,
  options?: { verifyPersistence?: boolean; maxSaveRetries?: number }
): Promise<void> {
  if (!relayUser) {
    throw new Error("Relay user not initialized");
  }

  const verifyPersistence = options?.verifyPersistence ?? true;
  const maxSaveRetries = options?.maxSaveRetries ?? 3;

  // Clean and serialize data for GunDB
  // GunDB doesn't handle null values well, convert them to undefined
  const cleanedData: Record<string, any> = {};
  for (const [key, value] of Object.entries(subscriptionData)) {
    // Skip internal GunDB keys
    if (["_", "#", ">", "<"].includes(key)) {
      continue;
    }
    // Convert null to undefined (GunDB prefers undefined)
    if (value === null) {
      cleanedData[key] = undefined;
    } else {
      cleanedData[key] = value;
    }
  }

  const dataToSave: SubscriptionData = {
    ...cleanedData,
    userAddress,
    updatedAt: Date.now(),
    updatedBy: relayPub!,
  } as SubscriptionData;

  // Helper function for single save attempt
  const attemptSave = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout saving subscription to GunDB"));
      }, 15000);

      getGunNode(relayUser!, GUN_PATHS.X402)
        .get(GUN_PATHS.SUBSCRIPTIONS)
        .get(userAddress)
        .put(dataToSave as Record<string, any>, (ack: GunAck) => {
          clearTimeout(timeout);
          if (ack && "err" in ack && ack.err) {
            const errorMsg = typeof ack.err === "string" ? ack.err : String(ack.err);
            reject(new Error(errorMsg));
          } else {
            resolve();
          }
        });
    });
  };

  // Try saving with retries
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxSaveRetries; attempt++) {
    try {
      await attemptSave();
      log.debug({ userAddress, attempt }, "Subscription save acknowledged");

      // Verify persistence if enabled
      if (verifyPersistence) {
        // Small delay to allow data to propagate
        await new Promise((r) => setTimeout(r, 200));

        // Read back to verify
        const verified = await getSubscription(userAddress, {
          maxRetries: 2,
          retryDelayMs: 500,
          timeoutMs: 5000,
        });

        if (verified && verified.updatedAt === dataToSave.updatedAt) {
          log.info({ userAddress, attempt }, "Subscription saved and verified");
          return;
        } else if (verified) {
          log.debug(
            { userAddress, attempt, savedAt: dataToSave.updatedAt, verifiedAt: verified.updatedAt },
            "Subscription saved (verification timestamp mismatch, likely concurrent update)"
          );
          return;
        } else {
          log.warn({ userAddress, attempt }, "Subscription save not verified, retrying...");
          lastError = new Error("Save verification failed");
        }
      } else {
        log.debug({ userAddress }, "Subscription saved (no verification)");
        return;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      log.warn({ userAddress, attempt, err: lastError.message }, "Save attempt failed");
    }

    // Wait before retry with exponential backoff
    if (attempt < maxSaveRetries) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }

  log.error(
    { userAddress, err: lastError?.message },
    "Failed to save subscription after all retries"
  );
  throw lastError || new Error("Failed to save subscription");
}

/**
 * Update a specific field in subscription
 * @param userAddress - The user's wallet address
 * @param field - The field to update
 * @param value - The new value
 * @returns Promise
 */
export async function updateSubscriptionField(
  userAddress: string,
  field: string,
  value: unknown
): Promise<void> {
  if (!relayUser) {
    throw new Error("Relay user not initialized");
  }

  return new Promise((resolve, reject) => {
    getGunNode(relayUser!, GUN_PATHS.X402)
      .get(GUN_PATHS.SUBSCRIPTIONS)
      .get(userAddress)
      .get(field)
      .put(value as Record<string, any>, (ack: GunAck) => {
        if ("err" in ack) {
          log.error({ userAddress, field, err: ack.err }, "Error updating subscription field");
          reject(new Error(ack.err));
        } else {
          log.debug({ userAddress, field }, "Subscription field updated");
          resolve();
        }
      });
  });
}

/**
 * Get user uploads node in the relay user's space
 * @param userAddress - The user's wallet address
 * @returns GunNode or undefined
 */
export function getUserUploadsNode(userAddress: string): GunNode | undefined {
  if (!relayUser) {
    log.warn("Relay user not initialized, cannot access uploads node");
    return undefined;
  }
  return getGunNode(relayUser, GUN_PATHS.X402).get(GUN_PATHS.UPLOADS).get(userAddress);
}

/**
 * Save upload record for a user
 * @param userAddress - The user's wallet address
 * @param hash - The IPFS hash
 * @param uploadData - The upload metadata
 * @returns Promise
 */
export async function saveUpload(
  userAddress: string,
  hash: string,
  uploadData: UploadData
): Promise<void> {
  if (!relayUser) {
    throw new Error("Relay user not initialized");
  }

  return new Promise((resolve, reject) => {
    const dataToSave: UploadData = {
      ...uploadData,
      hash,
      userAddress,
      savedAt: Date.now(),
      savedBy: relayPub!,
    };

    getGunNode(relayUser!, GUN_PATHS.X402)
      .get(GUN_PATHS.UPLOADS)
      .get(userAddress)
      .get(hash)
      .put(dataToSave as Record<string, any>, (ack: GunAck) => {
        if ("err" in ack) {
          log.error({ userAddress, hash, err: ack.err }, "Error saving upload");
          reject(new Error(ack.err));
        } else {
          log.debug({ userAddress, hash }, "Upload saved");
          resolve();
        }
      });
  });
}

/**
 * Get all uploads for a user
 * @param userAddress - The user's wallet address
 * @returns Promise with array of uploads
 */
export async function getUserUploads(userAddress: string): Promise<Array<UploadInfo>> {
  if (!relayUser) {
    throw new Error("Relay user not initialized");
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      log.warn({ userAddress }, "Timeout getting uploads");
      resolve([]);
    }, 15000);

    const uploadsNode = getGunNode(relayUser!, GUN_PATHS.X402).get(GUN_PATHS.UPLOADS).get(userAddress);

    uploadsNode.once((parentData: Record<string, any>) => {
      clearTimeout(timeout);

      if (!parentData || typeof parentData !== "object") {
        resolve([]);
        return;
      }

      const hashKeys = Object.keys(parentData).filter((key) => !["_", "#", ">", "<"].includes(key));

      if (hashKeys.length === 0) {
        resolve([]);
        return;
      }

      const uploads: Array<UploadInfo> = [];
      let completedReads = 0;
      const totalReads = hashKeys.length;

      hashKeys.forEach((hash) => {
        uploadsNode.get(hash).once((uploadData: UploadData) => {
          completedReads++;

          if (uploadData && uploadData.hash) {
            uploads.push({
              hash: uploadData.hash,
              name: uploadData.name,
              size: uploadData.size || 0,
              sizeMB: uploadData.sizeMB || 0,
              uploadedAt: uploadData.uploadedAt || uploadData.savedAt,
            });
          }

          if (completedReads === totalReads) {
            resolve(uploads);
          }
        });
      });
    });
  });
}

/**
 * Delete an upload record
 * @param userAddress - The user's wallet address
 * @param hash - The IPFS hash to delete
 * @returns Promise
 */
export async function deleteUpload(userAddress: string, hash: string): Promise<void> {
  if (!relayUser) {
    throw new Error("Relay user not initialized");
  }

  return new Promise((resolve, reject) => {
    getGunNode(relayUser!, GUN_PATHS.X402)
      .get(GUN_PATHS.UPLOADS)
      .get(userAddress)
      .get(hash)
      .put(null, (ack: GunAck) => {
        if ("err" in ack) {
          log.error({ userAddress, hash, err: ack.err }, "Error deleting upload");
          reject(new Error(ack.err));
        } else {
          log.debug({ userAddress, hash }, "Upload deleted");
          resolve();
        }
      });
  });
}

/**
 * Get all subscriptions
 * Uses robust reading with .on() for better sync and longer timeout
 * @returns Promise with array of subscriptions
 */
export async function getAllSubscriptions(): Promise<Array<SubscriptionData>> {
  if (!relayUser) {
    throw new Error("Relay user not initialized");
  }

  return new Promise((resolve) => {
    const subscriptions: Array<SubscriptionData> = [];
    const processedAddresses = new Set<string>();
    let parentListener: any = null;
    let resolved = false;
    
    // Increased timeout to 15 seconds for better sync
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        parentListener?.off?.();
        log.debug({ count: subscriptions.length }, "getAllSubscriptions timeout reached");
        resolve(subscriptions);
      }
    }, 15000);

    const subscriptionsNode = getGunNode(relayUser!, GUN_PATHS.X402).get(GUN_PATHS.SUBSCRIPTIONS);

    // Use .on() for better sync, then switch to .once() for each subscription
    parentListener = subscriptionsNode.on((parentData: Record<string, any>) => {
      if (resolved) return;
      
      if (!parentData || typeof parentData !== "object") {
        return; // Wait for more data
      }

      const userKeys = Object.keys(parentData).filter((key) => 
        !["_", "#", ">", "<"].includes(key) && !processedAddresses.has(key)
      );

      if (userKeys.length === 0 && processedAddresses.size === 0) {
        // No subscriptions found, but wait a bit more in case data is syncing
        return;
      }

      // Process new user keys
      userKeys.forEach((userAddress) => {
        processedAddresses.add(userAddress);
        
        subscriptionsNode.get(userAddress).once((subData: SubscriptionData) => {
          if (resolved) return;
          
          if (subData && typeof subData === "object") {
            const cleanData: SubscriptionData = {};
            let hasValidData = false;
            
            Object.keys(subData).forEach((key) => {
              if (!["_", "#", ">", "<"].includes(key)) {
                // @ts-ignore
                cleanData[key] = subData[key];
                // Check for essential subscription fields
                if (key === "tier" || key === "expiresAt" || key === "purchasedAt") {
                  hasValidData = true;
                }
              }
            });
            
            // Only add if we have valid subscription data
            if (hasValidData) {
              // Avoid duplicates
              const exists = subscriptions.some(s => s.userAddress === cleanData.userAddress);
              if (!exists) {
                subscriptions.push(cleanData);
                log.debug({ userAddress, tier: cleanData.tier }, "Found subscription");
              }
            }
          }
        });
      });
    });

    // Also try .once() for immediate local data
    subscriptionsNode.once((parentData: Record<string, any>) => {
      if (resolved) return;
      
      if (!parentData || typeof parentData !== "object") {
        return;
      }

      const userKeys = Object.keys(parentData).filter((key) => 
        !["_", "#", ">", "<"].includes(key)
      );

      if (userKeys.length === 0) {
        // If no subscriptions and nothing from .on() after 2 seconds, resolve empty
        setTimeout(() => {
          if (!resolved && subscriptions.length === 0) {
            resolved = true;
            clearTimeout(timeout);
            parentListener?.off?.();
            resolve([]);
          }
        }, 2000);
        return;
      }

      let completedReads = 0;
      const totalReads = userKeys.length;

      userKeys.forEach((userAddress) => {
        subscriptionsNode.get(userAddress).once((subData: SubscriptionData) => {
          if (resolved) return;
          completedReads++;

          if (subData && typeof subData === "object") {
            const cleanData: SubscriptionData = {};
            let hasValidData = false;
            
            Object.keys(subData).forEach((key) => {
              if (!["_", "#", ">", "<"].includes(key)) {
                // @ts-ignore
                cleanData[key] = subData[key];
                if (key === "tier" || key === "expiresAt" || key === "purchasedAt") {
                  hasValidData = true;
                }
              }
            });
            
            if (hasValidData) {
              const exists = subscriptions.some(s => s.userAddress === cleanData.userAddress);
              if (!exists) {
                subscriptions.push(cleanData);
              }
            }
          }

          if (completedReads === totalReads) {
            // Give a small delay for .on() to potentially add more subscriptions
            setTimeout(() => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                parentListener?.off?.();
                log.debug({ count: subscriptions.length }, "getAllSubscriptions completed");
                resolve(subscriptions);
              }
            }, 500);
          }
        });
      });
    });
  });
}

/**
 * Middleware to require admin authentication
 */
export const adminAuthMiddleware = (req: any, res: any, next: any) => {
  const authHeader = req.headers["authorization"];
  const bearerToken = authHeader && authHeader.split(" ")[1];
  const customToken = req.headers["token"];
  const token = bearerToken || customToken;

  if (!token) {
    return res.status(401).json({ success: false, error: "Unauthorized - Token required" });
  }

  if (token === authConfig.adminPassword) {
    next();
  } else {
    return res.status(401).json({ success: false, error: "Unauthorized - Invalid token" });
  }
};

export default {
  initRelayUser,
  getRelayUser,
  getRelayPub,
  isRelayUserInitialized,
  getSubscriptionsNode,
  getSubscription,
  saveSubscription,
  updateSubscriptionField,
  getUserUploadsNode,
  saveUpload,
  getUserUploads,
  deleteUpload,
  getAllSubscriptions,
};
