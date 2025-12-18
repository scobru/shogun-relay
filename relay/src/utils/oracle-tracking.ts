/**
 * Oracle Usage Tracking for GunDB
 * 
 * Tracks oracle data access and payments per user.
 * Similar pattern to storage-deals.ts and x402-merchant.ts
 */

import { loggers } from "./logger.js";
import * as RelayUser from "./relay-user.js";
import * as FrozenData from "./frozen-data.js";

const log = loggers.server;

// =========================================== Types ===========================================

export interface OracleAccess {
    id: string;                     // Unique access ID
    userAddress: string;            // User who accessed
    feedId: string;                 // Feed accessed
    feedName: string;               // Human-readable feed name
    timestamp: number;              // When accessed
    paymentMethod: "x402" | "onchain" | "free"; // How they paid
    paymentAmount?: string;         // Amount paid (USDC)
    txHash?: string;                // Settlement tx hash (if applicable)
}

export interface OracleUsageStats {
    totalAccesses: number;          // Total data accesses
    totalRevenueUSDC: number;       // Total revenue in USDC
    accessesByFeed: Record<string, number>;  // Accesses per feed
    revenueByFeed: Record<string, number>;   // Revenue per feed
    lastAccess?: string;            // Last access timestamp
}

export interface UserOracleSubscription {
    userAddress: string;
    activeSince?: number;
    lastAccess?: number;
    totalAccesses: number;
    totalPaidUSDC: number;
    feedsAccessed: string[];        // List of feedIds accessed
}

// =========================================== Core Functions ===========================================

/**
 * Record an oracle data access
 */
export async function recordOracleAccess(
    gun: any,
    access: OracleAccess,
    keyPair?: any
): Promise<void> {
    try {
        // Save to frozen data for immutable record
        if (keyPair) {
            await FrozenData.createFrozenEntry(
                gun,
                access,
                keyPair,
                "oracle-accesses",
                access.id
            );
        } else {
            // Fallback to regular GunDB storage
            await new Promise<void>((resolve, reject) => {
                gun
                    .get("shogun")
                    .get("oracle-accesses")
                    .get(access.id)
                    .put(access, (ack: any) => {
                        if (ack?.err) reject(new Error(ack.err));
                        else resolve();
                    });
            });
        }

        // Update user's oracle subscription record
        await updateUserOracleStats(gun, access);

        // Update feed stats
        await updateFeedStats(gun, access);

        log.debug({
            accessId: access.id,
            user: access.userAddress,
            feed: access.feedName,
        }, "Oracle access recorded");

    } catch (error: any) {
        log.error({ error }, "Failed to record oracle access");
        // Don't throw - non-critical
    }
}

/**
 * Update user's oracle subscription/usage stats
 */
async function updateUserOracleStats(gun: any, access: OracleAccess): Promise<void> {
    if (!RelayUser.isRelayUserInitialized()) {
        log.debug("Relay user not initialized, skipping user stats update");
        return;
    }

    try {
        const userAddress = access.userAddress.toLowerCase();
        const current = await getUserOracleStats(gun, userAddress);

        const updated: UserOracleSubscription = {
            userAddress,
            activeSince: current?.activeSince || access.timestamp,
            lastAccess: access.timestamp,
            totalAccesses: (current?.totalAccesses || 0) + 1,
            totalPaidUSDC: (current?.totalPaidUSDC || 0) + parseFloat(access.paymentAmount || "0"),
            feedsAccessed: current?.feedsAccessed || [],
        };

        // Add feedId if not already tracked
        if (!updated.feedsAccessed.includes(access.feedId)) {
            updated.feedsAccessed.push(access.feedId);
        }

        const relayUser = RelayUser.getRelayUser();
        if (relayUser) {
            await new Promise<void>((resolve, reject) => {
                relayUser
                    .get("oracle")
                    .get("users")
                    .get(userAddress)
                    .put(updated as any, (ack: any) => {
                        if (ack?.err) reject(new Error(ack.err));
                        else resolve();
                    });
            });
        }
    } catch (error: any) {
        log.error({ error }, "Failed to update user oracle stats");
    }
}

/**
 * Update feed-level stats
 */
