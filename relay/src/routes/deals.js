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
import crypto from 'crypto';
import multer from 'multer';
import FormData from 'form-data';
import * as StorageDeals from '../utils/storage-deals.js';
import * as ErasureCoding from '../utils/erasure-coding.js';
import * as FrozenData from '../utils/frozen-data.js';
import { getRelayUser, getRelayPub } from '../utils/relay-user.js';
import { X402Merchant } from '../utils/x402-merchant.js';
import { createRegistryClientWithSigner } from '../utils/registry-client.js';

const router = express.Router();
const IPFS_API_TOKEN = process.env.IPFS_API_TOKEN;

// In-memory cache for recently created deals (GunDB sync can be slow)
// Deals are cached for 10 minutes to allow time for payment
const pendingDealsCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function cacheDeal(deal) {
  pendingDealsCache.set(deal.id, {
    deal,
    cachedAt: Date.now()
  });
  
  // Clean expired entries
  for (const [id, entry] of pendingDealsCache) {
    if (Date.now() - entry.cachedAt > CACHE_TTL) {
      pendingDealsCache.delete(id);
    }
  }
}

function getCachedDeal(dealId) {
  const entry = pendingDealsCache.get(dealId);
  if (entry && Date.now() - entry.cachedAt < CACHE_TTL) {
    return entry.deal;
  }
  pendingDealsCache.delete(dealId);
  return null;
}

