/**
 * Storage Deals Routes
 * 
 * API endpoints for per-file storage deals.
 * Works alongside (not replacing) the subscription system.
 * 
 * Features:
 * - Create storage deals with x402 payment
 * - Erasure coding for redundancy
 * - Multi-relay replication
 * - Deal lifecycle management
 */

import express from 'express';
import http from 'http';
import multer from 'multer';
import FormData from 'form-data';
import * as StorageDeals from '../utils/storage-deals.js';
import * as ErasureCoding from '../utils/erasure-coding.js';
import * as FrozenData from '../utils/frozen-data.js';
import { getRelayUser, getRelayPub } from '../utils/relay-user.js';
import { X402Merchant } from '../utils/x402-merchant.js';

const router = express.Router();
const IPFS_API_TOKEN = process.env.IPFS_API_TOKEN;

// Configure multer for deal uploads
const dealUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max for deal uploads
  }
});

/**
 * GET /api/v1/deals/pricing
 * 
 * Get pricing information for storage deals.
 */
router.get('/pricing', (req, res) => {
  try {
    const { sizeMB, durationDays, tier } = req.query;
    
    // If parameters provided, calculate specific price
    const size = parseFloat(sizeMB);
    const duration = parseInt(durationDays);
    
    if (size > 0 && duration > 0) {
      const pricing = StorageDeals.calculateDealPrice(
        size,
        duration,
        tier || 'standard'
      );
      
      return res.json({
        success: true,
        pricing,
      });
    }
    
    // Return general pricing info (when params missing or invalid)
    res.json({
      success: true,
      tiers: StorageDeals.PRICING,
      note: 'Prices are in USDC. Add ?sizeMB=X&durationDays=Y&tier=Z for specific quote.',
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/deals/upload
 * 
 * Upload a file to IPFS for deal creation.
 * This endpoint allows uploads without subscription - payment is via deal.
 * Requires wallet address for tracking.
 */
router.post('/upload', dealUpload.single('file'), async (req, res) => {
  try {
    const walletAddress = req.headers['x-wallet-address'] || req.body.walletAddress;
    
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Wallet address required (x-wallet-address header or walletAddress body param)'
      });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file provided' });
    }

    console.log(`📤 Deal upload: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB) from ${walletAddress}`);

    // Upload to IPFS
    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    const uploadOptions = {
      hostname: '127.0.0.1',
      port: 5001,
      path: '/api/v0/add?pin=true',
      method: 'POST',
      headers: form.getHeaders(),
    };

    if (IPFS_API_TOKEN) {
      uploadOptions.headers['Authorization'] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsResult = await new Promise((resolve, reject) => {
      const ipfsReq = http.request(uploadOptions, (ipfsRes) => {
        let data = '';
        ipfsRes.on('data', chunk => data += chunk);
        ipfsRes.on('end', () => {
          if (ipfsRes.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error('Failed to parse IPFS response'));
            }
          } else {
            reject(new Error(`IPFS returned ${ipfsRes.statusCode}`));
          }
        });
      });

      ipfsReq.on('error', reject);
      ipfsReq.setTimeout(60000, () => {
        ipfsReq.destroy();
        reject(new Error('Upload timeout'));
      });

      form.pipe(ipfsReq);
    });

    const cid = ipfsResult.Hash;
    const sizeMB = (req.file.size / (1024 * 1024)).toFixed(2);

    console.log(`✅ Deal upload success: ${cid} (${sizeMB} MB)`);

    res.json({
      success: true,
      cid,
      name: req.file.originalname,
      sizeMB: parseFloat(sizeMB),
      sizeBytes: req.file.size,
      walletAddress,
      note: 'File uploaded. Create a deal to ensure long-term storage.',
    });
  } catch (error) {
    console.error('❌ Deal upload error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/deals/overhead
 * 
 * Calculate erasure coding overhead for a file size.
 */
router.get('/overhead', (req, res) => {
  try {
    const sizeMB = parseFloat(req.query.sizeMB) || 1;
    const sizeBytes = sizeMB * 1024 * 1024;
    
    const overhead = ErasureCoding.calculateOverhead(sizeBytes);
    
    res.json({
      success: true,
      overhead: {
        ...overhead,
        originalSizeMB: sizeMB,
        totalSizeMB: Math.round((overhead.totalSize / (1024 * 1024)) * 100) / 100,
      },
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/deals/create
 * 
 * Create a new storage deal.
 * Returns payment requirements for x402.
 */
router.post('/create', express.json(), async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    const relayUser = getRelayUser();
    const relayPub = getRelayPub();
    
    if (!gun || !relayUser || !relayPub) {
      return res.status(503).json({
        success: false,
        error: 'Relay not fully initialized',
      });
    }
    
    const {
      cid,
      clientAddress,
      sizeMB,
      durationDays,
      tier = 'standard',
      erasureMetadata = null,
    } = req.body;
    
    // Validate required fields
    if (!cid || !clientAddress || !sizeMB || !durationDays) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: cid, clientAddress, sizeMB, durationDays',
      });
    }
    
    // Calculate pricing
    const pricing = StorageDeals.calculateDealPrice(
      parseFloat(sizeMB),
      parseInt(durationDays),
      tier
    );
    
    // Create deal (pending payment)
    const deal = StorageDeals.createDeal({
      cid,
      clientAddress,
      providerPub: relayPub,
      sizeMB: parseFloat(sizeMB),
      durationDays: parseInt(durationDays),
      tier,
      erasureMetadata,
    });
    
    // Save to GunDB (frozen)
    await StorageDeals.saveDeal(gun, deal, relayUser._.sea);
    
    // Create x402 payment requirements
    const paymentRequirements = {
      x402Version: 1,
      scheme: 'exact',
      network: process.env.X402_NETWORK || 'base-sepolia',
      maxAmountRequired: Math.ceil(pricing.totalPriceUSDC * 1000000).toString(), // USDC atomic units
      resource: `storage-deal-${deal.id}`,
      description: `Storage Deal: ${sizeMB}MB for ${durationDays} days (${tier})`,
      payTo: process.env.X402_PAY_TO_ADDRESS,
      dealId: deal.id,
    };
    
    res.status(402).json({
      success: true,
      deal: {
        id: deal.id,
        status: deal.status,
        pricing: deal.pricing,
        cid: deal.cid,
      },
      paymentRequired: paymentRequirements,
      message: 'Deal created. Complete payment to activate.',
    });
  } catch (error) {
    console.error('Deal creation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/deals/:dealId/activate
 * 
 * Activate a deal after payment.
 */
router.post('/:dealId/activate', express.json(), async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    const relayUser = getRelayUser();
    
    if (!gun || !relayUser) {
      return res.status(503).json({
        success: false,
        error: 'Relay not fully initialized',
      });
    }
    
    const { dealId } = req.params;
    const { payment } = req.body;
    
    if (!payment) {
      return res.status(400).json({
        success: false,
        error: 'Payment data required',
      });
    }
    
    // Get existing deal
    const deal = await StorageDeals.getDeal(gun, dealId);
    
    if (!deal) {
      return res.status(404).json({
        success: false,
        error: 'Deal not found',
      });
    }
    
    if (deal.status !== StorageDeals.DEAL_STATUS.PENDING) {
      return res.status(400).json({
        success: false,
        error: `Deal is not pending. Current status: ${deal.status}`,
      });
    }
    
    // Verify payment using x402
    const payToAddress = process.env.X402_PAY_TO_ADDRESS;
    const network = process.env.X402_NETWORK || 'base-sepolia';
    
    if (!payToAddress) {
      return res.status(503).json({
        success: false,
        error: 'Relay not configured for payments',
      });
    }
    
    const merchant = new X402Merchant({
      payToAddress,
      network,
      settlementMode: process.env.X402_SETTLEMENT_MODE || 'facilitator',
      facilitatorUrl: process.env.X402_FACILITATOR_URL,
      privateKey: process.env.X402_PRIVATE_KEY,
    });
    
    // Verify the payment amount
    const requiredAmount = Math.ceil(deal.pricing.totalPriceUSDC * 1000000);
    const verification = await merchant.verifyPaymentAmount(payment, requiredAmount);
    
    if (!verification.isValid) {
      return res.status(402).json({
        success: false,
        error: `Payment verification failed: ${verification.invalidReason}`,
      });
    }
    
    // Settle payment
    const settlement = await merchant.settlePayment(payment);
    
    if (!settlement.success) {
      return res.status(402).json({
        success: false,
        error: `Payment settlement failed: ${settlement.error}`,
      });
    }
    
    // Activate deal
    const activatedDeal = StorageDeals.activateDeal(deal, settlement.txHash);
    
    // Save updated deal
    await StorageDeals.saveDeal(gun, activatedDeal, relayUser._.sea);
    
    console.log(`✅ Deal ${dealId} activated. CID: ${deal.cid}`);
    
    res.json({
      success: true,
      deal: {
        id: activatedDeal.id,
        status: activatedDeal.status,
        cid: activatedDeal.cid,
        activatedAt: activatedDeal.activatedAt,
        expiresAt: activatedDeal.expiresAt,
        paymentTx: activatedDeal.paymentTx,
      },
      message: 'Deal activated successfully',
    });
  } catch (error) {
    console.error('Deal activation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/deals/by-cid/:cid
 * 
 * Get all deals for a CID.
 * NOTE: Must be defined before /:dealId to avoid route conflict
 */
router.get('/by-cid/:cid', async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(503).json({ success: false, error: 'Gun not available' });
    }
    
    const { cid } = req.params;
    const deals = await StorageDeals.getDealsByCid(gun, cid);
    
    res.json({
      success: true,
      cid,
      count: deals.length,
      deals,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/deals/by-client/:address
 * 
 * Get all deals for a client address.
 * NOTE: Must be defined before /:dealId to avoid route conflict
 */
router.get('/by-client/:address', async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(503).json({ success: false, error: 'Gun not available' });
    }
    
    const { address } = req.params;
    const deals = await StorageDeals.getDealsByClient(gun, address);
    const stats = StorageDeals.getDealStats(deals);
    
    res.json({
      success: true,
      clientAddress: address,
      stats,
      deals,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/deals/relay/active
 * 
 * Get active deals for this relay.
 * Admin only.
 * NOTE: Must be defined before /:dealId to avoid route conflict
 */
router.get('/relay/active', async (req, res) => {
  try {
    // Check admin auth
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1] || req.headers['token'];
    if (token !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    
    const gun = req.app.get('gunInstance');
    const relayPub = getRelayPub();
    
    if (!gun || !relayPub) {
      return res.status(503).json({ success: false, error: 'Relay not initialized' });
    }
    
    const deals = await StorageDeals.getActiveDealsForRelay(gun, relayPub);
    const stats = StorageDeals.getDealStats(deals);
    
    res.json({
      success: true,
      relayPub,
      stats,
      activeDeals: deals,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/deals/:dealId
 * 
 * Get deal information.
 * NOTE: This must be AFTER all specific routes to avoid conflicts
 */
router.get('/:dealId', async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(503).json({ success: false, error: 'Gun not available' });
    }
    
    const { dealId } = req.params;
    const deal = await StorageDeals.getDeal(gun, dealId);
    
    if (!deal) {
      return res.status(404).json({
        success: false,
        error: 'Deal not found',
      });
    }
    
    // Check if expired
    const isExpired = StorageDeals.isDealExpired(deal);
    const needsRenewal = StorageDeals.needsRenewal(deal);
    
    res.json({
      success: true,
      deal,
      status: {
        isExpired,
        needsRenewal,
        daysRemaining: deal.expiresAt 
          ? Math.max(0, Math.ceil((deal.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)))
          : null,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/deals/:dealId/renew
 * 
 * Renew an existing deal.
 */
router.post('/:dealId/renew', express.json(), async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    const relayUser = getRelayUser();
    
    if (!gun || !relayUser) {
      return res.status(503).json({ success: false, error: 'Relay not initialized' });
    }
    
    const { dealId } = req.params;
    const { additionalDays, payment } = req.body;
    
    if (!additionalDays) {
      return res.status(400).json({
        success: false,
        error: 'additionalDays required',
      });
    }
    
    const deal = await StorageDeals.getDeal(gun, dealId);
    
    if (!deal) {
      return res.status(404).json({ success: false, error: 'Deal not found' });
    }
    
    // Calculate renewal price
    const renewalPricing = StorageDeals.calculateRenewalPrice(deal, parseInt(additionalDays));
    
    // If no payment, return payment requirements
    if (!payment) {
      return res.status(402).json({
        success: true,
        renewalPricing,
        paymentRequired: {
          x402Version: 1,
          scheme: 'exact',
          network: process.env.X402_NETWORK || 'base-sepolia',
          maxAmountRequired: Math.ceil(renewalPricing.totalPriceUSDC * 1000000).toString(),
          resource: `deal-renewal-${dealId}`,
          description: `Renewal: ${additionalDays} additional days`,
          payTo: process.env.X402_PAY_TO_ADDRESS,
        },
      });
    }
    
    // Verify and settle payment (similar to activate)
    const merchant = new X402Merchant({
      payToAddress: process.env.X402_PAY_TO_ADDRESS,
      network: process.env.X402_NETWORK || 'base-sepolia',
      settlementMode: process.env.X402_SETTLEMENT_MODE || 'facilitator',
      facilitatorUrl: process.env.X402_FACILITATOR_URL,
      privateKey: process.env.X402_PRIVATE_KEY,
    });
    
    const settlement = await merchant.settlePayment(payment);
    
    if (!settlement.success) {
      return res.status(402).json({
        success: false,
        error: `Payment failed: ${settlement.error}`,
      });
    }
    
    // Renew deal
    const renewedDeal = StorageDeals.renewDeal(deal, parseInt(additionalDays), settlement.txHash);
    await StorageDeals.saveDeal(gun, renewedDeal, relayUser._.sea);
    
    res.json({
      success: true,
      deal: {
        id: renewedDeal.id,
        status: renewedDeal.status,
        expiresAt: renewedDeal.expiresAt,
        durationDays: renewedDeal.durationDays,
      },
      message: `Deal renewed for ${additionalDays} additional days`,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/deals/:dealId/terminate
 * 
 * Terminate a deal early.
 * Admin only.
 */
router.post('/:dealId/terminate', express.json(), async (req, res) => {
  try {
    // Check admin auth
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1] || req.headers['token'];
    if (token !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    
    const gun = req.app.get('gunInstance');
    const relayUser = getRelayUser();
    
    if (!gun || !relayUser) {
      return res.status(503).json({ success: false, error: 'Relay not initialized' });
    }
    
    const { dealId } = req.params;
    const { reason = 'Admin termination' } = req.body;
    
    const deal = await StorageDeals.getDeal(gun, dealId);
    
    if (!deal) {
      return res.status(404).json({ success: false, error: 'Deal not found' });
    }
    
    const terminatedDeal = StorageDeals.terminateDeal(deal, reason);
    await StorageDeals.saveDeal(gun, terminatedDeal, relayUser._.sea);
    
    res.json({
      success: true,
      deal: {
        id: terminatedDeal.id,
        status: terminatedDeal.status,
        terminatedAt: terminatedDeal.terminatedAt,
      },
      message: 'Deal terminated',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

