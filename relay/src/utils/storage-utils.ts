/**
 * Storage Utilities - Centralized helpers for storage tracking
 *
 * Provides centralized functions for updating storage statistics
 * to ensure consistency across the relay.
 */

interface GunInstance {
  get: (path: string) => GunNode;
}

interface GunNode {
  get: (path: string) => GunNode;
  once: (cb: (data: MBUsageData) => void) => void;
  put: (data: Record<string, any>, cb?: (ack: GunAck) => void) => void;
}

interface MBUsageData {
  mbUsed: number;
  lastUpdated?: number;
  userAddress?: string;
  updatedBy?: string;
}

interface GunAck {
  err?: string;
  ok?: boolean;
}

/**
 * Update MB usage for a user (legacy system)
 * This is the legacy tracking system for general uploads.
 * For x402 subscriptions, use X402Merchant.updateStorageUsage() instead.
 *
 * @param gun - GunDB instance
 * @param userAddress - User address
 * @param deltaMB - Change in MB (positive for add, negative for subtract)
 * @returns New MB usage
 */
export async function updateMBUsage(
  gun: GunInstance,
  userAddress: string,
  deltaMB: number
): Promise<number> {
  if (!gun) {
    throw new Error("Gun instance is required");
  }

  if (!userAddress) {
    throw new Error("User address is required");
  }

  return new Promise((resolve, reject) => {
    const mbUsageNode = gun.get("shogun").get("mbUsage").get(userAddress);

    mbUsageNode.once((currentData: MBUsageData) => {
      const currentMB = currentData ? currentData.mbUsed || 0 : 0;
      const newMB = Math.max(0, currentMB + deltaMB);

      const updateData: MBUsageData = {
        mbUsed: newMB,
        lastUpdated: Date.now(),
        userAddress: userAddress,
        updatedBy: "storage-utils",
      };

      mbUsageNode.put(updateData, (ack: GunAck) => {
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
 * @param gun - GunDB instance
 * @param userAddress - User address
 * @returns Current MB usage
 */
export async function getMBUsage(gun: GunInstance, userAddress: string): Promise<number> {
  if (!gun) {
    throw new Error("Gun instance is required");
  }

  if (!userAddress) {
    throw new Error("User address is required");
  }

  return new Promise((resolve) => {
    const mbUsageNode = gun.get("shogun").get("mbUsage").get(userAddress);

    mbUsageNode.once((currentData: MBUsageData) => {
      const currentMB = currentData ? currentData.mbUsed || 0 : 0;
      resolve(currentMB);
    });
  });
}