async function updateFeedStats(gun: any, access: OracleAccess): Promise<void> {
    try {
        const statsNode = gun.get("shogun").get("oracle-stats").get(access.feedId);

        await new Promise<void>((resolve) => {
            statsNode.once((current: any) => {
                const updated = {
                    feedId: access.feedId,
                    feedName: access.feedName,
                    totalAccesses: (current?.totalAccesses || 0) + 1,
                    totalRevenueUSDC: (current?.totalRevenueUSDC || 0) + parseFloat(access.paymentAmount || "0"),
                    lastAccess: access.timestamp,
                };

                statsNode.put(updated, () => resolve());
            });
        });
    } catch (error: any) {
        log.error({ error }, "Failed to update feed stats");
    }
}

// =========================================== Query Functions ===========================================

/**
 * Get oracle stats for a user
 */
export async function getUserOracleStats(
    gun: any,
    userAddress: string
): Promise<UserOracleSubscription | null> {
    if (!RelayUser.isRelayUserInitialized()) {
        return null;
    }

    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 5000);

        const relayUser = RelayUser.getRelayUser();
        if (!relayUser) {
            clearTimeout(timeout);
            resolve(null);
            return;
        }

        relayUser
            .get("oracle")
            .get("users")
            .get(userAddress.toLowerCase())
            .once((data: any) => {
                clearTimeout(timeout);
                if (!data || typeof data !== "object") {
                    resolve(null);
                    return;
                }

                // Filter out Gun metadata
                const clean: UserOracleSubscription = {
                    userAddress: data.userAddress,
                    activeSince: data.activeSince,
                    lastAccess: data.lastAccess,
                    totalAccesses: data.totalAccesses || 0,
                    totalPaidUSDC: data.totalPaidUSDC || 0,
                    feedsAccessed: data.feedsAccessed || [],
                };
                resolve(clean);
            });
    });
}

/**
 * Get feed stats
 */
export async function getFeedStats(
    gun: any,
    feedId: string
): Promise<OracleUsageStats | null> {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 5000);

        gun
            .get("shogun")
            .get("oracle-stats")
            .get(feedId)
            .once((data: any) => {
                clearTimeout(timeout);
                if (!data) {
                    resolve(null);
                    return;
                }

                resolve({
                    totalAccesses: data.totalAccesses || 0,
                    totalRevenueUSDC: data.totalRevenueUSDC || 0,
                    accessesByFeed: { [feedId]: data.totalAccesses || 0 },
                    revenueByFeed: { [feedId]: data.totalRevenueUSDC || 0 },
                    lastAccess: data.lastAccess ? new Date(data.lastAccess).toISOString() : undefined,
                });
            });
    });
}

/**
 * Get all oracle accesses for a user
 */
export async function getUserOracleAccesses(
    gun: any,
    userAddress: string,
    limit: number = 100
): Promise<OracleAccess[]> {
    return new Promise((resolve) => {
        const accesses: OracleAccess[] = [];
        const timeout = setTimeout(() => resolve(accesses), 5000);

        gun
            .get("shogun")
            .get("oracle-accesses")
            .map()
            .once((data: any, key: string) => {
                if (data && data.userAddress?.toLowerCase() === userAddress.toLowerCase()) {
                    accesses.push(data);
                }
            });

        setTimeout(() => {
            clearTimeout(timeout);
            // Sort by timestamp desc and limit
            resolve(
                accesses
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .slice(0, limit)
            );
        }, 2000);
    });
}

/**
 * Get global oracle stats
 */
export async function getGlobalOracleStats(gun: any): Promise<OracleUsageStats> {
    return new Promise((resolve) => {
        const stats: OracleUsageStats = {
            totalAccesses: 0,
            totalRevenueUSDC: 0,
            accessesByFeed: {},
            revenueByFeed: {},
        };

        gun
            .get("shogun")
            .get("oracle-stats")
            .map()
            .once((data: any, feedId: string) => {
                if (data && feedId) {
                    stats.totalAccesses += data.totalAccesses || 0;
                    stats.totalRevenueUSDC += data.totalRevenueUSDC || 0;
                    stats.accessesByFeed[feedId] = data.totalAccesses || 0;
                    stats.revenueByFeed[feedId] = data.totalRevenueUSDC || 0;
                    if (!stats.lastAccess || data.lastAccess > new Date(stats.lastAccess).getTime()) {
                        stats.lastAccess = new Date(data.lastAccess).toISOString();
                    }
                }
            });

        setTimeout(() => resolve(stats), 2000);
    });
}

// =========================================== Utility Functions ===========================================

/**
 * Generate unique access ID
 */
export function generateAccessId(): string {
    return `oa_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}
