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

let relayUser = null;
let relayPub = null;
let relayKeyPair = null;
let isInitialized = false;
let initPromise = null;

/**
 * Initialize relay user with direct SEA keypair (no login needed)
 * @param {Gun} gun - GunDB instance
 * @param {object} keyPair - SEA keypair object {pub, priv, epub, epriv}
 * @returns {Promise<{user: object, pub: string, keyPair: object}>}
 */
async function initRelayUserWithKeyPair(gun, keyPair) {
  if (isInitialized && relayUser && relayKeyPair) {
    return { user: relayUser, pub: relayPub, keyPair: relayKeyPair };
  }

  console.log('🔐 Initializing relay user with direct SEA keypair...');

  return new Promise((resolve, reject) => {
    const user = gun.user();

    // Authenticate directly with keypair (no username/password needed)
    user.auth(keyPair, (ack) => {
      if (ack && ack.err) {
        console.error(`❌ Failed to authenticate with keypair: ${ack.err}`);
        reject(new Error(ack.err));
        return;
      }

      relayUser = user;
      relayPub = keyPair.pub;
      relayKeyPair = keyPair;
      isInitialized = true;
      
      console.log(`✅ Relay user authenticated with keypair. Pub: ${relayPub?.substring(0, 30)}...`);
      resolve({ user: relayUser, pub: relayPub, keyPair: relayKeyPair });
    });
  });
}

/**
 * Initialize the relay user with a direct SEA keypair (REQUIRED)
 * @param {Gun} gun - GunDB instance
 * @param {object} keyPair - SEA keypair object {pub, priv, epub, epriv}
 * @returns {Promise<{user: object, pub: string, keyPair: object}>}
 */
export async function initRelayUser(gun, keyPair) {
  if (isInitialized && relayUser) {
    return { 
      user: relayUser, 
      pub: relayPub, 
      keyPair: relayKeyPair 
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
 * @returns {object|null}
 */
export function getRelayUser() {
  return relayUser;
}

/**
 * Get the relay user's public key
 * @returns {string|null}
 */
export function getRelayPub() {
  return relayPub;
}

/**
 * Get the relay user's SEA keypair
 * @returns {object|null}
 */
export function getRelayKeyPair() {
  return relayKeyPair;
}

/**
 * Check if relay user is initialized
 * @returns {boolean}
 */
export function isRelayUserInitialized() {
  return isInitialized && relayUser !== null;
}

/**
 * Get the subscriptions node in the relay user's space
 * @returns {object|null}
 */
export function getSubscriptionsNode() {
  if (!relayUser) {
    console.warn('⚠️ Relay user not initialized, cannot access subscriptions node');
    return null;
  }
  return relayUser.get('x402').get('subscriptions');
}

/**
 * Get subscription data for a user address
 * @param {string} userAddress - The user's wallet address
 * @returns {Promise<object|null>}
 */
export async function getSubscription(userAddress) {
  if (!relayUser) {
    throw new Error('Relay user not initialized');
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log(`⏰ Timeout reading subscription for ${userAddress}`);
      resolve(null);
    }, 10000);

    relayUser.get('x402').get('subscriptions').get(userAddress).once((data) => {
      clearTimeout(timeout);
      
      if (!data || typeof data !== 'object') {
        resolve(null);
        return;
      }

      // Filter out Gun metadata
      const cleanData = {};
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
 * @param {string} userAddress - The user's wallet address
 * @param {object} subscriptionData - The subscription data to save
 * @returns {Promise<void>}
 */
export async function saveSubscription(userAddress, subscriptionData) {
  if (!relayUser) {
    throw new Error('Relay user not initialized');
  }

  return new Promise((resolve, reject) => {
    const dataToSave = {
      ...subscriptionData,
      userAddress,
      updatedAt: Date.now(),
      updatedBy: relayPub,
    };

    relayUser.get('x402').get('subscriptions').get(userAddress).put(dataToSave, (ack) => {
      if (ack && ack.err) {
        console.error(`❌ Error saving subscription for ${userAddress}:`, ack.err);
        reject(new Error(ack.err));
      } else {
        console.log(`💾 Subscription saved for ${userAddress}`);
        resolve();
      }
    });
  });
}

/**
 * Update a specific field in subscription
 * @param {string} userAddress - The user's wallet address
 * @param {string} field - The field to update
 * @param {any} value - The new value
 * @returns {Promise<void>}
 */
export async function updateSubscriptionField(userAddress, field, value) {
  if (!relayUser) {
    throw new Error('Relay user not initialized');
  }

  return new Promise((resolve, reject) => {
    relayUser.get('x402').get('subscriptions').get(userAddress).get(field).put(value, (ack) => {
      if (ack && ack.err) {
        console.error(`❌ Error updating ${field} for ${userAddress}:`, ack.err);
        reject(new Error(ack.err));
      } else {
        console.log(`💾 Updated ${field} for ${userAddress}`);
        resolve();
      }
    });
  });
}

/**
 * Get user uploads node in the relay user's space
 * @param {string} userAddress - The user's wallet address
 * @returns {object|null}
 */
export function getUserUploadsNode(userAddress) {
  if (!relayUser) {
    console.warn('⚠️ Relay user not initialized, cannot access uploads node');
    return null;
  }
  return relayUser.get('x402').get('uploads').get(userAddress);
}

/**
 * Save upload record for a user
 * @param {string} userAddress - The user's wallet address
 * @param {string} hash - The IPFS hash
 * @param {object} uploadData - The upload metadata
 * @returns {Promise<void>}
 */
export async function saveUpload(userAddress, hash, uploadData) {
  if (!relayUser) {
    throw new Error('Relay user not initialized');
  }

  return new Promise((resolve, reject) => {
    const dataToSave = {
      ...uploadData,
      hash,
      userAddress,
      savedAt: Date.now(),
      savedBy: relayPub,
    };

    relayUser.get('x402').get('uploads').get(userAddress).get(hash).put(dataToSave, (ack) => {
      if (ack && ack.err) {
        console.error(`❌ Error saving upload ${hash} for ${userAddress}:`, ack.err);
        reject(new Error(ack.err));
      } else {
        console.log(`💾 Upload ${hash} saved for ${userAddress}`);
        resolve();
      }
    });
  });
}

/**
 * Get all uploads for a user
 * @param {string} userAddress - The user's wallet address
 * @returns {Promise<Array>}
 */
export async function getUserUploads(userAddress) {
  if (!relayUser) {
    throw new Error('Relay user not initialized');
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log(`⏰ Timeout getting uploads for ${userAddress}`);
      resolve([]);
    }, 15000);

    const uploadsNode = relayUser.get('x402').get('uploads').get(userAddress);

    uploadsNode.once((parentData) => {
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

      const uploads = [];
      let completedReads = 0;
      const totalReads = hashKeys.length;

      hashKeys.forEach((hash) => {
        uploadsNode.get(hash).once((uploadData) => {
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
 * @param {string} userAddress - The user's wallet address
 * @param {string} hash - The IPFS hash to delete
 * @returns {Promise<void>}
 */
export async function deleteUpload(userAddress, hash) {
  if (!relayUser) {
    throw new Error('Relay user not initialized');
  }

  return new Promise((resolve, reject) => {
    relayUser.get('x402').get('uploads').get(userAddress).get(hash).put(null, (ack) => {
      if (ack && ack.err) {
        console.error(`❌ Error deleting upload ${hash} for ${userAddress}:`, ack.err);
        reject(new Error(ack.err));
      } else {
        console.log(`🗑️ Upload ${hash} deleted for ${userAddress}`);
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

