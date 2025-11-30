import express from 'express';
import { x402Middleware, createPaymentRequirements } from '../utils/x402.js';
import { subscriptionManager } from '../utils/subscriptionManager.js';
import { exact } from 'x402/schemes';

const router = express.Router();

// Configuration
const SUBSCRIPTION_PRICE = "$0.001"; // Price for subscription demo
const SUBSCRIPTION_DURATION = 7 * 24 * 60 * 60; // 7 days in seconds
const NETWORK = "sepolia"; // Using Sepolia testnet

/**
 * Helper function to serialize BigInt values to strings for JSON
 * Recursively converts all BigInt values in an object/array to strings
 */
function serializeBigInts(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (typeof obj === 'bigint') {
    return obj.toString();
  }
  if (Array.isArray(obj)) {
    return obj.map(item => serializeBigInts(item));
  }
  if (typeof obj === 'object') {
    const serialized = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        serialized[key] = serializeBigInts(obj[key]);
      }
    }
    return serialized;
  }
  return obj;
}

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
      description: "Demo subscription service using x402 payments on Sepolia testnet"
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
    const paymentRequirements = [createPaymentRequirements(
      SUBSCRIPTION_PRICE,
      NETWORK,
      resource,
      "Subscription service access (Sepolia)"
    )];

    // Serialize payment requirements: convert all BigInt to string for JSON
    const serializedPaymentRequirements = serializeBigInts(paymentRequirements);

    res.json({
      success: true,
      paymentRequirements: serializedPaymentRequirements,
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
router.get('/prepare-payment', async (req, res) => {
  try {
    const resource = `${req.protocol}://${req.get('host')}${req.baseUrl}/subscribe`;
    const paymentRequirements = [createPaymentRequirements(
      SUBSCRIPTION_PRICE,
      NETWORK,
      resource,
      "Subscription service access (Sepolia)"
    )];

    const requirement = paymentRequirements[0];
    
    // Validate requirement has extra field
    if (!requirement.extra) {
      throw new Error("Payment requirement missing extra field with EIP-712 metadata");
    }
    
    // Create authorization object manually (similar to what preparePaymentHeader does)
    // Generate a random nonce (32 bytes)
    const crypto = await import('crypto');
    const nonceBytes = crypto.randomBytes(32);
    const nonce = '0x' + nonceBytes.toString('hex');
    
    // Calculate validAfter (current time) and validBefore (current time + maxTimeoutSeconds)
    const now = Math.floor(Date.now() / 1000);
    const validAfter = BigInt(now);
    const validBefore = BigInt(now + requirement.maxTimeoutSeconds);
    
    // For ETH native token, EIP-712 domain requires a valid contract address
    // x402 uses the zero address for native ETH, but EIP-712 might need a different approach
    // For now, use the asset address as verifyingContract (zero address for ETH)
    const verifyingContract = requirement.asset;
    
    // Create authorization object (from will be set by client)
    const authorization = {
      from: '0x0000000000000000000000000000000000000000', // Placeholder, will be set by client
      to: requirement.payTo,
      value: requirement.maxAmountRequired.toString(),
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce: nonce
    };

    // Serialize payment requirements: convert all BigInt to string for JSON
    const serializedPaymentRequirements = serializeBigInts(paymentRequirements);

    const response = {
      success: true,
      paymentRequirements: serializedPaymentRequirements,
      authorization: authorization,
      // Include the domain and types for EIP-712 signing
      domain: {
        name: requirement.extra.name || "Ether",
        version: requirement.extra.version || "1",
        chainId: 11155111, // Sepolia
        verifyingContract: verifyingContract
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
    };

    res.json(response);
  } catch (error) {
    console.error("Error preparing payment:", error);
    res.status(500).json({ 
      success: false,
      error: "Failed to prepare payment",
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
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
    
    // Ensure nonce is in the correct format (bytes32 as hex string)
    let nonce = authorization.nonce;
    if (!nonce.startsWith('0x')) {
      nonce = '0x' + nonce;
    }
    // Ensure nonce is exactly 66 characters (0x + 64 hex chars = 32 bytes)
    if (nonce.length !== 66) {
      throw new Error(`Invalid nonce length: ${nonce.length}, expected 66 (0x + 64 hex chars)`);
    }
    
    // Create the exact EVM payload structure
    const payload = {
      signature: signature,
      authorization: {
        from: from.toLowerCase(), // Ensure lowercase
        to: authorization.to.toLowerCase(), // Ensure lowercase
        value: authorization.value.toString(), // Ensure string
        validAfter: authorization.validAfter.toString(), // Ensure string
        validBefore: authorization.validBefore.toString(), // Ensure string
        nonce: nonce
      }
    };

    console.log('🔍 Creating payment with payload:', JSON.stringify(payload, null, 2));

    // Create payment object in the format expected by x402
    const payment = {
      x402Version: 1,
      scheme: requirement.scheme,
      network: requirement.network,
      payload: payload
    };

    console.log('🔍 Payment object:', JSON.stringify(payment, null, 2));

    // Encode the payment header
    let paymentHeader;
    try {
      paymentHeader = exact.evm.encodePayment(payment);
      console.log('✅ Payment header encoded successfully, length:', paymentHeader.length);
    } catch (error) {
      console.error('❌ Error encoding payment:', error);
      throw error;
    }
    
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
      console.log('🔍 Payment header set from body:', req.body.paymentHeader.substring(0, 50) + '...');
    } else {
      console.log('⚠️ No payment header in request body');
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