function removeCachedDeal(dealId) {
  pendingDealsCache.delete(dealId);
}

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

    // Check if relay user has SEA keys
    const keyPair = relayUser?._.sea;
    if (!keyPair) {
      console.error('Relay user SEA keys not available');
      return res.status(503).json({
        success: false,
        error: 'Relay authentication not ready',
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
    await StorageDeals.saveDeal(gun, deal, keyPair);
    
    // Cache deal for quick activation (GunDB sync can be slow)
    cacheDeal(deal);
    console.log(`📝 Deal ${deal.id} created and cached for ${deal.cid}`);
    
    // Get network config for domain info
    const network = process.env.X402_NETWORK || 'base-sepolia';
    const NETWORK_CONFIG = {
      'base-sepolia': { usdcName: 'USDC', usdcVersion: '2' },
      'base': { usdcName: 'USD Coin', usdcVersion: '2' },
    };
    const networkConfig = NETWORK_CONFIG[network] || NETWORK_CONFIG['base-sepolia'];
    
    // Create x402 payment requirements
    const paymentRequirements = {
      x402Version: 1,
      scheme: 'exact',
      network,
      maxAmountRequired: Math.ceil(pricing.totalPriceUSDC * 1000000).toString(), // USDC atomic units
      resource: `storage-deal-${deal.id}`,
      description: `Storage Deal: ${sizeMB}MB for ${durationDays} days (${tier})`,
      payTo: process.env.X402_PAY_TO_ADDRESS,
      dealId: deal.id,
      // EIP-712 domain info for signing
      domainName: networkConfig.usdcName,
      domainVersion: networkConfig.usdcVersion,
    };
    
    // Return 200 OK - deal created successfully, payment needed to activate
    res.json({
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
    console.error('Deal creation error:', error.message);
    console.error('Deal creation stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      hint: 'Check server logs for details'
    });
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
    
    // Get existing deal (check cache first, then GunDB)
    let deal = getCachedDeal(dealId);
    
    if (!deal) {
      // Try GunDB if not in cache
      deal = await StorageDeals.getDeal(gun, dealId);
    }
    
    if (!deal) {
      console.log(`❌ Deal not found: ${dealId}`);
      return res.status(404).json({
        success: false,
        error: 'Deal not found. It may have expired or was never created.',
      });
    }
    
    console.log(`✅ Deal found: ${dealId} (status: ${deal.status})`)
    
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
    
    console.log('Payment received:', {
      from: payment?.payload?.authorization?.from,
      to: payment?.payload?.authorization?.to,
      amount: payment?.payload?.authorization?.value,
      signature: payment?.payload?.signature ? `${payment.payload.signature.substring(0, 10)}...` : 'missing'
    });
    
    const merchant = new X402Merchant({
      payToAddress,
      network,
      settlementMode: process.env.X402_SETTLEMENT_MODE || 'facilitator',
      facilitatorUrl: process.env.X402_FACILITATOR_URL,
      privateKey: process.env.X402_PRIVATE_KEY,
    });
    
    // Verify the payment amount
    const requiredAmountAtomic = Math.ceil(deal.pricing.totalPriceUSDC * 1000000);
    console.log(`Verifying deal payment: required ${requiredAmountAtomic} atomic units (${deal.pricing.totalPriceUSDC} USDC)`);
    
    const verification = await merchant.verifyDealPayment(payment, requiredAmountAtomic);
    
    if (!verification.isValid) {
      console.log(`❌ Payment verification failed: ${verification.invalidReason}`);
      return res.status(402).json({
        success: false,
        error: `Payment verification failed: ${verification.invalidReason}`,
      });
    }
    
    console.log(`✅ Payment verified: ${verification.amount} USDC from ${verification.payer}`);
    
    // Settle payment
    console.log('Attempting to settle payment...');
    const settlement = await merchant.settlePayment(payment);
    
    if (!settlement.success) {
      console.log(`❌ Settlement failed: ${settlement.errorReason}`);
      return res.status(402).json({
        success: false,
        error: `Payment settlement failed: ${settlement.errorReason}`,
        hint: settlement.errorReason?.includes('not configured') 
          ? 'Configure X402_PRIVATE_KEY for direct settlement or ensure facilitator is available'
          : 'Check server logs for details',
      });
    }
    
    console.log(`✅ Payment settled successfully. TX: ${settlement.transaction}`);
    
    // Activate deal
    const txHash = settlement.transaction;
    console.log(`Activating deal ${dealId} with TX: ${txHash}`);
    
    const activatedDeal = StorageDeals.activateDeal(deal, txHash);
    console.log(`Deal activated object created, status: ${activatedDeal.status}`);
    
    // Save updated deal
    let saveWarning = null;
    try {
      await StorageDeals.saveDeal(gun, activatedDeal, relayUser._.sea);
      console.log(`✅ Deal saved to GunDB successfully`);
    } catch (saveError) {
      console.error(`⚠️ Error saving activated deal to GunDB:`, saveError.message);
      saveWarning = 'Payment processed successfully, but there was a temporary issue saving the deal. It will be retried automatically.';
      // Still continue - payment was successful
    }
    
    // Remove from pending cache since it's now activated
    removeCachedDeal(dealId);
    
    // Update cache with activated deal for immediate access
    cacheDeal(activatedDeal);
    
    console.log(`✅ Deal ${dealId} activated. CID: ${deal.cid}, TX: ${txHash}`);
    
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
      message: saveWarning || 'Deal activated successfully',
      warning: saveWarning || undefined,
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
    const normalizedAddress = address.toLowerCase();
    
    // Get deals from GunDB
    const gunDeals = await StorageDeals.getDealsByClient(gun, address);
    
    // Also check cache for deals matching this client
    const cachedDeals = [];
    for (const [dealId, entry] of pendingDealsCache) {
      const deal = entry.deal;
      if (deal.clientAddress && deal.clientAddress.toLowerCase() === normalizedAddress) {
        cachedDeals.push(deal);
      }
    }
    
    // Merge and deduplicate (cache takes precedence for same deal ID)
    const dealMap = new Map();
    
    // Add GunDB deals first
    for (const deal of gunDeals) {
      dealMap.set(deal.id, deal);
    }
    
    // Override with cached deals (they're more recent)
    for (const deal of cachedDeals) {
      dealMap.set(deal.id, deal);
    }
    
    const deals = Array.from(dealMap.values());
    const stats = StorageDeals.getDealStats(deals);
    
    console.log(`Found ${deals.length} deals for client ${address} (${gunDeals.length} from GunDB, ${cachedDeals.length} from cache)`);
    
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
    
    // Check cache first, then GunDB
    let deal = getCachedDeal(dealId);
    if (!deal) {
      deal = await StorageDeals.getDeal(gun, dealId);
    }
    
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
        error: `Payment failed: ${settlement.errorReason}`,
      });
    }
    
    // Renew deal
    const renewedDeal = StorageDeals.renewDeal(deal, parseInt(additionalDays), settlement.transaction);
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
 * GET /api/v1/deals/:dealId/verify
 * 
 * Verify that a deal's file is actually stored on the relay.
 * Checks storage proof for the CID.
 */
router.get('/:dealId/verify', async (req, res) => {
  try {
    const { dealId } = req.params;
    const gun = req.app.get('gunInstance');
    const ipfs = req.app.get('ipfs');
    
    if (!gun) {
      return res.status(503).json({ success: false, error: 'Gun not available' });
    }
    
    if (!ipfs) {
      return res.status(503).json({ success: false, error: 'IPFS client not available' });
    }
    
    // Get deal
    let deal = getCachedDeal(dealId);
    if (!deal) {
      deal = await StorageDeals.getDeal(gun, dealId);
    }
    
    if (!deal) {
      return res.status(404).json({ success: false, error: 'Deal not found' });
    }
    
    // Only verify active deals
    if (deal.status !== StorageDeals.DEAL_STATUS.ACTIVE) {
      return res.status(400).json({ 
        success: false, 
        error: `Deal is ${deal.status}, cannot verify` 
      });
    }
    
    const cid = deal.cid;
    
    // Verify CID exists in IPFS
    let ipfsStat;
    let ipfsExists = false;
    try {
      ipfsStat = await ipfs.block.stat(cid);
      ipfsExists = true;
    } catch (error) {
      console.log(`❌ CID ${cid} not found in IPFS:`, error.message);
      ipfsExists = false;
    }
    
    // Check if pinned
    let isPinned = false;
    try {
      const pins = await ipfs.pin.ls();
      for await (const pin of pins) {
        if (pin.cid.toString() === cid) {
          isPinned = true;
          break;
        }
      }
    } catch (error) {
      console.warn('Error checking pin status:', error.message);
    }
    
    // Try to fetch a small sample of data
    let canRead = false;
    let readError = null;
    try {
      const chunks = [];
      for await (const chunk of ipfs.cat(cid, { length: 1024 })) {
        chunks.push(chunk);
        break; // Just check first chunk
      }
      canRead = chunks.length > 0;
    } catch (error) {
      readError = error.message;
      canRead = false;
    }
    
    const verification = {
      dealId,
      cid,
      verified: ipfsExists && isPinned && canRead,
      timestamp: Date.now(),
      checks: {
        existsInIPFS: ipfsExists,
        isPinned: isPinned,
        canRead: canRead,
        blockSize: ipfsExists ? ipfsStat.size : null,
      },
      issues: [],
    };
    
    if (!ipfsExists) {
      verification.issues.push('CID not found in IPFS');
    }
    if (!isPinned) {
      verification.issues.push('CID is not pinned');
    }
    if (!canRead) {
      verification.issues.push(`Cannot read content: ${readError || 'unknown error'}`);
    }
    
    res.json({
      success: true,
      verification,
    });
  } catch (error) {
    console.error('Deal verification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/deals/:dealId/verify-proof
 * 
 * Challenge the relay to provide a storage proof for a deal.
 * Similar to network/proof but deal-specific.
 */
router.get('/:dealId/verify-proof', async (req, res) => {
  try {
    const { dealId } = req.params;
    const challenge = req.query.challenge || crypto.randomBytes(16).toString('hex');
    
    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(503).json({ success: false, error: 'Gun not available' });
    }
    
    // Get deal
    let deal = getCachedDeal(dealId);
    if (!deal) {
      deal = await StorageDeals.getDeal(gun, dealId);
    }
    
    if (!deal) {
      return res.status(404).json({ success: false, error: 'Deal not found' });
    }
    
    // Redirect to network proof endpoint
    const proofUrl = `/api/v1/network/proof/${deal.cid}?challenge=${challenge}`;
    
    // Forward request internally
    const http = req.app.get('httpServer');
    if (!http) {
      return res.status(503).json({ success: false, error: 'HTTP server not available' });
    }
    
    // Use the existing proof endpoint logic
    const ipfs = req.app.get('ipfs');
    if (!ipfs) {
      return res.status(503).json({ success: false, error: 'IPFS client not available' });
    }
    
    const cid = deal.cid;
    
    // Verify CID exists
    let blockStat;
    try {
      blockStat = await ipfs.block.stat(cid);
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: 'CID not found on this relay',
        cid,
        dealId,
      });
    }
    
    // Get content sample
    let contentSample = null;
    try {
      const chunks = [];
      for await (const chunk of ipfs.cat(cid, { length: 256 })) {
        chunks.push(chunk);
        break;
      }
      if (chunks.length > 0) {
        contentSample = Buffer.concat(chunks).toString('base64');
      }
    } catch (error) {
      console.warn('Could not read content sample:', error.message);
    }
    
    // Check if pinned
    let isPinned = false;
    try {
      const pins = await ipfs.pin.ls();
      for await (const pin of pins) {
        if (pin.cid.toString() === cid) {
          isPinned = true;
          break;
        }
      }
    } catch (error) {
      console.warn('Error checking pin status:', error.message);
    }
    
    // Generate proof hash
    const timestamp = Date.now();
    const proofData = `${cid}:${challenge}:${timestamp}:${blockStat.size}`;
    const proofHash = crypto.createHash('sha256').update(proofData).digest('hex');
    
    const relayPub = req.app.get('relayUserPub');
    
    res.json({
      success: true,
      proof: {
        dealId,
        cid,
        challenge,
        timestamp,
        proofHash,
        relayPub: relayPub || null,
        block: {
          size: blockStat.size,
        },
        contentSampleBase64: contentSample,
        isPinned,
        verification: {
          method: 'sha256(cid:challenge:timestamp:size)',
          validFor: 300000, // 5 minutes
          expiresAt: timestamp + 300000,
        },
      },
    });
  } catch (error) {
    console.error('Deal proof verification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/deals/:dealId/cancel
 * 
 * Cancel/terminate your own deal.
 * Client can only cancel their own deals.
 */
router.post('/:dealId/cancel', express.json(), async (req, res) => {
  try {
    const gun = req.app.get('gunInstance');
    const relayUser = getRelayUser();
    
    if (!gun || !relayUser) {
      return res.status(503).json({ success: false, error: 'Relay not initialized' });
    }
    
    const { dealId } = req.params;
    const { clientAddress, reason = 'User requested cancellation' } = req.body;
    
    if (!clientAddress) {
      return res.status(400).json({ success: false, error: 'clientAddress is required' });
    }
    
    // Get deal (check cache first)
    let deal = getCachedDeal(dealId);
    if (!deal) {
      deal = await StorageDeals.getDeal(gun, dealId);
    }
    
    if (!deal) {
      return res.status(404).json({ success: false, error: 'Deal not found' });
    }
    
    // Verify ownership
    if (deal.clientAddress.toLowerCase() !== clientAddress.toLowerCase()) {
      return res.status(403).json({ 
        success: false, 
        error: 'You can only cancel your own deals' 
      });
    }
    
    // Only allow cancellation if deal is pending or active
    if (deal.status === StorageDeals.DEAL_STATUS.TERMINATED) {
      return res.status(400).json({ 
        success: false, 
        error: 'Deal is already terminated' 
      });
    }
    
    const terminatedDeal = StorageDeals.terminateDeal(deal, reason);
    await StorageDeals.saveDeal(gun, terminatedDeal, relayUser._.sea);
    
    // Update cache
    cacheDeal(terminatedDeal);
    
    console.log(`✅ Deal ${dealId} cancelled by client ${clientAddress}`);
    
    res.json({
      success: true,
      deal: {
        id: terminatedDeal.id,
        status: terminatedDeal.status,
        terminatedAt: terminatedDeal.terminatedAt,
      },
      message: 'Deal cancelled successfully',
    });
  } catch (error) {
    console.error('Deal cancellation error:', error);
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
    
    // Check cache first
    let deal = getCachedDeal(dealId);
    if (!deal) {
      deal = await StorageDeals.getDeal(gun, dealId);
    }
    
    if (!deal) {
      return res.status(404).json({ success: false, error: 'Deal not found' });
    }
    
    const terminatedDeal = StorageDeals.terminateDeal(deal, reason);
    await StorageDeals.saveDeal(gun, terminatedDeal, relayUser._.sea);
    
    // Update cache
    cacheDeal(terminatedDeal);
    
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

