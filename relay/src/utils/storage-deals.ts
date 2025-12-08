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

import { IGunInstanceRoot } from "gun";
import FrozenData, { FrozenEntry } from "./frozen-data";
import { loggers } from "./logger";
// @ts-ignore
import { v4 as uuidv4 } from 'uuid';

const log = loggers.storagDeals;

// --- Constants & Enums ---

export const DEAL_STATUS = {
    PENDING: 'pending',
    ACTIVE: 'active',
    EXPIRED: 'expired',
    TERMINATED: 'terminated',
    FAILED: 'failed'
};

export const PRICING = {
    standard: {
        pricePerMBMonth: 0.01,
        minSizeMB: 1,
        minDurationDays: 30
    },
    premium: {
        pricePerMBMonth: 0.05,
        minSizeMB: 1,
        minDurationDays: 30
    },
    enterprise: {
        pricePerMBMonth: 0.10,
        minSizeMB: 10,
        minDurationDays: 90
    }
};

// --- Interfaces ---

export interface DealPricing {
    tier: string;
    sizeMB: number;
    durationDays: number;
    months: number;
    pricePerMBMonth: number;
    basePrice: number;
    storageOverheadPercent: number;
    replicationFactor: number;
    totalPriceUSDC: number;
    features: {
        erasureCoding: boolean;
        slaGuarantee: boolean;
    };
}

export interface Deal {
    id: string;
    version: number;
    cid: string;
    clientAddress: string;
    providerPub: string;
    tier: string;
    sizeMB: number;
    durationDays: number;
    pricing: DealPricing;
    createdAt: number;
    activatedAt: number;
    expiresAt: number;
    paymentRequired: number;
    paymentTx?: string;
    paymentNetwork?: string;
    paymentVerified: boolean;
    erasureCoding: boolean;
    erasureMetadata?: any;
    replicationFactor: number;
    replicas: Record<string, any>;
    replicaCount: number;
    status: string;
    onChainDealId?: string;
    onChainRelay?: string;
    clientStake?: string;
    syncedFromOnChain?: boolean;
    syncedAt?: number;
}

export interface DealStats {
    total: number;
    active: number;
    expired: number;
    pending: number;
    totalSizeMB: number;
    totalRevenue: number;
    byTier: Record<string, number>;
}

// --- Core Functions ---

/**
 * Generate a unique deal ID
 */
export function generateDealId(): string {
    return uuidv4();
}

/**
 * Calculate deal pricing
 */
export function calculateDealPrice(sizeMB: number, durationDays: number, tier: string = 'standard'): DealPricing {
    const tierConfig = PRICING[tier as keyof typeof PRICING] || PRICING.standard;
    const months = Math.ceil(durationDays / 30);
    const basePrice = sizeMB * tierConfig.pricePerMBMonth * months;

    return {
        tier,
        sizeMB,
        durationDays,
        months,
        pricePerMBMonth: tierConfig.pricePerMBMonth,
        basePrice,
        storageOverheadPercent: 0,
        replicationFactor: 1,
        totalPriceUSDC: basePrice,
        features: {
            erasureCoding: false,
            slaGuarantee: tier === 'enterprise'
        }
    };
}

/**
 * Create a new deal object (in memory)
 */
export function createDeal(
    cid: string,
    clientAddress: string,
    providerPub: string,
    sizeMB: number,
    durationDays: number,
    tier: string = 'standard'
): Deal {
    const pricing = calculateDealPrice(sizeMB, durationDays, tier);
    const now = Date.now();

    return {
        id: generateDealId(),
        version: 1,
        cid,
        clientAddress: clientAddress.toLowerCase(),
        providerPub,
        tier,
        sizeMB,
        durationDays,
        pricing,
        createdAt: now,
        activatedAt: 0,
        expiresAt: 0, // Set when activated
        paymentRequired: pricing.totalPriceUSDC,
        paymentVerified: false,
        erasureCoding: false,
        replicationFactor: 1,
        replicas: {},
        replicaCount: 0,
        status: DEAL_STATUS.PENDING
    };
}

/**
 * Activate a deal (e.g. after payment)
 */
export function activateDeal(deal: Deal): Deal {
    const now = Date.now();
    const expiresAt = now + (deal.durationDays * 24 * 60 * 60 * 1000);

    return {
        ...deal,
        status: DEAL_STATUS.ACTIVE,
        activatedAt: now,
        expiresAt,
        paymentVerified: true
    };
}

/**
 * Check if a deal is expired
 */
export function isDealExpired(deal: Deal): boolean {
    if (!deal.expiresAt) return false;
    return Date.now() > deal.expiresAt;
}

/**
 * Check if deal needs renewal
 */
export function needsRenewal(deal: Deal, thresholdDays: number = 7): boolean {
    if (!deal.expiresAt || deal.status !== DEAL_STATUS.ACTIVE) return false;
    const timeLeft = deal.expiresAt - Date.now();
    const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
    return timeLeft < thresholdMs;
}

/**
 * Calculate renewal price
 */
