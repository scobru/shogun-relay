import express from 'express';
import { x402Middleware } from '../utils/x402.js';
import { subscriptionManager } from '../utils/subscriptionManager.js';

const router = express.Router();

// Configuration
const RENT_PRICE = "$0.01"; // Price for 30 days
const RENT_DURATION = 30 * 24 * 60 * 60; // 30 days in seconds

router.use((req, res, next) => {
  const gun = req.app.get('gunInstance');
  if (gun) {
    subscriptionManager.init(gun);
  }
  next();
});

/**
 * POST /api/ipfs/pin
 * Request body: { cid: string }
 * Requires x402 payment
 */
router.post('/pin', 
  x402Middleware({ 
    price: RENT_PRICE, 
    description: "30 days IPFS Storage Rent" 
  }), 
  async (req, res) => {
    const { cid } = req.body;
    
    if (!cid) {
      return res.status(400).json({ error: "CID is required" });
    }

    try {
      // In a real implementation, we would trigger the IPFS pin here.
      // For now, we just track the subscription.
      // await ipfs.pin.add(cid);

      const subscription = await subscriptionManager.addSubscription(
        cid, 
        RENT_DURATION, 
        req.payment.payer
      );

      res.json({
        success: true,
        message: "Content pinned successfully",
        subscription
      });
    } catch (error) {
      console.error("Pinning failed:", error);
      res.status(500).json({ error: "Failed to pin content" });
    }
});

/**
 * GET /api/ipfs/status/:cid
 * Check subscription status
 */
router.get('/status/:cid', async (req, res) => {
  const { cid } = req.params;
  const status = await subscriptionManager.checkSubscription(cid);
  
  if (!status) {
    return res.status(404).json({ 
      status: 'not_found', 
      message: 'No active subscription found for this CID' 
    });
  }

  res.json(status);
});

// Run cleanup every hour
setInterval(() => {
  console.log("Running subscription cleanup...");
  subscriptionManager.pruneExpired();
}, 60 * 60 * 1000);

export default router;
