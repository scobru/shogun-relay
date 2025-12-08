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

import { loggers } from './logger';
const log = loggers.relayUser;

// Module state
let relayUser: mb<GunUser> = undefined;
let relayPub: mb<str> = undefined;
let relayKeyPair: mb<ISEAPair> = undefined;
let isInitialized: bool = false;
let initPromise: mb<prm<RelayUserResult>> = undefined;

// Interfaces - Import native Gun types
import type { IGunChain, GunCallbackPut, GunMessagePut } from 'gun/types/gun';
import { IGunUserInstance, IGunInstance, ISEAPair, GunCallbackUserAuth } from 'gun';

// Type aliases for Gun types
type GunInstance = IGunInstance<any>;
type GunNode = IGunChain<any, any, any, any>;
type GunUser = IGunUserInstance<any, any, any, any>;

// Alias for GunMessagePut (used in callback)
type GunAck = GunMessagePut;


interface RelayUserResult {
  user: GunUser;
  pub: str;
  keyPair: ISEAPair;
}

interface SubscriptionData {
  userAddress?: str;
  updatedAt?: num;
  updatedBy?: str;
  [key: str]: unknown;
}

interface UploadData {
  hash?: str;
  name?: str;
  size?: num;
  sizeMB?: num;
  uploadedAt?: num;
  savedAt?: num;
  userAddress?: str;
  savedBy?: str;
  [key: str]: unknown;
}

interface UploadInfo {
  hash: str;
  name?: str;
  size: num;
  sizeMB: num;
  uploadedAt?: num;
}

/**
 * Initialize relay user with direct SEA keypair (no login needed)
 * @param gun - GunDB instance
 * @param keyPair - SEA keypair object {pub, priv, epub, epriv}
 * @returns Promise with user, pub, and keyPair
 */
