/**
 * Storage Deals Utility for Shogun Relay
 * 
 * Provides per-file storage contracts as an alternative/complement to subscriptions.
 * Deals are stored in frozen (immutable, signed) space in GunDB.
 * 
 * Features:
 * - Per-file pricing and duration
 * - Erasure coding integration
 * - Multi-relay replication tracking
 * - Deal lifecycle management
 */

import crypto from 'crypto';
import * as FrozenData from './frozen-data.js';
import * as ErasureCoding from './erasure-coding.js';

// Deal status enum
export const DEAL_STATUS = {
  PENDING: 'pending',           // Payment pending
  ACTIVE: 'active',             // Deal active, data stored
  EXPIRED: 'expired',           // Deal expired
  TERMINATED: 'terminated',     // Early termination
  FAILED: 'failed',             // Storage failed
};

// Pricing tiers (per MB per month in USDC)
export const PRICING = {
  standard: {
    pricePerMBMonth: 0.0001,    // $0.0001 per MB/month
    minSizeMB: 0.001,           // 1 KB minimum
    maxSizeMB: 1000,
    minDurationDays: 7,
    maxDurationDays: 365,
  },
  premium: {
    pricePerMBMonth: 0.0002,    // $0.0002 per MB/month (with erasure coding)
    minSizeMB: 0.001,           // 1 KB minimum
    maxSizeMB: 10000,
    minDurationDays: 7,         // Lowered from 30 for flexibility
    maxDurationDays: 730,
    includesErasureCoding: true,
    replicationFactor: 3,
  },
  enterprise: {
    pricePerMBMonth: 0.0005,    // $0.0005 per MB/month
    minSizeMB: 0.001,           // 1 KB minimum
    maxSizeMB: 100000,
    minDurationDays: 7,         // Lowered from 90 for flexibility
    maxDurationDays: 1825,      // 5 years
    includesErasureCoding: true,
    replicationFactor: 5,
    slaGuarantee: true,
  },
};

/**
 * Calculate deal price
 * 
 * @param {number} sizeMB - File size in MB
 * @param {number} durationDays - Duration in days
 * @param {string} tier - Pricing tier
 * @returns {object} - Price breakdown
 */
export function calculateDealPrice(sizeMB, durationDays, tier = 'standard') {
  const pricing = PRICING[tier];
  if (!pricing) {
    throw new Error(`Invalid pricing tier: ${tier}`);
  }
  
  // Validate size
  if (sizeMB < pricing.minSizeMB || sizeMB > pricing.maxSizeMB) {
    throw new Error(`Size must be between ${pricing.minSizeMB} and ${pricing.maxSizeMB} MB for ${tier} tier`);
  }
  
  // Validate duration
  if (durationDays < pricing.minDurationDays || durationDays > pricing.maxDurationDays) {
    throw new Error(`Duration must be between ${pricing.minDurationDays} and ${pricing.maxDurationDays} days for ${tier} tier`);
  }
  
  const months = durationDays / 30;
  const basePrice = sizeMB * months * pricing.pricePerMBMonth;
  
  // Add erasure coding overhead if included
  let totalPrice = basePrice;
  let storageOverhead = 0;
  
  if (pricing.includesErasureCoding) {
    const overhead = ErasureCoding.calculateOverhead(sizeMB * 1024 * 1024);
    storageOverhead = overhead.overheadPercent;
    totalPrice = basePrice * (1 + storageOverhead / 100);
  }
  
  // Replication cost
  const replicationFactor = pricing.replicationFactor || 1;
  totalPrice = totalPrice * replicationFactor;
  
  return {
    tier,
    sizeMB,
    durationDays,
    months: Math.round(months * 100) / 100,
    pricePerMBMonth: pricing.pricePerMBMonth,
    basePrice: Math.round(basePrice * 1000000) / 1000000,
    storageOverheadPercent: storageOverhead,
    replicationFactor,
    totalPriceUSDC: Math.round(totalPrice * 1000000) / 1000000,
    features: {
      erasureCoding: pricing.includesErasureCoding || false,
      slaGuarantee: pricing.slaGuarantee || false,
    },
  };
}

/**
 * Generate a unique deal ID
 * 
 * @returns {string} - Deal ID
 */
