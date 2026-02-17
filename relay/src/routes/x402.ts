/**
 * x402 Payment Routes for IPFS Storage Subscriptions
 *
 * Endpoints:
 * - GET /api/v1/x402/tiers - List available subscription tiers
 * - GET /api/v1/x402/subscription/:userAddress - Get subscription status
 * - POST /api/v1/x402/subscribe - Purchase or renew subscription
 * - GET /api/v1/x402/payment-requirements/:tier - Get payment requirements for a tier
 */

import express, { Request, Response, Router } from "express";
import {
  X402Merchant,
  getSubscriptionTiers,
  NetworkKey,
  SubscriptionStatus,
  CanUploadResult,
  CanUploadVerifiedResult,
  RelayStorageStatus,
} from "../utils/x402-merchant.js";
import * as StorageDeals from "../utils/storage-deals.js";
import { loggers } from "../utils/logger";
const router: Router = express.Router();

import { authConfig, ipfsConfig, relayConfig, x402Config } from "../config";
import { validateAdminToken } from "../utils/auth-utils";

// Initialize X402 Merchant
let merchant: X402Merchant | undefined = undefined;

function getMerchant(): X402Merchant {
  if (!merchant) {
    const payToAddress = x402Config.payToAddress || "";
    if (!payToAddress) {
      throw new Error("X402_PAY_TO_ADDRESS not configured");
    }

    merchant = new X402Merchant({
      payToAddress,
      network: (x402Config.defaultNetwork || "base-sepolia") as NetworkKey,
      facilitatorUrl: x402Config.facilitatorUrl || "",
      facilitatorApiKey: x402Config.facilitatorApiKey || "",
      settlementMode: (x402Config.settlementMode || "facilitator") as "facilitator" | "direct",
      privateKey: x402Config.privateKey || "",
      rpcUrl: x402Config.getRpcUrl() || "",
    });
  }
  return merchant;
}

// Get Gun instance helper
function getGunInstance(req: Request): any {
  return req.app.get("gunInstance");
}

/**
 * GET /tiers
 * List all available subscription tiers
 * Includes relay storage status to show availability
 */
