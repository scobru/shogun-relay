/**
 * Oracle Routes for Shogun Relay
 *
 * Endpoints:
 * - GET /api/v1/oracle/feeds - List available feeds
 * - POST /api/v1/oracle/feeds - Register new feed (admin)
 * - GET /api/v1/oracle/data/:feedId - Get signed data packet (x402)
 * - DELETE /api/v1/oracle/feeds/:feedId - Deactivate feed (admin)
 */

import express, { Request, Response, Router } from "express";
import { OracleSigner, getOracleSigner, initializeOracleSigner } from "../utils/oracle-signer.js";
import { X402Merchant, SUBSCRIPTION_TIERS } from "../utils/x402-merchant.js";
import { loggers } from "../utils/logger.js";
import { authConfig, oracleConfig } from "../config/index.js";
import {
    recordOracleAccess,
    generateAccessId,
    getGlobalOracleStats,
    getFeedStats,
    getUserOracleStats
} from "../utils/oracle-tracking.js";
import type {
    DataType,
    FeedConfig,
    OracleFeedsResponse,
    OracleDataResponse,
    RegisterFeedRequest,
} from "../types/oracle-types.js";

const router: Router = express.Router();
const log = loggers.server; // Use server logger for oracle routes

// =========================================== Feed Storage ===========================================

// In-memory feed storage (could be moved to GunDB later)
const feeds: Map<string, FeedConfig> = new Map();

// Data type names for API responses
const DATA_TYPE_NAMES: Record<number, string> = {
    0: "PRICE",
    1: "STRING",
    2: "JSON",
    3: "BYTES",
    4: "CUSTOM",
};

// =========================================== Helpers ===========================================

function getAdminToken(req: Request): string | null {
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"] as string;
    return bearerToken || customToken || null;
}

function isAdmin(req: Request): boolean {
    const token = getAdminToken(req);
    return token === authConfig.adminPassword;
}

// =========================================== Routes ===========================================

/**
 * GET /feeds
 * List all available feeds from this relay
 */