export function generateDealId() {
  return `deal_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * Create a new storage deal
 * 
 * @param {object} params - Deal parameters
 * @returns {object} - Deal object
 */
export function createDeal(params) {
  const {
    cid,
    clientAddress,
    providerPub,
    sizeMB,
    durationDays,
    tier = 'standard',
    erasureMetadata = null,
    paymentTx = null,
  } = params;
  
  if (!cid || !clientAddress || !providerPub || !sizeMB || !durationDays) {
    throw new Error('Missing required deal parameters');
  }
  
  const pricing = calculateDealPrice(sizeMB, durationDays, tier);
  const now = Date.now();
  
  return {
    id: generateDealId(),
    version: 1,
    // Parties
    cid,
    clientAddress,
    providerPub,
    // Terms
    tier,
    sizeMB,
    durationDays,
    pricing,
    // Dates
    createdAt: now,
    activatedAt: null,
    expiresAt: null,
    // Payment
    paymentRequired: pricing.totalPriceUSDC,
    paymentTx,
    paymentVerified: false,
    // Storage
    erasureCoding: pricing.features.erasureCoding,
    erasureMetadata,
    replicationFactor: pricing.replicationFactor,
    replicas: {},  // Object instead of array for GunDB compatibility
    replicaCount: 0,
    // Status
    status: DEAL_STATUS.PENDING,
    // Note: statusHistory removed - GunDB doesn't support arrays natively
  };
}

/**
 * Activate a deal after payment verification
 * 
 * @param {object} deal - Deal object
 * @param {string} paymentTx - Payment transaction hash
 * @returns {object} - Updated deal
 */
export function activateDeal(deal, paymentTx) {
  const now = Date.now();
  const expiresAt = now + (deal.durationDays * 24 * 60 * 60 * 1000);
  
  return {
    ...deal,
    paymentTx,
    paymentVerified: true,
    activatedAt: now,
    expiresAt,
    status: DEAL_STATUS.ACTIVE,
    activatedAt: now,
    activationReason: 'Payment verified',
  };
}

/**
 * Add replica information to deal
 * 
 * @param {object} deal - Deal object
 * @param {object} replica - Replica info { relayHost, relayPub, pinnedAt, chunks }
 * @returns {object} - Updated deal
 */
export function addReplica(deal, replica) {
  const replicas = { ...(deal.replicas || {}) };
  const replicaKey = replica.relayPub;
  
  if (replicas[replicaKey]) {
    // Update existing replica
    replicas[replicaKey] = { ...replicas[replicaKey], ...replica, updatedAt: Date.now() };
  } else {
    // Add new replica
    replicas[replicaKey] = { ...replica, addedAt: Date.now() };
  }
  
  return {
    ...deal,
    replicas,
    replicaCount: Object.keys(replicas).length,
  };
}

/**
 * Check if deal is expired
 * 
 * @param {object} deal - Deal object
 * @returns {boolean}
 */
export function isDealExpired(deal) {
  if (!deal.expiresAt) return false;
  return Date.now() > deal.expiresAt;
}

/**
 * Check if deal needs renewal
 * 
 * @param {object} deal - Deal object
 * @param {number} daysBeforeExpiry - Days before expiry to warn
 * @returns {boolean}
 */
export function needsRenewal(deal, daysBeforeExpiry = 7) {
  if (!deal.expiresAt) return false;
  const warningTime = deal.expiresAt - (daysBeforeExpiry * 24 * 60 * 60 * 1000);
  return Date.now() > warningTime;
}

/**
 * Calculate renewal price
 * 
 * @param {object} deal - Existing deal
 * @param {number} additionalDays - Days to add
 * @returns {object} - Renewal pricing
 */
export function calculateRenewalPrice(deal, additionalDays) {
  return calculateDealPrice(deal.sizeMB, additionalDays, deal.tier);
}

/**
 * Renew a deal
 * 
 * @param {object} deal - Deal object
 * @param {number} additionalDays - Days to add
 * @param {string} paymentTx - Payment transaction hash
 * @returns {object} - Updated deal
 */
export function renewDeal(deal, additionalDays, paymentTx) {
  const now = Date.now();
  const currentExpiry = deal.expiresAt || now;
  const newExpiry = Math.max(currentExpiry, now) + (additionalDays * 24 * 60 * 60 * 1000);
  
  return {
    ...deal,
    durationDays: deal.durationDays + additionalDays,
    expiresAt: newExpiry,
    status: DEAL_STATUS.ACTIVE,
    renewedAt: now,
    renewalReason: `Renewed for ${additionalDays} days`,
    renewalPaymentTx: paymentTx,
  };
}

/**
 * Terminate a deal early
 * 
 * @param {object} deal - Deal object
 * @param {string} reason - Termination reason
 * @returns {object} - Updated deal
 */
export function terminateDeal(deal, reason) {
  const now = Date.now();
  
  return {
    ...deal,
    status: DEAL_STATUS.TERMINATED,
    terminatedAt: now,
    terminationReason: reason,
  };
}

/**
 * Save deal to GunDB frozen space
 * 
 * @param {Gun} gun - GunDB instance
 * @param {object} deal - Deal object
 * @param {object} keyPair - SEA keypair for signing
 * @returns {Promise<{hash: string}>}
 */
export async function saveDeal(gun, deal, keyPair) {
  const result = await FrozenData.createFrozenEntry(
    gun,
    deal,
    keyPair,
    'storage-deals',
    deal.id
  );
  
  // Also index by CID for lookup
  gun.get('shogun-index').get('deals-by-cid').get(deal.cid).get(deal.id).put({
    hash: result.hash,
    clientAddress: deal.clientAddress,
    status: deal.status,
    expiresAt: deal.expiresAt,
    updatedAt: Date.now(),
  });
  
  // Index by client address
  gun.get('shogun-index').get('deals-by-client').get(deal.clientAddress).get(deal.id).put({
    hash: result.hash,
    cid: deal.cid,
    status: deal.status,
    expiresAt: deal.expiresAt,
    updatedAt: Date.now(),
  });
  
  return result;
}

/**
 * Get deal by ID
 * 
 * @param {Gun} gun - GunDB instance
 * @param {string} dealId - Deal ID
 * @returns {Promise<object|null>}
 */
export async function getDeal(gun, dealId) {
  const entry = await FrozenData.getLatestFrozenEntry(gun, 'storage-deals', dealId);
  
  if (!entry || !entry.verified) {
    return null;
  }
  
  return entry.data;
}

/**
 * Get deals by CID
 * 
 * @param {Gun} gun - GunDB instance
 * @param {string} cid - IPFS CID
 * @returns {Promise<object[]>}
 */
export async function getDealsByCid(gun, cid) {
  return new Promise((resolve) => {
    const deals = [];
    const timeout = setTimeout(() => resolve(deals), 5000);
    
    gun.get('shogun-index').get('deals-by-cid').get(cid).map().once(async (index, dealId) => {
      if (!index || !index.hash) return;
      
      const deal = await getDeal(gun, dealId);
      if (deal) {
        deals.push(deal);
      }
    });
    
    setTimeout(() => {
      clearTimeout(timeout);
      resolve(deals);
    }, 3000);
  });
}

/**
 * Get deals by client address
 * 
 * @param {Gun} gun - GunDB instance
 * @param {string} clientAddress - Client wallet address
 * @returns {Promise<object[]>}
 */
export async function getDealsByClient(gun, clientAddress) {
  return new Promise((resolve) => {
    const deals = [];
    const timeout = setTimeout(() => resolve(deals), 5000);
    
    gun.get('shogun-index').get('deals-by-client').get(clientAddress).map().once(async (index, dealId) => {
      if (!index || !index.hash) return;
      
      const deal = await getDeal(gun, dealId);
      if (deal) {
        deals.push(deal);
      }
    });
    
    setTimeout(() => {
      clearTimeout(timeout);
      resolve(deals);
    }, 3000);
  });
}

/**
 * Get active deals for this relay
 * 
 * @param {Gun} gun - GunDB instance
 * @param {string} relayPub - Relay public key
 * @returns {Promise<object[]>}
 */
export async function getActiveDealsForRelay(gun, relayPub) {
  const entries = await FrozenData.listFrozenEntries(gun, 'storage-deals', {
    verifyAll: true,
    limit: 1000,
  });
  
  const activeDeals = [];
  
  for (const entry of entries) {
    if (entry.data && entry.data.providerPub === relayPub) {
      if (entry.data.status === DEAL_STATUS.ACTIVE && !isDealExpired(entry.data)) {
        activeDeals.push(entry.data);
      }
    }
  }
  
  return activeDeals;
}

/**
 * Get deal statistics
 * 
 * @param {object[]} deals - Array of deals
 * @returns {object} - Statistics
 */
export function getDealStats(deals) {
  const stats = {
    total: deals.length,
    active: 0,
    expired: 0,
    pending: 0,
    totalSizeMB: 0,
    totalRevenue: 0,
    byTier: {},
  };
  
  for (const deal of deals) {
    // Count by status
    if (deal.status === DEAL_STATUS.ACTIVE && !isDealExpired(deal)) {
      stats.active++;
      stats.totalSizeMB += deal.sizeMB;
    } else if (deal.status === DEAL_STATUS.PENDING) {
      stats.pending++;
    } else {
      stats.expired++;
    }
    
    // Revenue
    if (deal.paymentVerified) {
      stats.totalRevenue += deal.pricing?.totalPriceUSDC || 0;
    }
    
    // By tier
    const tier = deal.tier || 'standard';
    stats.byTier[tier] = (stats.byTier[tier] || 0) + 1;
  }
  
  return stats;
}

export default {
  DEAL_STATUS,
  PRICING,
  calculateDealPrice,
  generateDealId,
  createDeal,
  activateDeal,
  addReplica,
  isDealExpired,
  needsRenewal,
  calculateRenewalPrice,
  renewDeal,
  terminateDeal,
  saveDeal,
  getDeal,
  getDealsByCid,
  getDealsByClient,
  getActiveDealsForRelay,
  getDealStats,
};

