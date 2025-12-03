/**
 * x402 Payment Routes for IPFS Storage Subscriptions
 * 
 * Endpoints:
 * - GET /api/v1/x402/tiers - List available subscription tiers
 * - GET /api/v1/x402/subscription/:userAddress - Get subscription status
 * - POST /api/v1/x402/subscribe - Purchase or renew subscription
 * - GET /api/v1/x402/payment-requirements/:tier - Get payment requirements for a tier
 */

import express from 'express';
import { X402Merchant, SUBSCRIPTION_TIERS } from '../utils/x402-merchant.js';

const router = express.Router();

// Initialize X402 Merchant
let merchant = null;

function getMerchant() {
  if (!merchant) {
    const payToAddress = process.env.X402_PAY_TO_ADDRESS;
    if (!payToAddress) {
      throw new Error('X402_PAY_TO_ADDRESS not configured');
    }

    merchant = new X402Merchant({
      payToAddress,
      network: process.env.X402_NETWORK || 'base-sepolia',
      facilitatorUrl: process.env.X402_FACILITATOR_URL,
      facilitatorApiKey: process.env.X402_FACILITATOR_API_KEY,
      settlementMode: process.env.X402_SETTLEMENT_MODE || 'facilitator',
      privateKey: process.env.X402_PRIVATE_KEY,
      rpcUrl: process.env.X402_RPC_URL,
    });
  }
  return merchant;
}

// Get Gun instance helper
function getGunInstance(req) {
  return req.app.get('gunInstance');
}

/**
 * GET /tiers
 * List all available subscription tiers
 * Includes relay storage status to show availability
 */
