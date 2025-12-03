/**
 * Relay User Management for GunDB
 * 
 * Creates or logs in the relay's GunDB user account.
 * Subscription data is stored in the relay's user space,
 * ensuring only the relay can modify or delete this data.
 */

let relayUser = null;
let relayPub = null;
let isInitialized = false;
let initPromise = null;

/**
 * Initialize the relay user - creates new user or logs in existing one
 * @param {Gun} gun - GunDB instance
 * @param {string} username - Relay username (from env)
 * @param {string} password - Relay password (from env)
 * @returns {Promise<{user: object, pub: string}>}
 */
export async function initRelayUser(gun, username, password) {
  if (isInitialized && relayUser) {
    return { user: relayUser, pub: relayPub };
  }

  // Prevent multiple simultaneous initializations
  if (initPromise) {
    return initPromise;
  }

  initPromise = new Promise((resolve, reject) => {
    const user = gun.user();

    console.log(`🔐 Initializing relay user: ${username}`);

    // Try to authenticate first
    user.auth(username, password, (ack) => {
      if (ack.err) {
        // User doesn't exist, create it
        console.log(`📝 Relay user not found, creating new user...`);
        
        user.create(username, password, (createAck) => {
          if (createAck.err) {
            // Check if error is "User already created" (race condition)
            if (createAck.err.includes('already') || createAck.err.includes('User')) {
              // Try auth again
              user.auth(username, password, (retryAck) => {
                if (retryAck.err) {
                  console.error(`❌ Failed to authenticate relay user: ${retryAck.err}`);
                  reject(new Error(retryAck.err));
                  return;
                }
                
                relayUser = user;
                relayPub = user.is?.pub;
                isInitialized = true;
                console.log(`✅ Relay user authenticated (retry). Pub: ${relayPub?.substring(0, 20)}...`);
                resolve({ user: relayUser, pub: relayPub });
              });
            } else {
              console.error(`❌ Failed to create relay user: ${createAck.err}`);
              reject(new Error(createAck.err));
            }
            return;
          }

          // User created, now authenticate
          user.auth(username, password, (authAck) => {
            if (authAck.err) {
              console.error(`❌ Failed to authenticate new relay user: ${authAck.err}`);
              reject(new Error(authAck.err));
              return;
            }

            relayUser = user;
            relayPub = user.is?.pub;
            isInitialized = true;
            console.log(`✅ Relay user created and authenticated. Pub: ${relayPub?.substring(0, 20)}...`);
            resolve({ user: relayUser, pub: relayPub });
          });
        });
      } else {
        // Authentication successful
        relayUser = user;
        relayPub = user.is?.pub;
        isInitialized = true;
        console.log(`✅ Relay user authenticated. Pub: ${relayPub?.substring(0, 20)}...`);
        resolve({ user: relayUser, pub: relayPub });
      }
    });
  });

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

