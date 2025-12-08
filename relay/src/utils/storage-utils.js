/**
 * Storage Utilities - Centralized helpers for storage tracking
 * 
 * Provides centralized functions for updating storage statistics
 * to ensure consistency across the relay.
 */

/**
 * Update MB usage for a user (legacy system)
 * This is the legacy tracking system for general uploads.
 * For x402 subscriptions, use X402Merchant.updateStorageUsage() instead.
 * 
 * @param {object} gun - GunDB instance
 * @param {string} userAddress - User address
 * @param {number} deltaMB - Change in MB (positive for add, negative for subtract)
 * @returns {Promise<number>} - New MB usage
 */
export async function updateMBUsage(gun, userAddress, deltaMB) {
  if (!gun) {
    throw new Error('Gun instance is required');
  }
  
  if (!userAddress) {
    throw new Error('User address is required');
  }
  
  return new Promise((resolve, reject) => {
    const mbUsageNode = gun.get("shogun").get("mbUsage").get(userAddress);
    
    mbUsageNode.once((currentData) => {
      const currentMB = currentData ? (currentData.mbUsed || 0) : 0;
      const newMB = Math.max(0, currentMB + deltaMB);
      
      const updateData = {
        mbUsed: newMB,
        lastUpdated: Date.now(),
        userAddress: userAddress,
        updatedBy: "storage-utils"
      };
      
      mbUsageNode.put(updateData, (ack) => {
        if (ack && ack.err) {
          reject(new Error(ack.err));
        } else {
          resolve(newMB);
        }
      });
    });
  });
}

/**
 * Get MB usage for a user (legacy system)
 * 
 * @param {object} gun - GunDB instance
 * @param {string} userAddress - User address
 * @returns {Promise<number>} - Current MB usage
 */
export async function getMBUsage(gun, userAddress) {
  if (!gun) {
    throw new Error('Gun instance is required');
  }
  
  if (!userAddress) {
    throw new Error('User address is required');
  }
  
  return new Promise((resolve) => {
    const mbUsageNode = gun.get("shogun").get("mbUsage").get(userAddress);
    
    mbUsageNode.once((currentData) => {
      const currentMB = currentData ? (currentData.mbUsed || 0) : 0;
      resolve(currentMB);
    });
  });
}


