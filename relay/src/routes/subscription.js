import express from 'express';
import { x402Middleware } from '../utils/x402.js';
import { subscriptionManager } from '../utils/subscriptionManager.js';

const router = express.Router();

// Configuration
const SUBSCRIPTION_PRICE = "$0.001"; // Price for subscription demo
const SUBSCRIPTION_DURATION = 7 * 24 * 60 * 60; // 7 days in seconds
const NETWORK = "base-sepolia"; // Using Sepolia testnet

router.use((req, res, next) => {
  const gun = req.app.get('gunInstance');
  if (gun) {
    subscriptionManager.init(gun);
  }
  next();
});

/**
 * POST /api/v1/subscription/subscribe
 * Request body: { serviceId: string, duration?: number }
 * Requires x402 payment in Sepolia
 */
router.post('/subscribe', 
  x402Middleware({ 
    price: SUBSCRIPTION_PRICE, 
    network: NETWORK,
    description: "Subscription service access (Sepolia)" 
  }), 
  async (req, res) => {
    const { serviceId, duration } = req.body;
    
    if (!serviceId) {
      return res.status(400).json({ error: "serviceId is required" });
    }

    const subscriptionDuration = duration || SUBSCRIPTION_DURATION;

    try {
      const subscription = await subscriptionManager.addSubscription(
        serviceId, 
        subscriptionDuration, 
        req.payment.payer
      );

      res.json({
        success: true,
        message: "Subscription activated successfully",
        subscription: {
          ...subscription,
          network: NETWORK,
          price: SUBSCRIPTION_PRICE
        }
      });
    } catch (error) {
      console.error("Subscription failed:", error);
      res.status(500).json({ error: "Failed to activate subscription" });
    }
});

/**
 * GET /api/v1/subscription/status/:serviceId
 * Check subscription status
 */
router.get('/status/:serviceId', async (req, res) => {
  try {
    const { serviceId } = req.params;
    
    if (!serviceId) {
      return res.status(400).json({ 
        status: 'error',
        error: 'serviceId is required' 
      });
    }
    
    const status = await subscriptionManager.checkSubscription(serviceId);
    
    if (!status) {
      return res.status(404).json({ 
        status: 'not_found', 
        message: 'No subscription found for this service' 
      });
    }

    res.json({
      ...status,
      network: NETWORK
    });
  } catch (error) {
    console.error("Error checking subscription status:", error);
    res.status(500).json({ 
      status: 'error',
      error: 'Failed to check subscription status',
      message: error.message 
    });
  }
});

/**
 * GET /api/v1/subscription/info
 * Get subscription service information
 */
router.get('/info', (req, res) => {
  res.json({
    success: true,
    service: {
      name: "Subscription Demo Service",
      network: NETWORK,
      price: SUBSCRIPTION_PRICE,
      defaultDuration: SUBSCRIPTION_DURATION,
      description: "Demo subscription service using x402 payments on Base Sepolia testnet"
    }
  });
});

export default router;

