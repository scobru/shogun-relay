import express from 'express';
import { x402Middleware, createPaymentRequirements } from '../utils/x402.js';
import { subscriptionManager } from '../utils/subscriptionManager.js';
import { exact } from 'x402/schemes';

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

/**
 * GET /api/v1/subscription/payment-requirements
 * Get payment requirements for creating payment header
 */
router.get('/payment-requirements', (req, res) => {
  try {
    const resource = `${req.protocol}://${req.get('host')}${req.baseUrl}/subscribe`;
    const paymentRequirements = createPaymentRequirements(
      SUBSCRIPTION_PRICE,
      NETWORK,
      resource,
      "Subscription service access (Sepolia)"
    );

    res.json({
      success: true,
      paymentRequirements: [paymentRequirements],
      network: NETWORK,
      price: SUBSCRIPTION_PRICE
    });
  } catch (error) {
    console.error("Error creating payment requirements:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to create payment requirements",
      message: error.message 
    });
  }
});

/**
 * GET /api/v1/subscription/prepare-payment
 * Prepare payment data for signing (returns authorization data to sign)
 * Returns the authorization object that needs to be signed
 */
router.get('/prepare-payment', (req, res) => {
  try {
    const resource = `${req.protocol}://${req.get('host')}${req.baseUrl}/subscribe`;
    const paymentRequirements = [createPaymentRequirements(
      SUBSCRIPTION_PRICE,
      NETWORK,
      resource,
      "Subscription service access (Sepolia)"
    )];

    // Prepare payment header data using x402
    // This returns the authorization object that needs to be signed
    const prepared = exact.evm.preparePaymentHeader(
      null, // from address (will be set by client)
      1, // x402Version
      paymentRequirements
    );

    res.json({
      success: true,
      paymentRequirements: paymentRequirements,
      authorization: prepared.authorization,
      // Include the domain and types for EIP-712 signing
      domain: {
        name: paymentRequirements[0].extra.name,
        version: paymentRequirements[0].extra.version,
        chainId: 84532, // Base Sepolia
        verifyingContract: paymentRequirements[0].asset
      },
      types: {
        Authorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' }
        ]
      }
    });
  } catch (error) {
    console.error("Error preparing payment:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to prepare payment",
      message: error.message 
    });
  }
});

/**
 * POST /api/v1/subscription/create-payment-header
 * Create payment header using x402 client (server-side)
 * Request body: { paymentRequirements: array, authorization: object, signature: string, from: string }
 * Returns the properly encoded payment header
 */
router.post('/create-payment-header', async (req, res) => {
  try {
    const { paymentRequirements, authorization, signature, from } = req.body;
    
    if (!paymentRequirements || !Array.isArray(paymentRequirements) || paymentRequirements.length === 0) {
      return res.status(400).json({ error: "paymentRequirements array is required" });
    }
    
    if (!authorization) {
      return res.status(400).json({ error: "authorization object is required" });
    }
    
    if (!signature) {
      return res.status(400).json({ error: "signature is required" });
    }
    
    if (!from) {
      return res.status(400).json({ error: "from address is required" });
    }

    const requirement = paymentRequirements[0];
    
    // Create the exact EVM payload structure
    const payload = {
      signature: signature,
      authorization: {
        from: from,
        to: authorization.to,
        value: authorization.value,
        validAfter: authorization.validAfter,
        validBefore: authorization.validBefore,
        nonce: authorization.nonce
      }
    };

    // Create payment object in the format expected by x402
    const payment = {
      x402Version: 1,
      scheme: requirement.scheme,
      network: requirement.network,
      payload: payload
    };

    // Encode the payment header
    const paymentHeader = exact.evm.encodePayment(payment);
    
    res.json({
      success: true,
      paymentHeader: paymentHeader
    });
  } catch (error) {
    console.error("Error creating payment header:", error);
    res.status(500).json({ 
      error: "Failed to create payment header",
      message: error.message 
    });
  }
});

/**
 * POST /api/v1/subscription/subscribe-with-payment-header
 * Subscribe using a pre-created payment header
 * Request body: { serviceId: string, paymentHeader: string, duration?: number }
 * This endpoint accepts a payment header created using x402 client
 */
router.post('/subscribe-with-payment-header', 
  async (req, res, next) => {
    // Manually set the X-PAYMENT header from request body
    if (req.body.paymentHeader) {
      req.headers['x-payment'] = req.body.paymentHeader;
    }
    next();
  },
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
  }
);

export default router;