router.get("/feeds", async (req: Request, res: Response) => {
    try {
        const signer = getOracleSigner();
        const signerAddress = signer?.getSignerAddress() || "not-configured";

        const feedList = Array.from(feeds.entries()).map(([feedId, feed]) => ({
            feedId,
            name: feed.name,
            dataType: feed.dataType,
            dataTypeName: DATA_TYPE_NAMES[feed.dataType] || "UNKNOWN",
            schema: feed.schema,
            priceUSDC: feed.priceUSDC,
            updateFreqSecs: feed.updateFreqSecs,
            active: feed.active,
        }));

        const response: OracleFeedsResponse = {
            success: true,
            feeds: feedList,
            relay: signerAddress,
        };

        res.json(response);
    } catch (error: any) {
        log.error({ error }, "Error listing feeds");
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * POST /feeds
 * Register a new feed (admin only)
 */
router.post("/feeds", async (req: Request, res: Response) => {
    try {
        if (!isAdmin(req)) {
            return res.status(401).json({
                success: false,
                error: "Admin authentication required",
            });
        }

        const { name, dataType, schema, priceUSDC, updateFreqSecs } = req.body as RegisterFeedRequest;

        if (!name) {
            return res.status(400).json({
                success: false,
                error: "Feed name is required",
            });
        }

        const feedId = OracleSigner.computeFeedId(name);

        // Check if feed already exists
        if (feeds.has(feedId)) {
            return res.status(409).json({
                success: false,
                error: "Feed already exists",
                feedId,
            });
        }

        // Create feed config
        const feedConfig: FeedConfig = {
            name,
            dataType: dataType ?? 4, // Default to CUSTOM
            schema: schema || "bytes",
            priceUSDC: priceUSDC ?? 0,
            updateFreqSecs: updateFreqSecs ?? 60,
            active: true,
            getValue: async () => {
                // Default implementation - should be overridden
                return { timestamp: Date.now(), value: null };
            },
        };

        feeds.set(feedId, feedConfig);

        log.info({ feedId, name, dataType }, "Feed registered");

        res.status(201).json({
            success: true,
            message: "Feed registered",
            feedId,
            feed: {
                name,
                dataType,
                dataTypeName: DATA_TYPE_NAMES[dataType] || "CUSTOM",
                schema,
                priceUSDC,
                updateFreqSecs,
            },
        });
    } catch (error: any) {
        log.error({ error }, "Error registering feed");
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /data/:feedId
 * Get signed oracle data packet
 * Protected by x402 payment if feed has a price
 */
router.get("/data/:feedId", async (req: Request, res: Response) => {
    try {
        const { feedId } = req.params;
        const signer = getOracleSigner();

        if (!signer) {
            return res.status(503).json({
                success: false,
                error: "Oracle signer not configured",
            });
        }

        // Find feed by feedId or name
        let feed = feeds.get(feedId);
        let actualFeedId = feedId;

        // If not found by feedId, try by name
        if (!feed) {
            actualFeedId = OracleSigner.computeFeedId(feedId);
            feed = feeds.get(actualFeedId);
        }

        if (!feed) {
            return res.status(404).json({
                success: false,
                error: "Feed not found",
                feedId,
            });
        }

        if (!feed.active) {
            return res.status(410).json({
                success: false,
                error: "Feed is deactivated",
                feedId: actualFeedId,
            });
        }

        // x402 Payment verification if feed has a price
        if (feed.priceUSDC && feed.priceUSDC > 0) {
            const paymentHeader = req.headers["x-payment"];

            if (!paymentHeader) {
                // Generate the signed packet FIRST so we can include it in the 402 response
                // This allows on-chain payment via ShogunPaidOracle.updatePrice()
                const value = await feed.getValue();
                const packet = await signer.signPacket(
                    feed.name,
                    value,
                    feed.schema,
                    oracleConfig?.defaultValiditySecs || 600
                );

                // Return 402 Payment Required with requirements AND the packet
                const priceAtomic = Math.floor(feed.priceUSDC * 1e6); // USDC has 6 decimals
                return res.status(402).json({
                    success: false,
                    error: "Payment required",
                    paymentRequired: true,
                    packet, // Include signed packet for on-chain payment
                    x402: {
                        x402Version: 1,
                        accepts: [{
                            scheme: "exact",
                            network: "base-sepolia",
                            maxAmountRequired: priceAtomic.toString(),
                            resource: `/api/v1/oracle/data/${actualFeedId}`,
                            description: `Oracle data for ${feed.name}`,
                            mimeType: "application/json",
                            payTo: process.env.X402_PAY_TO_ADDRESS || "",
                            maxTimeoutSeconds: 300,
                            asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // USDC on Base Sepolia
                        }]
                    },
                    feed: {
                        feedId: actualFeedId,
                        name: feed.name,
                        priceUSDC: feed.priceUSDC,
                    }
                });
            }

            // Parse and verify payment
            try {
                const payment = typeof paymentHeader === "string"
                    ? JSON.parse(paymentHeader)
                    : paymentHeader;

                const priceAtomic = Math.floor(feed.priceUSDC * 1e6);

                // Get X402Merchant instance
                const merchant = new X402Merchant({
                    payToAddress: process.env.X402_PAY_TO_ADDRESS || "",
                    network: "base-sepolia"
                });

                const verifyResult = await merchant.verifyDealPayment(payment, priceAtomic);

                if (!verifyResult.isValid) {
                    return res.status(402).json({
                        success: false,
                        error: "Payment verification failed",
                        reason: verifyResult.invalidReason,
                    });
                }

                // Payment valid - settle it
                const settlement = await merchant.settlePayment(payment);
                if (!settlement.success) {
                    log.warn({ error: settlement.errorReason }, "Payment settlement failed");
                    // Continue anyway - verification passed, settlement can be retried
                }

                log.info({
                    feed: feed.name,
                    payer: verifyResult.payer,
                    amount: verifyResult.amount,
                    settled: settlement.success,
                }, "Oracle data access paid via x402");

            } catch (error: any) {
                log.error({ error }, "x402 payment processing error");
                return res.status(402).json({
                    success: false,
                    error: "Payment processing failed",
                    reason: error.message,
                });
            }
        }

        // Get current value from feed
        const value = await feed.getValue();

        // Sign the packet
        const packet = await signer.signPacket(
            feed.name,
            value,
            feed.schema,
            oracleConfig?.defaultValiditySecs || 600
        );

        const response: OracleDataResponse = {
            success: true,
            packet,
            data: {
                feedId: actualFeedId,
                feedName: feed.name,
                value,
                timestamp: Math.floor(Date.now() / 1000),
            },
        };

        // Record oracle access in GunDB
        const gun = req.app.get("gunInstance");
        if (gun) {
            const payerAddress = (req as any).x402Payer || req.ip || "unknown";
            recordOracleAccess(gun, {
                id: generateAccessId(),
                userAddress: payerAddress,
                feedId: actualFeedId,
                feedName: feed.name,
                timestamp: Date.now(),
                paymentMethod: feed.priceUSDC && feed.priceUSDC > 0 ? "x402" : "free",
                paymentAmount: feed.priceUSDC?.toString(),
            }).catch((err) => log.warn({ err }, "Failed to record oracle access"));
        }

        res.json(response);
    } catch (error: any) {
        log.error({ error }, "Error getting oracle data");
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * DELETE /feeds/:feedId
 * Deactivate a feed (admin only)
 */
router.delete("/feeds/:feedId", async (req: Request, res: Response) => {
    try {
        if (!isAdmin(req)) {
            return res.status(401).json({
                success: false,
                error: "Admin authentication required",
            });
        }

        const { feedId } = req.params;

        // Find feed by feedId or name
        let feed = feeds.get(feedId);
        let actualFeedId = feedId;

        if (!feed) {
            actualFeedId = OracleSigner.computeFeedId(feedId);
            feed = feeds.get(actualFeedId);
        }

        if (!feed) {
            return res.status(404).json({
                success: false,
                error: "Feed not found",
                feedId,
            });
        }

        feed.active = false;
        feeds.set(actualFeedId, feed);

        log.info({ feedId: actualFeedId, name: feed.name }, "Feed deactivated");

        res.json({
            success: true,
            message: "Feed deactivated",
            feedId: actualFeedId,
        });
    } catch (error: any) {
        log.error({ error }, "Error deactivating feed");
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * PUT /feeds/:feedId/value
 * Update feed value (admin only) - for static feeds
 */
router.put("/feeds/:feedId/value", async (req: Request, res: Response) => {
    try {
        if (!isAdmin(req)) {
            return res.status(401).json({
                success: false,
                error: "Admin authentication required",
            });
        }

        const { feedId } = req.params;
        const { value } = req.body;

        // Find feed
        let feed = feeds.get(feedId);
        let actualFeedId = feedId;

        if (!feed) {
            actualFeedId = OracleSigner.computeFeedId(feedId);
            feed = feeds.get(actualFeedId);
        }

        if (!feed) {
            return res.status(404).json({
                success: false,
                error: "Feed not found",
                feedId,
            });
        }

        // Update getValue function to return static value
        const storedValue = value;
        feed.getValue = async () => storedValue;
        feeds.set(actualFeedId, feed);

        log.info({ feedId: actualFeedId, value }, "Feed value updated");

        res.json({
            success: true,
            message: "Feed value updated",
            feedId: actualFeedId,
            value,
        });
    } catch (error: any) {
        log.error({ error }, "Error updating feed value");
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /stats/global
 * Get global oracle revenue and usage stats
 */
router.get("/stats/global", async (req: Request, res: Response) => {
    try {
        const gun = req.app.get("gunInstance");
        if (!gun) throw new Error("GunDB not initialized");

        const stats = await getGlobalOracleStats(gun);
        res.json({ success: true, stats });
    } catch (error: any) {
        log.error({ error }, "Error getting global stats");
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /stats/feed/:feedId
 * Get stats for a specific feed
 */
router.get("/stats/feed/:feedId", async (req: Request, res: Response) => {
    try {
        const gun = req.app.get("gunInstance");
        if (!gun) throw new Error("GunDB not initialized");

        const { feedId } = req.params;
        const stats = await getFeedStats(gun, feedId);

        if (!stats) {
            return res.status(404).json({ success: false, error: "Stats not found for feed" });
        }
        res.json({ success: true, stats });
    } catch (error: any) {
        log.error({ error }, "Error getting feed stats");
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /stats/user/:userAddress
 * Get stats for a specific user
 */
router.get("/stats/user/:userAddress", async (req: Request, res: Response) => {
    try {
        const gun = req.app.get("gunInstance");
        if (!gun) throw new Error("GunDB not initialized");

        const { userAddress } = req.params;
        const stats = await getUserOracleStats(gun, userAddress);

        if (!stats) {
            return res.status(404).json({ success: false, error: "Stats not found for user" });
        }
        res.json({ success: true, stats });
    } catch (error: any) {
        log.error({ error }, "Error getting user stats");
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /config
 * Get oracle configuration (public info only)
 */
router.get("/config", (req: Request, res: Response) => {
    try {
        const signer = getOracleSigner();

        res.json({
            success: true,
            configured: !!signer,
            signerAddress: signer?.getSignerAddress() || null,
            feedCount: feeds.size,
            defaultValiditySecs: oracleConfig?.defaultValiditySecs || 600,
        });
    } catch (error: any) {
        log.error({ error }, "Error getting oracle config");
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

export default router;

// =========================================== Initialization ===========================================

// Import SDK to get contract addresses from deployments
import { getContractDeployment } from "shogun-contracts-sdk";
import { blockchainConfig } from "../config/index.js";

/**
 * Initialize oracle with config
 * Uses RELAY_PRIVATE_KEY and fetches contract address from SDK deployments
 */
export function initializeOracle(config: {
    enabled: boolean;
    chainId: number;
    defaultValiditySecs?: number;
}) {
    if (!config.enabled) {
        log.info("Oracle disabled");
        return;
    }

    // Use relay private key (same signer for all relay services)
    const signerPrivateKey = blockchainConfig.relayPrivateKey;
    if (!signerPrivateKey) {
        log.warn("Oracle enabled but RELAY_PRIVATE_KEY not set");
        return;
    }

    // Get contract address from SDK deployments (no env needed!)
    const deployment = getContractDeployment(config.chainId, "ShogunPriceOracle");
    if (!deployment?.address) {
        log.warn(`Oracle enabled but ShogunPriceOracle not deployed on chain ${config.chainId}`);
        return;
    }

    initializeOracleSigner({
        privateKey: signerPrivateKey,
        chainId: config.chainId,
        oracleContractAddress: deployment.address,
    });

    log.info({
        chainId: config.chainId,
        oracleContract: deployment.address
    }, "Oracle initialized with SDK deployment");
}

/**
 * Register a feed programmatically
 */
export function registerFeed(name: string, config: Omit<FeedConfig, "name">) {
    const feedId = OracleSigner.computeFeedId(name);
    feeds.set(feedId, { ...config, name });
    log.info({ feedId, name }, "Feed registered programmatically");
    return feedId;
}