router.get('/tiers', async (req, res) => {
  try {
    const ipfsApiUrl = req.app.get('IPFS_API_URL') || process.env.IPFS_API_URL || 'http://127.0.0.1:5001';
    const ipfsApiToken = req.app.get('IPFS_API_TOKEN') || process.env.IPFS_API_TOKEN;

    // Get relay storage status
    const relayStorage = await X402Merchant.getRelayStorageStatus(ipfsApiUrl, ipfsApiToken);

    const tiers = Object.entries(SUBSCRIPTION_TIERS).map(([key, tier]) => {
      const tierInfo = {
        id: key,
        ...tier,
        priceDisplay: `${tier.priceUSDC} USDC`,
      };

      // Check if this tier can be purchased based on relay storage
      if (relayStorage.available && !relayStorage.unlimited) {
        tierInfo.available = relayStorage.remainingMB >= tier.storageMB;
        if (!tierInfo.available) {
          tierInfo.unavailableReason = 'Relay storage insufficient';
        }
      } else {
        tierInfo.available = true;
      }

      return tierInfo;
    });

    const response = {
      success: true,
      tiers,
      network: process.env.X402_NETWORK || 'base-sepolia',
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
        response.relayWarning = 'Relay storage is FULL - subscriptions temporarily unavailable';
      } else if (relayStorage.warning) {
        response.relayWarning = `Relay storage at ${relayStorage.percentUsed}% capacity`;
      }
    }

    res.json(response);
  } catch (error) {
    console.error('Error getting tiers:', error);
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
router.get('/payment-requirements/:tier', (req, res) => {
  try {
    const { tier } = req.params;

    if (!SUBSCRIPTION_TIERS[tier]) {
      return res.status(400).json({
        success: false,
        error: `Invalid tier: ${tier}. Available tiers: ${Object.keys(SUBSCRIPTION_TIERS).join(', ')}`,
      });
    }

    const merchantInstance = getMerchant();
    const requirements = merchantInstance.createPaymentRequiredResponse(tier);

    res.json({
      success: true,
      tier,
      tierInfo: SUBSCRIPTION_TIERS[tier],
      x402: requirements,
    });
  } catch (error) {
    console.error('Error getting payment requirements:', error);
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
router.get('/subscription/:userAddress', async (req, res) => {
  try {
    const { userAddress } = req.params;

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: 'User address is required',
      });
    }

    const gun = getGunInstance(req);
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: 'Gun instance not available',
      });
    }

    const subscription = await X402Merchant.getSubscriptionStatus(gun, userAddress);

    res.json({
      success: true,
      userAddress,
      subscription,
    });
  } catch (error) {
    console.error('Error getting subscription:', error);
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
router.post('/subscribe', async (req, res) => {
  try {
    const { userAddress, tier, payment } = req.body;

    console.log('\n--- x402 Subscription Request ---');
    console.log(`User: ${userAddress}`);
    console.log(`Tier: ${tier}`);
    console.log(`Payment provided: ${!!payment}`);
    if (payment) {
      console.log(`Payment x402Version: ${payment.x402Version}`);
      console.log(`Payment scheme: ${payment.scheme}`);
      console.log(`Payment network: ${payment.network}`);
      console.log(`Payment from: ${payment.payload?.authorization?.from}`);
      console.log(`Payment value: ${payment.payload?.authorization?.value}`);
      console.log(`Payment signature: ${payment.payload?.signature ? 'present' : 'missing'}`);
    }

    // Validate request
    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: 'User address is required',
      });
    }

    if (!tier || !SUBSCRIPTION_TIERS[tier]) {
      return res.status(400).json({
        success: false,
        error: `Invalid tier: ${tier}. Available tiers: ${Object.keys(SUBSCRIPTION_TIERS).join(', ')}`,
      });
    }

    const merchantInstance = getMerchant();
    const gun = getGunInstance(req);

    if (!gun) {
      return res.status(500).json({
        success: false,
        error: 'Gun instance not available',
      });
    }

    // Check if relay has enough global storage for this subscription tier
    const ipfsApiUrl = req.app.get('IPFS_API_URL') || process.env.IPFS_API_URL || 'http://127.0.0.1:5001';
    const ipfsApiToken = req.app.get('IPFS_API_TOKEN') || process.env.IPFS_API_TOKEN;
    
    const relayCapacity = await X402Merchant.canAcceptSubscription(tier, ipfsApiUrl, ipfsApiToken);
    
    if (!relayCapacity.allowed) {
      console.log(`Relay storage check failed: ${relayCapacity.reason}`);
      return res.status(503).json({
        success: false,
        error: 'Relay storage unavailable',
        reason: relayCapacity.reason,
        relayFull: relayCapacity.relayFull || false,
        relayStorage: relayCapacity.relayStorage ? {
          usedGB: relayCapacity.relayStorage.usedGB,
          maxStorageGB: relayCapacity.relayStorage.maxStorageGB,
          remainingGB: relayCapacity.relayStorage.remainingGB,
          percentUsed: relayCapacity.relayStorage.percentUsed,
        } : null,
      });
    }

    // Log warning if relay is getting full
    if (relayCapacity.warning) {
      console.warn(`Relay storage warning: ${relayCapacity.warning}`);
    }

    // If no payment provided, return payment requirements
    if (!payment) {
      console.log('No payment provided, returning requirements');
      const requirements = merchantInstance.createPaymentRequiredResponse(tier);
      
      // Include relay storage warning if applicable
      const response = {
        success: false,
        error: 'Payment required',
        x402: requirements,
        tier,
        tierInfo: SUBSCRIPTION_TIERS[tier],
      };

      if (relayCapacity.warning) {
        response.relayWarning = relayCapacity.warning;
      }
      
      return res.status(402).json(response);
    }

    // Verify the payment
    console.log('Verifying payment...');
    const verifyResult = await merchantInstance.verifyPayment(payment, tier);

    if (!verifyResult.isValid) {
      console.log(`Payment verification failed: ${verifyResult.invalidReason}`);
      return res.status(402).json({
        success: false,
        error: 'Payment verification failed',
        reason: verifyResult.invalidReason,
        x402: merchantInstance.createPaymentRequiredResponse(tier),
      });
    }

    console.log(`Payment verified. Payer: ${verifyResult.payer}, Amount: ${verifyResult.amount} USDC`);

    // Settle the payment
    console.log('Settling payment...');
    const settlement = await merchantInstance.settlePayment(payment);

    if (!settlement.success) {
      console.log(`Settlement failed: ${settlement.errorReason}`);
      return res.status(500).json({
        success: false,
        error: 'Payment settlement failed',
        reason: settlement.errorReason,
      });
    }

    console.log(`Payment settled. TX: ${settlement.transaction}`);

    // Save subscription to GunDB
    console.log('Saving subscription...');
    const subscription = await X402Merchant.saveSubscription(gun, userAddress, tier, settlement);

    console.log(`Subscription saved. Expires: ${new Date(subscription.expiresAt).toISOString()}`);
    console.log('--- Subscription Complete ---\n');

    res.json({
      success: true,
      message: 'Subscription activated successfully',
      subscription: {
        tier: subscription.tier,
        storageMB: subscription.storageMB,
        expiresAt: new Date(subscription.expiresAt).toISOString(),
        purchasedAt: new Date(subscription.purchasedAt).toISOString(),
      },
      payment: {
        amount: `${SUBSCRIPTION_TIERS[tier].priceUSDC} USDC`,
        transaction: settlement.transaction,
        network: settlement.network,
        explorer: settlement.explorer,
      },
    });

  } catch (error) {
    console.error('Subscription error:', error);
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
router.get('/can-upload/:userAddress', async (req, res) => {
  try {
    const { userAddress } = req.params;
    const sizeMB = parseFloat(req.query.size) || 0;

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: 'User address is required',
      });
    }

    const gun = getGunInstance(req);
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: 'Gun instance not available',
      });
    }

    const result = await X402Merchant.canUpload(gun, userAddress, sizeMB);

    if (!result.allowed) {
      // If requires payment, include payment requirements
      if (result.requiresPayment) {
        try {
          const merchantInstance = getMerchant();
          result.x402 = merchantInstance.createPaymentRequiredResponse('basic');
        } catch (e) {
          console.warn('Could not generate payment requirements:', e.message);
        }
      }
    }

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Can upload check error:', error);
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
router.post('/update-usage/:userAddress', async (req, res) => {
  try {
    // Check admin auth
    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader && authHeader.split(' ')[1];
    const customToken = req.headers['token'];
    const token = bearerToken || customToken;

    if (token !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({
        success: false,
        error: 'Admin authentication required',
      });
    }

    const { userAddress } = req.params;
    const { addMB } = req.body;

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: 'User address is required',
      });
    }

    if (typeof addMB !== 'number' || addMB <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid addMB value is required',
      });
    }

    const gun = getGunInstance(req);
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: 'Gun instance not available',
      });
    }

    const result = await X402Merchant.updateStorageUsage(gun, userAddress, addMB);

    res.json({
      success: true,
      message: 'Storage usage updated',
      ...result,
    });
  } catch (error) {
    console.error('Update usage error:', error);
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
router.get('/config', (req, res) => {
  try {
    const payToAddress = process.env.X402_PAY_TO_ADDRESS;
    const network = process.env.X402_NETWORK || 'base-sepolia';
    const configured = !!payToAddress;

    res.json({
      success: true,
      configured,
      network,
      payToAddress: payToAddress || null,
      tiers: Object.keys(SUBSCRIPTION_TIERS),
    });
  } catch (error) {
    console.error('Config error:', error);
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
router.get('/storage/:userAddress', async (req, res) => {
  try {
    const { userAddress } = req.params;

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: 'User address is required',
      });
    }

    const gun = getGunInstance(req);
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: 'Gun instance not available',
      });
    }

    const ipfsApiUrl = req.app.get('IPFS_API_URL') || process.env.IPFS_API_URL || 'http://127.0.0.1:5001';
    const ipfsApiToken = req.app.get('IPFS_API_TOKEN') || process.env.IPFS_API_TOKEN;

    console.log(`Calculating real storage for ${userAddress}...`);
    
    const realUsage = await X402Merchant.calculateRealStorageUsage(gun, userAddress, ipfsApiUrl, ipfsApiToken);
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
      subscription: subscription.active ? {
        tier: subscription.tier,
        totalMB: subscription.storageMB,
        remainingMB: parseFloat(Math.max(0, subscription.storageMB - realUsage.totalMB).toFixed(2)),
        recordedUsedMB: subscription.storageUsedMB || 0,
        discrepancy: parseFloat(Math.abs((subscription.storageUsedMB || 0) - realUsage.totalMB).toFixed(2)),
        expiresAt: subscription.expiresAt,
      } : null,
      files: realUsage.files.map(f => ({
        hash: f.hash,
        name: f.name,
        sizeMB: parseFloat(f.sizeMB.toFixed(4)),
        warning: f.warning,
      })),
    });
  } catch (error) {
    console.error('Storage check error:', error);
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
router.post('/storage/sync/:userAddress', async (req, res) => {
  try {
    // Check admin auth
    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader && authHeader.split(' ')[1];
    const customToken = req.headers['token'];
    const token = bearerToken || customToken;

    if (token !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({
        success: false,
        error: 'Admin authentication required',
      });
    }

    const { userAddress } = req.params;

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: 'User address is required',
      });
    }

    const gun = getGunInstance(req);
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: 'Gun instance not available',
      });
    }

    const ipfsApiUrl = req.app.get('IPFS_API_URL') || process.env.IPFS_API_URL || 'http://127.0.0.1:5001';
    const ipfsApiToken = req.app.get('IPFS_API_TOKEN') || process.env.IPFS_API_TOKEN;

    console.log(`Syncing storage for ${userAddress}...`);
    
    const syncResult = await X402Merchant.syncStorageUsage(gun, userAddress, ipfsApiUrl, ipfsApiToken);

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
  } catch (error) {
    console.error('Storage sync error:', error);
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
router.get('/can-upload-verified/:userAddress', async (req, res) => {
  try {
    const { userAddress } = req.params;
    const sizeMB = parseFloat(req.query.size) || 0;

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: 'User address is required',
      });
    }

    const gun = getGunInstance(req);
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: 'Gun instance not available',
      });
    }

    const ipfsApiUrl = req.app.get('IPFS_API_URL') || process.env.IPFS_API_URL || 'http://127.0.0.1:5001';
    const ipfsApiToken = req.app.get('IPFS_API_TOKEN') || process.env.IPFS_API_TOKEN;

    const result = await X402Merchant.canUploadVerified(gun, userAddress, sizeMB, ipfsApiUrl, ipfsApiToken);

    if (!result.allowed) {
      // If requires payment, include payment requirements
      if (result.requiresPayment) {
        try {
          const merchantInstance = getMerchant();
          result.x402 = merchantInstance.createPaymentRequiredResponse('basic');
        } catch (e) {
          console.warn('Could not generate payment requirements:', e.message);
        }
      }
    }

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Can upload verified check error:', error);
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
router.get('/relay-storage', async (req, res) => {
  try {
    const ipfsApiUrl = req.app.get('IPFS_API_URL') || process.env.IPFS_API_URL || 'http://127.0.0.1:5001';
    const ipfsApiToken = req.app.get('IPFS_API_TOKEN') || process.env.IPFS_API_TOKEN;

    const relayStorage = await X402Merchant.getRelayStorageStatus(ipfsApiUrl, ipfsApiToken);

    if (!relayStorage.available) {
      return res.status(503).json({
        success: false,
        error: relayStorage.error || 'Could not get relay storage status',
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
        numObjects: relayStorage.numObjects,
      },
      message: relayStorage.full 
        ? 'Relay storage is FULL - no new subscriptions can be accepted'
        : relayStorage.warning 
          ? `Warning: Relay storage is at ${relayStorage.percentUsed}% capacity`
          : relayStorage.unlimited 
            ? 'No storage limit configured'
            : 'Relay storage OK',
    });
  } catch (error) {
    console.error('Relay storage check error:', error);
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
router.get('/relay-storage/detailed', async (req, res) => {
  try {
    // Check admin auth
    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader && authHeader.split(' ')[1];
    const customToken = req.headers['token'];
    const token = bearerToken || customToken;

    if (token !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({
        success: false,
        error: 'Admin authentication required',
      });
    }

    const ipfsApiUrl = req.app.get('IPFS_API_URL') || process.env.IPFS_API_URL || 'http://127.0.0.1:5001';
    const ipfsApiToken = req.app.get('IPFS_API_TOKEN') || process.env.IPFS_API_TOKEN;

    console.log('Fetching detailed relay storage (this may take a while)...');

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
        totalMB: parseFloat(pinsInfo.totalMB?.toFixed(2) || 0),
        totalGB: parseFloat(pinsInfo.totalGB?.toFixed(2) || 0),
        items: pinsInfo.pins.map(p => ({
          cid: p.cid,
          sizeMB: parseFloat(p.sizeMB.toFixed(4)),
        })).sort((a, b) => b.sizeMB - a.sizeMB), // Sort by size desc
      },
    });
  } catch (error) {
    console.error('Detailed relay storage check error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;