export function calculateRenewalPrice(deal: Deal, extendDays: number): number {
    const pricing = calculateDealPrice(deal.sizeMB, extendDays, deal.tier);
    return pricing.totalPriceUSDC;
}

/**
 * Renew a deal
 */
export function renewDeal(deal: Deal, extendDays: number, paymentTx?: string): Deal {
    const now = Date.now();
    // If expired, start from now, otherwise extend from expiry
    const baseTime = deal.expiresAt > now ? deal.expiresAt : now;
    const newExpiresAt = baseTime + (extendDays * 24 * 60 * 60 * 1000);

    return {
        ...deal,
        expiresAt: newExpiresAt,
        status: DEAL_STATUS.ACTIVE,
        paymentTx: paymentTx || deal.paymentTx
    };
}

/**
 * Terminate a deal
 */
export function terminateDeal(deal: Deal): Deal {
    return {
        ...deal,
        status: DEAL_STATUS.TERMINATED
    };
}

/**
 * Add a replica location to the deal
 */
export function addReplica(deal: Deal, relayPub: string, locationInfo: any): Deal {
    const replicas = { ...deal.replicas, [relayPub]: locationInfo };
    return {
        ...deal,
        replicas,
        replicaCount: Object.keys(replicas).length
    };
}

// --- GunDB Persistence ---

/**
 * Save a deal to GunDB (Frozen Data)
 */
export async function saveDeal(gun: any, deal: Deal, keyPair: any): Promise<void> {
    try {
        await FrozenData.createFrozenEntry(gun, deal, keyPair, 'storage-deals', deal.id);

        log.info({ dealId: deal.id }, "Saved deal to GunDB");
    } catch (error: any) {
        log.error({ err: error, dealId: deal.id }, "Failed to save deal");
        throw error;
    }
}


/**
 * Get a deal from GunDB
 */
export async function getDeal(gun: any, dealId: string): Promise<Deal | null> {
    try {
        const entry = await FrozenData.readFrozenEntry(gun, 'storage-deals', dealId);
        if (!entry || !entry.data) return null;
        return entry.data as unknown as Deal;
    } catch (error: any) {
        log.error({ err: error, dealId }, "Error getting deal");
        return null;
    }
}

/**
 * Get deals by CID
 */
export async function getDealsByCid(gun: IGunInstanceRoot<any, any>, cid: string): Promise<Deal[]> {
    return new Promise((resolve) => {
        const deals: Deal[] = [];
        const timeout = setTimeout(() => resolve(deals), 5000);

        gun.get('shogun-index').get('deals-by-cid').get(cid).map().once(async (index: any, dealId: string) => {
            if (!dealId) return; // Basic check
            const deal = await getDeal(gun, dealId);
            if (deal) deals.push(deal);
        });

        setTimeout(() => {
            clearTimeout(timeout);
            resolve(deals);
        }, 1500);
    });
}

/**
 * Get deals by client address
 */
export async function getDealsByClient(gun: IGunInstanceRoot<any, any>, clientAddress: string): Promise<Deal[]> {
    return new Promise((resolve) => {
        const deals: Deal[] = [];
        const timeout = setTimeout(() => resolve(deals), 5000);

        gun.get('shogun-index').get('deals-by-client').get(clientAddress).map().once(async (index: any, dealId: string) => {
            if (!dealId) return;
            const deal = await getDeal(gun, dealId);
            if (deal) deals.push(deal);
        });

        setTimeout(() => {
            clearTimeout(timeout);
            resolve(deals);
        }, 1500);
    });
}

/**
 * Get active deals for this relay
 */
export async function getActiveDealsForRelay(gun: IGunInstanceRoot<any, any>, relayPub: string): Promise<Deal[]> {
    try {
        const entries = await FrozenData.listFrozenEntries(gun, 'storage-deals', {
            verifyAll: true,
            limit: 1000,
        }) as unknown as FrozenEntry[];

        const activeDeals: Deal[] = [];

        for (const entry of entries) {
            if (entry.data && entry.data.providerPub === relayPub) {
                const deal = entry.data as unknown as Deal;
                if (deal.status === DEAL_STATUS.ACTIVE && !isDealExpired(deal)) {
                    activeDeals.push(deal);
                }
            }
        }

        return activeDeals;
    } catch (error: any) {
        log.error({ err: error }, "Error getting active deals for relay");
        return [];
    }
}

/**
 * Get deal statistics
 */
export function getDealStats(deals: Deal[]): DealStats {
    const stats: DealStats = {
        total: deals.length,
        active: 0,
        expired: 0,
        pending: 0,
        totalSizeMB: 0,
        totalRevenue: 0,
        byTier: {},
    };

    for (const deal of deals) {
        if (deal.status === DEAL_STATUS.ACTIVE && !isDealExpired(deal)) {
            stats.active++;
            stats.totalSizeMB += deal.sizeMB;
        } else if (deal.status === DEAL_STATUS.PENDING) {
            stats.pending++;
        } else {
            stats.expired++;
        }

        if (deal.paymentVerified) {
            stats.totalRevenue += deal.pricing?.totalPriceUSDC || 0;
        }

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