async function initRelayUserWithKeyPair(gun: GunInstance, keyPair: ISEAPair): prm<RelayUserResult> {
  if (isInitialized && relayUser && relayKeyPair) {
    return { user: relayUser, pub: relayPub!, keyPair: relayKeyPair };
  }

  log.info('Initializing relay user with direct SEA keypair...');

  return new Promise((resolve, reject) => {
    const user = gun.user();

    // Authenticate directly with keypair (no username/password needed)
    (user as any).auth(keyPair, (ack: { err?: string; soul?: string; sea?: ISEAPair }) => {
      if (ack.err) {
        log.error({ err: ack.err }, 'Failed to authenticate with keypair');
        reject(new Error(ack.err));
        return;
      }

      relayUser = user;
      relayPub = keyPair.pub;
      relayKeyPair = keyPair;
      isInitialized = true;

      log.info({ pub: relayPub?.substring(0, 30) }, 'Relay user authenticated with keypair');
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
export async function initRelayUser(gun: GunInstance, keyPair: ISEAPair): prm<RelayUserResult> {
  if (isInitialized && relayUser) {
    return {
      user: relayUser,
      pub: relayPub!,
      keyPair: relayKeyPair!
    };
  }

  // Prevent multiple simultaneous initializations
  if (initPromise) {
    return initPromise;
  }

  // Validate keypair
  if (!keyPair || typeof keyPair !== 'object') {
    throw new Error('RELAY_SEA_KEYPAIR is required. Please configure a keypair via RELAY_SEA_KEYPAIR or RELAY_SEA_KEYPAIR_PATH environment variable.');
  }

  if (!keyPair.pub || !keyPair.priv) {
    throw new Error('Invalid keypair: missing pub or priv fields. Please generate a new keypair using: node scripts/generate-relay-keys.js');
  }

  // Use the existing keypair initialization function
  initPromise = initRelayUserWithKeyPair(gun, keyPair);
  return initPromise;
}

/**
 * Get the relay user instance
 * @returns GunUser or undefined
 */
export function getRelayUser(): mb<GunUser> {
  return relayUser;
}

/**
 * Get the relay user's public key
 * @returns Public key or undefined
 */
export function getRelayPub(): mb<str> {
  return relayPub;
}

/**
 * Get the relay user's SEA keypair
 * @returns SEA keypair or undefined
 */
export function getRelayKeyPair(): mb<ISEAPair> {
  return relayKeyPair;
}

/**
 * Check if relay user is initialized
 * @returns True if initialized
 */
export function isRelayUserInitialized(): bool {
  return isInitialized && relayUser !== undefined;
}

/**
 * Get the subscriptions node in the relay user's space
 * @returns GunNode or undefined
 */
export function getSubscriptionsNode(): mb<GunNode> {
  if (!relayUser) {
    log.warn('Relay user not initialized, cannot access subscriptions node');
    return undefined;
  }
  return relayUser.get('x402').get('subscriptions');
}

/**
 * Get subscription data for a user address
 * @param userAddress - The user's wallet address
 * @returns Promise with subscription data or undefined
 */
export async function getSubscription(userAddress: str): prm<mb<SubscriptionData>> {
  if (!relayUser) {
    throw new Error('Relay user not initialized');
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      log.debug({ userAddress }, 'Timeout reading subscription');
      resolve(undefined);
    }, 10000);

    relayUser!.get('x402').get('subscriptions').get(userAddress).once((data: mb<obj>) => {
      clearTimeout(timeout);

      if (!data || typeof data !== 'object') {
        resolve(undefined);
        return;
      }

      // Filter out Gun metadata
      const cleanData: SubscriptionData = {};
      Object.keys(data).forEach(key => {
        if (!['_', '#', '>', '<'].includes(key)) {
          cleanData[key] = data[key];
        }
      });

      resolve(cleanData);
    });
  });
}

/**
 * Save subscription data for a user address
 * @param userAddress - The user's wallet address
 * @param subscriptionData - The subscription data to save
 * @returns Promise
 */
export async function saveSubscription(userAddress: str, subscriptionData: SubscriptionData): prm<void> {
  if (!relayUser) {
    throw new Error('Relay user not initialized');
  }

  return new Promise((resolve, reject) => {
    // Clean and serialize data for GunDB
    // GunDB doesn't handle null values well, convert them to undefined
    const cleanedData: obj = {};
    for (const [key, value] of Object.entries(subscriptionData)) {
      // Skip internal GunDB keys
      if (['_', '#', '>', '<'].includes(key)) {
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

    // Add timeout to prevent hanging
    const timeout = setTimeout(() => {
      reject(new Error('Timeout saving subscription to GunDB'));
    }, 10000);

    relayUser?.get('x402').get('subscriptions').get(userAddress).put(dataToSave as obj, (ack: GunAck) => {
      clearTimeout(timeout);
      if (ack && 'err' in ack && ack.err) {
        const errorMsg = typeof ack.err === 'string' ? ack.err : String(ack.err);
        log.error({ userAddress, err: errorMsg, data: dataToSave }, 'Error saving subscription');
        reject(new Error(errorMsg));
      } else {
        log.info({ userAddress }, 'Subscription saved');
        resolve();
      }
    });
  });
}

/**
 * Update a specific field in subscription
 * @param userAddress - The user's wallet address
 * @param field - The field to update
 * @param value - The new value
 * @returns Promise
 */
export async function updateSubscriptionField(userAddress: str, field: str, value: unknown): prm<void> {
  if (!relayUser) {
    throw new Error('Relay user not initialized');
  }

  return new Promise((resolve, reject) => {
    relayUser!.get('x402').get('subscriptions').get(userAddress).get(field).put(value as obj, (ack: GunAck) => {
      if ('err' in ack) {
        log.error({ userAddress, field, err: ack.err }, 'Error updating subscription field');
        reject(new Error(ack.err));
      } else {
        log.info({ userAddress, field }, 'Subscription field updated');
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
export function getUserUploadsNode(userAddress: str): mb<GunNode> {
  if (!relayUser) {
    log.warn('Relay user not initialized, cannot access uploads node');
    return undefined;
  }
  return relayUser.get('x402').get('uploads').get(userAddress);
}

/**
 * Save upload record for a user
 * @param userAddress - The user's wallet address
 * @param hash - The IPFS hash
 * @param uploadData - The upload metadata
 * @returns Promise
 */
export async function saveUpload(userAddress: str, hash: str, uploadData: UploadData): prm<void> {
  if (!relayUser) {
    throw new Error('Relay user not initialized');
  }

  return new Promise((resolve, reject) => {
    const dataToSave: UploadData = {
      ...uploadData,
      hash,
      userAddress,
      savedAt: Date.now(),
      savedBy: relayPub!,
    };

    relayUser!.get('x402').get('uploads').get(userAddress).get(hash).put(dataToSave as obj, (ack: GunAck) => {
      if ('err' in ack) {
        log.error({ userAddress, hash, err: ack.err }, 'Error saving upload');
        reject(new Error(ack.err));
      } else {
        log.info({ userAddress, hash }, 'Upload saved');
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
export async function getUserUploads(userAddress: str): prm<arr<UploadInfo>> {
  if (!relayUser) {
    throw new Error('Relay user not initialized');
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      log.warn({ userAddress }, 'Timeout getting uploads');
      resolve([]);
    }, 15000);

    const uploadsNode = relayUser!.get('x402').get('uploads').get(userAddress);

    uploadsNode.once((parentData: mb<obj>) => {
      clearTimeout(timeout);

      if (!parentData || typeof parentData !== 'object') {
        resolve([]);
        return;
      }

      const hashKeys = Object.keys(parentData).filter(
        (key) => !['_', '#', '>', '<'].includes(key)
      );

      if (hashKeys.length === 0) {
        resolve([]);
        return;
      }

      const uploads: arr<UploadInfo> = [];
      let completedReads = 0;
      const totalReads = hashKeys.length;

      hashKeys.forEach((hash) => {
        uploadsNode.get(hash).once((uploadData: mb<UploadData>) => {
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
export async function deleteUpload(userAddress: str, hash: str): prm<void> {
  if (!relayUser) {
    throw new Error('Relay user not initialized');
  }

  return new Promise((resolve, reject) => {
    relayUser!.get('x402').get('uploads').get(userAddress).get(hash).put(null, (ack: GunAck) => {
      if ('err' in ack) {
        log.error({ userAddress, hash, err: ack.err }, 'Error deleting upload');
        reject(new Error(ack.err));
      } else {
        log.info({ userAddress, hash }, 'Upload deleted');
        resolve();
      }
    });
  });
}

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
};
