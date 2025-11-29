/**
 * Subscription Manager using GunDB
 * Stores subscriptions in the authenticated user's graph
 */

let gunInstance = null;

export const subscriptionManager = {
  /**
   * Initialize with Gun instance
   * @param {object} gun - Gun instance
   */
  init: (gun) => {
    gunInstance = gun;
    console.log("✅ SubscriptionManager initialized with GunDB");
  },

  /**
   * Add or extend a subscription for a CID
   * @param {string} cid - The IPFS Content ID
   * @param {number} durationSeconds - Duration in seconds
   * @param {string} owner - Owner identifier (e.g., wallet address)
   */
  addSubscription: async (cid, durationSeconds, owner) => {
    if (!gunInstance) throw new Error("SubscriptionManager not initialized");
    
    // Use the authenticated user's graph
    const user = gunInstance.user();
    if (!user.is) {
      console.warn("⚠️ Relay user not authenticated, saving to public graph fallback");
    }
    
    const now = Date.now();
    const subscriptions = user.is ? user.get('subscriptions') : gunInstance.get('subscriptions');
    
    return new Promise((resolve) => {
      subscriptions.get(cid).once((existing) => {
        const currentExpiry = existing?.expiresAt || now;
        const startTime = currentExpiry > now ? currentExpiry : now;
        const expiresAt = startTime + (durationSeconds * 1000);
        
        const subData = {
          cid,
          expiresAt,
          owner,
          updatedAt: now,
          active: true
        };
        
        subscriptions.get(cid).put(subData, (ack) => {
          if (ack.err) console.error("Error saving subscription:", ack.err);
          resolve(subData);
        });
      });
    });
  },

  /**
   * Check if a subscription is active
   * @param {string} cid 
   * @returns {Promise<object|null>} Subscription details
   */
  checkSubscription: async (cid) => {
    if (!gunInstance) throw new Error("SubscriptionManager not initialized");
    
    const user = gunInstance.user();
    const subscriptions = user.is ? user.get('subscriptions') : gunInstance.get('subscriptions');

    return new Promise((resolve) => {
      subscriptions.get(cid).once((sub) => {
        if (!sub || !sub.cid) { // Check for valid data
          resolve(null);
          return;
        }
        
        if (sub.expiresAt < Date.now()) {
          resolve({ ...sub, active: false, status: 'expired' });
        } else {
          resolve({ ...sub, active: true, status: 'active' });
        }
      });
    });
  },

  /**
   * Remove expired subscriptions (mark as inactive)
   */
  pruneExpired: () => {
    if (!gunInstance) return;
    
    const user = gunInstance.user();
    const subscriptions = user.is ? user.get('subscriptions') : gunInstance.get('subscriptions');
    const now = Date.now();

    // Map over subscriptions (Note: Gun map() can be heavy on large datasets)
    subscriptions.map().once((sub, cid) => {
      if (sub && sub.expiresAt < now && sub.active) {
        console.log(`Subscription expired for ${cid}`);
        subscriptions.get(cid).put({ active: false });
      }
    });
  }
};