router.get("/tiers", async (req, res) => {
  try {
    const ipfsApiUrl = req.app.get("IPFS_API_URL") || ipfsConfig.apiUrl || "http://127.0.0.1:5001";
    const ipfsApiToken = req.app.get("IPFS_API_TOKEN") || ipfsConfig.apiToken || "";

    // Get relay storage status
    const relayStorage = await X402Merchant.getRelayStorageStatus(ipfsApiUrl, ipfsApiToken);

    const tiers = Object.entries(getSubscriptionTiers()).map(([key, tier]) => {
      const tierInfo: any = {
        id: key,
        ...tier,
        priceDisplay: `${tier.priceUSDC} USDC`,
      };

      // Check if this tier can be purchased based on relay storage
      if (relayStorage.available && !relayStorage.unlimited) {
        tierInfo.available = (relayStorage.remainingMB || 0) >= tier.storageMB;
        if (!tierInfo.available) {
          tierInfo.unavailableReason = "Relay storage insufficient";
        }
      } else {
        tierInfo.available = true;
      }

      return tierInfo;
    });

    const response: any = {
      success: true,
      tiers,
      network: x402Config.defaultNetwork || "base-sepolia",
    };

    // Include relay storage info if available
    if (relayStorage.available) {
      response.relayStorage = {
        unlimited: relayStorage.unlimited,
        usedGB: relayStorage.usedGB,
        maxStorageGB: relayStorage.maxStorageGB,
        remainingGB: relayStorage.remainingGB,
        percentUsed: relayStorage.percentUsed,
        warning: relayStorage.warning,
        full: relayStorage.full,
      };

      if (relayStorage.full) {
        response.relayWarning = "Relay storage is FULL - subscriptions temporarily unavailable";
      } else if (relayStorage.warning) {
        response.relayWarning = `Relay storage at ${relayStorage.percentUsed}% capacity`;
      }
    }

    res.json(response);
  } catch (error: any) {
    console.error("Error getting tiers:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /payment-requirements/:tier
 * Get x402 payment requirements for a specific tier
 */
router.get("/payment-requirements/:tier", (req, res) => {
  try {
    const { tier } = req.params;
    const tiers = getSubscriptionTiers();

    if (!tiers[tier]) {
      return res.status(400).json({
        success: false,
        error: `Invalid tier: ${tier}. Available tiers: ${Object.keys(tiers).join(", ")}`,
      });
    }

    const merchantInstance = getMerchant();
    const requirements = merchantInstance.createPaymentRequiredResponse(tier);

    res.json({
      success: true,
      tier,
      tierInfo: tiers[tier],
      x402: requirements,
    });
  } catch (error: any) {
    console.error("Error getting payment requirements:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /requirements/custom
 * Generate custom payment requirements (Admin only)
 */
router.post("/requirements/custom", async (req, res) => {
  try {
    // Authenticate admin
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const token = bearerToken || customToken;

    if (!validateAdminToken(token)) {
      return res.status(401).json({
        success: false,
        error: "Admin authentication required",
      });
    }

    const { priceUSDC, resourceId, description } = req.body;

    if (!priceUSDC || !resourceId || !description) {
      return res.status(400).json({
        success: false,
        error: "Missing parameters: priceUSDC, resourceId, description are required",
      });
    }

    const merchant = getMerchant();
    const requirements = merchant.createCustomPaymentRequiredResponse(
      Number(priceUSDC),
      resourceId,
      description
    );

    res.json({
      success: true,
      requirements,
    });
  } catch (error: any) {
    console.error("Generate custom requirements error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /subscription/:userAddress
 * Get subscription status for a user
 */
router.get("/subscription/:userAddress", async (req, res) => {
  try {
    const { userAddress } = req.params;

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: "User address is required",
      });
    }

    const gun = getGunInstance(req);
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: "Gun instance not available",
      });
    }

    const subscription = await X402Merchant.getSubscriptionStatus(gun, userAddress);

    res.json({
      success: true,
      userAddress,
      subscription,
    });
  } catch (error: any) {
    console.error("Error getting subscription:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /subscribe
 * Purchase or renew a subscription with x402 payment
 *
 * Request body:
 * {
 *   userAddress: string,
 *   tier: 'basic' | 'standard' | 'premium',
 *   payment: PaymentPayload (x402 payment)
 * }
 */
router.post("/subscribe", async (req, res) => {
  try {
    const { userAddress, tier, payment } = req.body;

    console.log("\n--- x402 Subscription Request ---");
    console.log(`User: ${userAddress}`);
    console.log(`Tier: ${tier}`);
    console.log(`Payment provided: ${!!payment}`);
    if (payment) {
      console.log(`Payment x402Version: ${payment.x402Version}`);
      console.log(`Payment scheme: ${payment.scheme}`);
      console.log(`Payment network: ${payment.network}`);
      console.log(`Payment from: ${payment.payload?.authorization?.from}`);
      console.log(`Payment value: ${payment.payload?.authorization?.value}`);
      console.log(`Payment signature: ${payment.payload?.signature ? "present" : "missing"}`);
    }

    // Validate request
    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: "User address is required",
      });
    }

    const tiers = getSubscriptionTiers();
    if (!tier || !tiers[tier]) {
      return res.status(400).json({
        success: false,
        error: `Invalid tier: ${tier}. Available tiers: ${Object.keys(tiers).join(", ")}`,
      });
    }

    const merchantInstance = getMerchant();
    const gun = getGunInstance(req);

    if (!gun) {
      return res.status(500).json({
        success: false,
        error: "Gun instance not available",
      });
    }

    // Check if relay has enough global storage for this subscription tier
    const ipfsApiUrl = req.app.get("IPFS_API_URL") || ipfsConfig.apiUrl || "http://127.0.0.1:5001";
    const ipfsApiToken = req.app.get("IPFS_API_TOKEN") || ipfsConfig.apiToken;

    const relayCapacity = await X402Merchant.canAcceptSubscription(tier, ipfsApiUrl, ipfsApiToken);

    if (!relayCapacity.allowed) {
      console.log(`Relay storage check failed: ${relayCapacity.reason}`);
      return res.status(503).json({
        success: false,
        error: "Relay storage unavailable",
        reason: relayCapacity.reason,
        relayFull: relayCapacity.relayFull || false,
        relayStorage: relayCapacity.relayStorage
          ? {
              usedGB: relayCapacity.relayStorage.usedGB,
              maxStorageGB: relayCapacity.relayStorage.maxStorageGB,
              remainingGB: relayCapacity.relayStorage.remainingGB,
              percentUsed: relayCapacity.relayStorage.percentUsed,
            }
          : null,
      });
    }

    // Log warning if relay is getting full
    if (relayCapacity.warning) {
      console.warn(`Relay storage warning: ${relayCapacity.warning}`);
    }

    // Check if user already has an active subscription
    // New subscription can only be activated if it's better or equal to the current one
    const currentSubscription = await X402Merchant.getSubscriptionStatus(gun, userAddress);

    if (currentSubscription.active && currentSubscription.tier) {
      const currentTier = currentSubscription.tier;
      const currentTierConfig = tiers[currentTier];
      const newTierConfig = tiers[tier];

      if (!currentTierConfig || !newTierConfig) {
        return res.status(400).json({
          success: false,
          error: "Invalid tier configuration",
        });
      }

      // Compare tiers: new tier must have storageMB >= current tier
      // This ensures only upgrades or same-tier renewals are allowed
      if (newTierConfig.storageMB < currentTierConfig.storageMB) {
        const expiresAt = currentSubscription.expiresAt
          ? new Date(currentSubscription.expiresAt).toLocaleDateString()
          : "unknown";

        // Get available upgrade tiers
        const availableUpgrades = Object.entries(tiers)
          .filter(([tierName, tierCfg]) => tierCfg.storageMB >= currentTierConfig.storageMB)
          .map(([tierName, tierCfg]) => ({
            tier: tierName,
            storageMB: tierCfg.storageMB,
            priceUSDC: tierCfg.priceUSDC,
          }));

        return res.status(409).json({
          success: false,
          error: "Cannot downgrade subscription",
          message: `You already have an active ${currentTier} subscription (${currentTierConfig.storageMB}MB) that expires on ${expiresAt}. You can only activate a subscription with equal or higher storage capacity.`,
          currentSubscription: {
            tier: currentTier,
            storageMB: currentTierConfig.storageMB,
            expiresAt: currentSubscription.expiresAt,
          },
          requestedTier: {
            tier: tier,
            storageMB: newTierConfig.storageMB,
          },
          availableUpgrades: availableUpgrades,
        });
      }

      // If same or better tier, allow (will extend expiry in saveSubscription)
      console.log(
        `User has active ${currentTier} subscription, allowing ${tier} subscription (upgrade or renewal)`
      );
    }

    // If no payment provided, return payment requirements
    if (!payment) {
      console.log("No payment provided, returning requirements");
      const requirements = merchantInstance.createPaymentRequiredResponse(tier);

      // Include relay storage warning if applicable
      const response: any = {
        success: false,
        error: "Payment required",
        x402: requirements,
        tier,
        tierInfo: tiers[tier],
      };

      if (relayCapacity.warning) {
        response.relayWarning = relayCapacity.warning;
      }

      return res.status(402).json(response);
    }

    // Verify the payment
    console.log("Verifying payment...");
    const verifyResult = await merchantInstance.verifyPayment(payment, tier);

    if (!verifyResult.isValid) {
      console.log(`Payment verification failed: ${verifyResult.invalidReason}`);
      return res.status(402).json({
        success: false,
        error: "Payment verification failed",
        reason: verifyResult.invalidReason,
        x402: merchantInstance.createPaymentRequiredResponse(tier),
      });
    }

    console.log(
      `Payment verified. Payer: ${verifyResult.payer}, Amount: ${verifyResult.amount} USDC`
    );

    // Settle the payment
    console.log("Settling payment...");
    const settlement = await merchantInstance.settlePayment(payment);

    if (!settlement.success) {
      console.log(`Settlement failed: ${settlement.errorReason}`);
      return res.status(500).json({
        success: false,
        error: "Payment settlement failed",
        reason: settlement.errorReason,
      });
    }

    console.log(`Payment settled. TX: ${settlement.transaction}`);

    // Save subscription to GunDB
    console.log("Saving subscription...");
    const subscription = await X402Merchant.saveSubscription(gun, userAddress, tier, settlement);

    console.log(`Subscription saved. Expires: ${new Date(subscription.expiresAt).toISOString()}`);
    console.log("--- Subscription Complete ---\n");

    res.json({
      success: true,
      message: "Subscription activated successfully",
      subscription: {
        tier: subscription.tier,
        storageMB: subscription.storageMB,
        expiresAt: new Date(subscription.expiresAt).toISOString(),
        purchasedAt: new Date(subscription.purchasedAt).toISOString(),
      },
      payment: {
        amount: `${tiers[tier].priceUSDC} USDC`,
        transaction: settlement.transaction,
        network: settlement.network,
        explorer: settlement.explorer,
      },
    });
  } catch (error: any) {
    console.error("Subscription error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /can-upload/:userAddress
 * Check if user can upload a file of given size
 * Query params: size (in MB)
 */
router.get("/can-upload/:userAddress", async (req, res) => {
  try {
    const { userAddress } = req.params;
    const sizeMB = parseFloat(req.query.size as string) || 0;

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: "User address is required",
      });
    }

    const gun = getGunInstance(req);
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: "Gun instance not available",
      });
    }

    const result = await X402Merchant.canUpload(gun, userAddress, sizeMB);

    if (!result.allowed) {
      // If requires payment, include payment requirements
      if (result.requiresPayment) {
        try {
          const merchantInstance = getMerchant();
          result.x402 = merchantInstance.createPaymentRequiredResponse("basic");
        } catch (e: any) {
          console.warn("Could not generate payment requirements:", e.message);
        }
      }
    }

    res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error("Can upload check error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /update-usage/:userAddress
 * Update storage usage after successful upload
 * Protected: requires admin authentication
 *
 * Request body:
 * {
 *   addMB: number
 * }
 */
router.post("/update-usage/:userAddress", async (req, res) => {
  try {
    // Check admin auth
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const token = bearerToken || customToken;

    if (!validateAdminToken(token)) {
      return res.status(401).json({
        success: false,
        error: "Admin authentication required",
      });
    }

    const { userAddress } = req.params;
    const { addMB } = req.body;

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: "User address is required",
      });
    }

    if (typeof addMB !== "number" || addMB <= 0) {
      return res.status(400).json({
        success: false,
        error: "Valid addMB value is required",
      });
    }

    const gun = getGunInstance(req);
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: "Gun instance not available",
      });
    }

    const result = await X402Merchant.updateStorageUsage(gun, userAddress, addMB);

    res.json({
      success: true,
      message: "Storage usage updated",
      ...result,
    });
  } catch (error: any) {
    console.error("Update usage error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /config
 * Get x402 configuration (public info only)
 */
router.get("/config", (req, res) => {
  try {
    const payToAddress = x402Config.payToAddress;
    const network = x402Config.defaultNetwork || "base-sepolia";
    const configured = !!payToAddress;
    const chainId = x402Config.chainId;
    const facilitatorUrl = x402Config.facilitatorUrl;

    res.json({
      success: true,
      config: {
        chainId,
        paymentTokenSymbol: "USDC",
        facilitatorUrl: facilitatorUrl || null,
        network,
        payToAddress: payToAddress || null,
      },
      configured,
      network,
      payToAddress: payToAddress || null,
      tiers: Object.keys(getSubscriptionTiers()),
    });
  } catch (error: any) {
    console.error("Config error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /storage/:userAddress
 * Get real storage usage by verifying IPFS pins
 */
router.get("/storage/:userAddress", async (req, res) => {
  try {
    const { userAddress } = req.params;

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: "User address is required",
      });
    }

    const gun = getGunInstance(req);
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: "Gun instance not available",
      });
    }

    const ipfsApiUrl = req.app.get("IPFS_API_URL") || ipfsConfig.apiUrl || "http://127.0.0.1:5001";
    const ipfsApiToken = req.app.get("IPFS_API_TOKEN") || ipfsConfig.apiToken;

    console.log(`Calculating real storage for ${userAddress}...`);

    const realUsage = await X402Merchant.calculateRealStorageUsage(
      gun,
      userAddress,
      ipfsApiUrl,
      ipfsApiToken
    );
    const subscription = await X402Merchant.getSubscriptionStatus(gun, userAddress);

    res.json({
      success: true,
      userAddress,
      storage: {
        usedBytes: realUsage.totalBytes,
        usedMB: parseFloat(realUsage.totalMB.toFixed(2)),
        fileCount: realUsage.fileCount,
        verified: realUsage.verified,
      },
      subscription: subscription.active
        ? {
            tier: subscription.tier,
            totalMB: subscription.storageMB,
            remainingMB: parseFloat(
              Math.max(0, (subscription.storageMB || 0) - realUsage.totalMB).toFixed(2)
            ),
            recordedUsedMB: subscription.storageUsedMB || 0,
            discrepancy: parseFloat(
              Math.abs((subscription.storageUsedMB || 0) - realUsage.totalMB).toFixed(2)
            ),
            expiresAt: subscription.expiresAt,
          }
        : null,
      files: realUsage.files.map((f) => ({
        hash: f.hash,
        name: f.name,
        sizeMB: parseFloat(f.sizeMB.toFixed(4)),
        warning: f.warning,
      })),
    });
  } catch (error: any) {
    console.error("Storage check error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /storage/sync/:userAddress
 * Sync storage usage - verify IPFS and update GunDB
 * Protected: requires admin authentication
 */
router.post("/storage/sync/:userAddress", async (req, res) => {
  try {
    // Check admin auth
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const token = bearerToken || customToken;

    if (!validateAdminToken(token)) {
      return res.status(401).json({
        success: false,
        error: "Admin authentication required",
      });
    }

    const { userAddress } = req.params;

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: "User address is required",
      });
    }

    const gun = getGunInstance(req);
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: "Gun instance not available",
      });
    }

    const ipfsApiUrl = req.app.get("IPFS_API_URL") || ipfsConfig.apiUrl || "http://127.0.0.1:5001";
    const ipfsApiToken = req.app.get("IPFS_API_TOKEN") || ipfsConfig.apiToken;

    console.log(`Syncing storage for ${userAddress}...`);

    const syncResult = await X402Merchant.syncStorageUsage(
      gun,
      userAddress,
      ipfsApiUrl,
      ipfsApiToken
    );

    res.json({
      success: syncResult.success,
      userAddress,
      sync: {
        previousMB: parseFloat((syncResult.previousMB || 0).toFixed(2)),
        currentMB: parseFloat((syncResult.currentMB || 0).toFixed(2)),
        discrepancy: parseFloat((syncResult.discrepancy || 0).toFixed(2)),
        corrected: syncResult.corrected,
        storageRemainingMB: parseFloat((syncResult.storageRemainingMB || 0).toFixed(2)),
      },
      error: syncResult.error,
    });
  } catch (error: any) {
    console.error("Storage sync error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /can-upload-verified/:userAddress
 * Check if user can upload with real IPFS verification
 * Query params: size (in MB)
 */
router.get("/can-upload-verified/:userAddress", async (req, res) => {
  try {
    const { userAddress } = req.params;
    const sizeMB = parseFloat(req.query.size as string) || 0;

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: "User address is required",
      });
    }

    const gun = getGunInstance(req);
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: "Gun instance not available",
      });
    }

    const ipfsApiUrl = req.app.get("IPFS_API_URL") || ipfsConfig.apiUrl || "http://127.0.0.1:5001";
    const ipfsApiToken = req.app.get("IPFS_API_TOKEN") || ipfsConfig.apiToken;

    const result = await X402Merchant.canUploadVerified(
      gun,
      userAddress,
      sizeMB,
      ipfsApiUrl,
      ipfsApiToken
    );

    if (!result.allowed) {
      // If requires payment, include payment requirements
      if (result.requiresPayment) {
        try {
          const merchantInstance = getMerchant();
          result.x402 = merchantInstance.createPaymentRequiredResponse("basic");
        } catch (e: any) {
          console.warn("Could not generate payment requirements:", e.message);
        }
      }
    }

    res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error("Can upload verified check error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /relay-storage
 * Get relay's global storage status (all IPFS pins)
 * Shows total used storage vs configured maximum
 */
router.get("/relay-storage", async (req, res) => {
  try {
    const ipfsApiUrl = req.app.get("IPFS_API_URL") || ipfsConfig.apiUrl || "http://127.0.0.1:5001";
    const ipfsApiToken = req.app.get("IPFS_API_TOKEN") || ipfsConfig.apiToken;

    const relayStorage = await X402Merchant.getRelayStorageStatus(ipfsApiUrl, ipfsApiToken);

    if (!relayStorage.available) {
      return res.status(503).json({
        success: false,
        error: relayStorage.error || "Could not get relay storage status",
      });
    }

    res.json({
      success: true,
      storage: {
        unlimited: relayStorage.unlimited,
        usedMB: relayStorage.usedMB,
        usedGB: relayStorage.usedGB,
        maxStorageGB: relayStorage.maxStorageGB,
        maxStorageMB: relayStorage.maxStorageMB,
        remainingMB: relayStorage.remainingMB,
        remainingGB: relayStorage.remainingGB,
        percentUsed: relayStorage.percentUsed,
        warning: relayStorage.warning,
        warningThreshold: relayStorage.warningThreshold,
        full: relayStorage.full,
        numObjects: relayStorage.numberObjects,
      },
      message: relayStorage.full
        ? "Relay storage is FULL - no new subscriptions can be accepted"
        : relayStorage.warning
          ? `Warning: Relay storage is at ${relayStorage.percentUsed}% capacity`
          : relayStorage.unlimited
            ? "No storage limit configured"
            : "Relay storage OK",
    });
  } catch (error: any) {
    console.error("Relay storage check error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /relay-storage/detailed
 * Get detailed relay storage with all pins info (admin only)
 */
router.get("/relay-storage/detailed", async (req, res) => {
  try {
    // Check admin auth
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const token = bearerToken || customToken;

    if (!validateAdminToken(token)) {
      return res.status(401).json({
        success: false,
        error: "Admin authentication required",
      });
    }

    const ipfsApiUrl = req.app.get("IPFS_API_URL") || ipfsConfig.apiUrl || "http://127.0.0.1:5001";
    const ipfsApiToken = req.app.get("IPFS_API_TOKEN") || ipfsConfig.apiToken;

    console.log("Fetching detailed relay storage (this may take a while)...");

    // Get relay storage status
    const relayStorage = await X402Merchant.getRelayStorageStatus(ipfsApiUrl, ipfsApiToken);

    // Get all pins with sizes
    const pinsInfo = await X402Merchant.getAllPinsSize(ipfsApiUrl, ipfsApiToken);

    res.json({
      success: true,
      storage: {
        unlimited: relayStorage.unlimited,
        usedMB: relayStorage.usedMB,
        usedGB: relayStorage.usedGB,
        maxStorageGB: relayStorage.maxStorageGB,
        remainingGB: relayStorage.remainingGB,
        percentUsed: relayStorage.percentUsed,
        warning: relayStorage.warning,
        full: relayStorage.full,
      },
      pins: {
        count: pinsInfo.pinCount,
        totalMB: parseFloat(pinsInfo.totalMB?.toFixed(2) || "0"),
        totalGB: parseFloat(pinsInfo.totalGB?.toFixed(2) || "0"),
        items: pinsInfo.pins
          .map((p) => ({
            cid: p.cid,
            sizeMB: parseFloat(p.sizeMB.toFixed(4)),
          }))
          .sort((a, b) => b.sizeMB - a.sizeMB), // Sort by size desc
      },
    });
  } catch (error: any) {
    console.error("Detailed relay storage check error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/v1/x402/recommend
 *
 * Get storage recommendation (subscription vs deal) based on file size and duration.
 * This endpoint provides intelligent suggestions to help users choose the right storage model.
 */
router.get("/recommend", async (req, res) => {
  try {
    const { fileSizeMB, durationDays, userAddress } = req.query;

    if (!fileSizeMB || !durationDays) {
      return res.status(400).json({
        success: false,
        error: "fileSizeMB and durationDays are required",
      });
    }

    const sizeMB = parseFloat(fileSizeMB as string);
    const duration = parseInt(durationDays as string);

    if (isNaN(sizeMB) || sizeMB <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid fileSizeMB",
      });
    }

    if (isNaN(duration) || duration <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid durationDays",
      });
    }

    // Recommendation logic
    const recommendation: {
      recommended: string;
      reasons: string[];
      alternatives: { type: string; note: string }[];
      comparison: any;
    } = {
      recommended: "subscription", // default
      reasons: [],
      alternatives: [],
      comparison: {},
    };

    // Thresholds for recommendations
    const LARGE_FILE_THRESHOLD_MB = 100; // Files > 100MB
    const LONG_DURATION_THRESHOLD_DAYS = 365; // Duration > 1 year
    const VERY_LARGE_FILE_THRESHOLD_MB = 500; // Files > 500MB
    const MEDIUM_FILE_THRESHOLD_MB = 50; // Files > 50MB

    // Check user subscription status if address provided
    let hasActiveSubscription = false;
    let subscriptionRemainingMB = 0;

    if (userAddress) {
      try {
        const gun = req.app.get("gunInstance");
        if (gun) {
          const subStatus = await X402Merchant.getSubscriptionStatus(gun, userAddress as string);
          if (subStatus.active) {
            hasActiveSubscription = true;
            subscriptionRemainingMB = subStatus.storageRemainingMB || 0;

            // If user has subscription with enough space, recommend using it
            if (
              subscriptionRemainingMB >= sizeMB &&
              sizeMB < LARGE_FILE_THRESHOLD_MB &&
              duration <= 30
            ) {
              recommendation.recommended = "subscription";
              recommendation.reasons.push(
                `You have ${subscriptionRemainingMB.toFixed(1)}MB available in your subscription`
              );
              recommendation.reasons.push(`File fits within your subscription quota`);
              recommendation.reasons.push(`Duration is within subscription period (30 days)`);
            }
          }
        }
      } catch (error: any) {
        console.warn("Could not check subscription status:", error.message);
      }
    }

    // Decision tree for recommendations
    if (sizeMB > VERY_LARGE_FILE_THRESHOLD_MB) {
      // Very large files (>500MB) -> Deal
      recommendation.recommended = "deal";
      recommendation.reasons.push(
        `File is very large (${sizeMB.toFixed(1)}MB) - deals handle large files better`
      );
      recommendation.reasons.push(`Deals support erasure coding for large files`);
      recommendation.reasons.push(`More cost-effective for large single files`);

      if (hasActiveSubscription) {
        recommendation.alternatives.push({
          type: "subscription",
          note: "You could upgrade your subscription, but deals are more suitable for single large files",
        });
      }
    } else if (sizeMB > LARGE_FILE_THRESHOLD_MB) {
      // Large files (>100MB) -> Deal
      recommendation.recommended = "deal";
      recommendation.reasons.push(
        `File is large (${sizeMB.toFixed(1)}MB) - deals offer better pricing for large files`
      );
      recommendation.reasons.push(`Deals provide per-file guarantees and on-chain verification`);

      if (hasActiveSubscription && subscriptionRemainingMB >= sizeMB) {
        recommendation.alternatives.push({
          type: "subscription",
          note: "You could use your subscription, but deals are more cost-effective for files >100MB",
        });
      }
    } else if (duration > LONG_DURATION_THRESHOLD_DAYS) {
      // Long duration (>1 year) -> Deal
      recommendation.recommended = "deal";
      recommendation.reasons.push(
        `Long duration (${duration} days) - deals support flexible durations up to 5 years`
      );
      recommendation.reasons.push(`Deals can be renewed without losing data`);
      recommendation.reasons.push(`On-chain verification provides permanent record`);

      if (hasActiveSubscription) {
        recommendation.alternatives.push({
          type: "subscription",
          note: "Subscriptions are 30-day only - deals are better for long-term storage",
        });
      }
    } else if (sizeMB > MEDIUM_FILE_THRESHOLD_MB && duration > 90) {
      // Medium-large files with medium-long duration -> Deal
      recommendation.recommended = "deal";
      recommendation.reasons.push(
        `Combination of file size (${sizeMB.toFixed(1)}MB) and duration (${duration} days) makes deals more suitable`
      );
      recommendation.reasons.push(`Deals provide better guarantees for important files`);
    } else if (hasActiveSubscription && subscriptionRemainingMB >= sizeMB && duration <= 30) {
      // Small file, short duration, has subscription -> Subscription
      recommendation.recommended = "subscription";
      recommendation.reasons.push(
        `File fits in your subscription quota (${subscriptionRemainingMB.toFixed(1)}MB remaining)`
      );
      recommendation.reasons.push(`Duration (${duration} days) fits within subscription period`);
      recommendation.reasons.push(`No additional payment needed`);

      recommendation.alternatives.push({
        type: "deal",
        note: "You could use a deal for on-chain verification, but subscription is more convenient",
      });
    } else {
      // Default: Subscription for small/medium files with short duration
      recommendation.recommended = "subscription";
      recommendation.reasons.push(`File size (${sizeMB.toFixed(1)}MB) fits subscription tiers`);
      recommendation.reasons.push(`Duration (${duration} days) fits subscription model`);
      recommendation.reasons.push(
        `Subscription is simpler and more cost-effective for regular use`
      );

      if (sizeMB > MEDIUM_FILE_THRESHOLD_MB) {
        recommendation.alternatives.push({
          type: "deal",
          note: "Consider a deal if you need on-chain verification or longer duration",
        });
      }
    }

    // Calculate comparison costs
    try {
      // Subscription cost (monthly, but prorated for duration)
      const subscriptionTiers = getSubscriptionTiers();
      let subscriptionCost = null;
      let subscriptionTier = null;

      for (const [tierKey, tier] of Object.entries(subscriptionTiers)) {
        const tierConfig = tier as any;
        if (tierConfig.storageMB >= sizeMB) {
          subscriptionTier = tierKey;
          // Calculate cost for duration (subscriptions are monthly)
          const monthsNeeded = Math.ceil(duration / 30);
          subscriptionCost = tierConfig.priceUSDC * monthsNeeded;
          break;
        }
      }

      // Deal cost
      const dealTier = sizeMB > VERY_LARGE_FILE_THRESHOLD_MB ? "premium" : "standard";
      const dealPricing = StorageDeals.calculateDealPrice(sizeMB, duration, dealTier);
      const dealCost = dealPricing.totalPriceUSDC;

      recommendation.comparison = {
        subscription:
          subscriptionCost !== null
            ? {
                tier: subscriptionTier,
                totalCostUSDC: subscriptionCost,
                note: subscriptionTier
                  ? `${subscriptionTiers[subscriptionTier].storageMB}MB for ${Math.ceil(duration / 30)} month(s)`
                  : "No suitable tier",
              }
            : {
                tier: null,
                totalCostUSDC: null,
                note: "File too large for subscription tiers",
              },
        deal: {
          tier: dealTier,
          totalCostUSDC: dealCost,
          note: `${sizeMB.toFixed(1)}MB for ${duration} days`,
        },
      };

      // Add cost comparison to reasons
      if (
        recommendation.comparison.subscription.totalCostUSDC &&
        recommendation.comparison.deal.totalCostUSDC
      ) {
        const cheaper =
          recommendation.comparison.subscription.totalCostUSDC <
          recommendation.comparison.deal.totalCostUSDC
            ? "subscription"
            : "deal";
        const savings = Math.abs(
          recommendation.comparison.subscription.totalCostUSDC -
            recommendation.comparison.deal.totalCostUSDC
        );

        if (cheaper === recommendation.recommended) {
          recommendation.reasons.push(
            `More cost-effective: $${savings.toFixed(6)} cheaper than alternative`
          );
        }
      }
    } catch (error: any) {
      console.warn("Could not calculate cost comparison:", error.message);
    }

    res.json({
      success: true,
      recommendation,
      input: {
        fileSizeMB: sizeMB,
        durationDays: duration,
        userAddress: userAddress || null,
      },
    });
  } catch (error: any) {
    console.error("Recommendation error:", error);

    // Provide more detailed error information
    const errorResponse: any = {
      success: false,
      error: error.message || "Internal server error",
    };

    // Include stack trace in development
    if (relayConfig.environment === "development") {
      errorResponse.stack = error.stack;
    }

    // Handle specific error types
    if (error.name === "ValidationError") {
      return res.status(400).json(errorResponse);
    }

    if (error.name === "NetworkError" || error.code === "ECONNREFUSED") {
      errorResponse.error = "Failed to connect to required service";
      return res.status(503).json(errorResponse);
    }

    res.status(500).json(errorResponse);
  }
});

// Error handling wrapper for async routes
function asyncHandler(fn: any) {
  return (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      console.error("Unhandled route error:", error);

      const errorResponse: any = {
        success: false,
        error: error.message || "Internal server error",
      };

      if (relayConfig.environment === "development") {
        errorResponse.stack = error.stack;
      }

      // Don't send response if already sent
      if (!res.headersSent) {
        res.status(error.statusCode || 500).json(errorResponse);
      }
    });
  };
}

/**
 * GET /subscriptions
 * List all active subscriptions
 * Protected: requires admin authentication
 */
router.get("/subscriptions", async (req, res) => {
  try {
    // Check admin auth
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const token = bearerToken || customToken;

    if (!validateAdminToken(token)) {
      return res.status(401).json({
        success: false,
        error: "Admin authentication required",
      });
    }

    // Import lazily or assumes module is ready
    const RelayUser = await import("../utils/relay-user");

    // Check initialization
    if (!RelayUser.isRelayUserInitialized()) {
      return res.status(503).json({
        success: false,
        error: "Relay user not initialized",
      });
    }

    const subscriptions = await RelayUser.getAllSubscriptions();

    // Enrich with status checks (expired?)
    const enriched = subscriptions.map((sub) => {
      const now = Date.now();
      const expires = new Date(sub.expiresAt as string | number | Date).getTime();
      const active = expires > now;
      return {
        ...sub,
        isActive: active,
        status: active ? "active" : "expired",
      };
    });

    res.json({
      success: true,
      count: enriched.length,
      subscriptions: enriched,
    });
  } catch (error: any) {
    console.error("List subscriptions error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /history
 * List generic payments (admin only)
 */
router.get("/history", async (req, res) => {
  try {
    // Check admin auth
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const token = bearerToken || customToken;

    if (!validateAdminToken(token)) {
      return res.status(401).json({
        success: false,
        error: "Admin authentication required",
      });
    }

    const RelayUser = await import("../utils/relay-user");

    if (!RelayUser.isRelayUserInitialized()) {
      return res.status(503).json({
        success: false,
        error: "Relay user not initialized",
      });
    }

    const payments = await RelayUser.getAllPayments();

    res.json({
      success: true,
      count: payments.length,
      payments,
    });
  } catch (error: any) {
    console.error("List payments error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
