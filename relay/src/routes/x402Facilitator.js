import express from 'express';
import { verify, settle } from 'x402/facilitator';
import {
  PaymentRequirementsSchema,
  PaymentPayloadSchema,
  createConnectedClient,
  createSigner,
  SupportedEVMNetworks,
  SupportedSVMNetworks,
  isSvmSignerWallet,
} from 'x402/types';

const router = express.Router();

// Get private keys from environment
const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || '';
const SVM_PRIVATE_KEY = process.env.SVM_PRIVATE_KEY || '';
const SVM_RPC_URL = process.env.SVM_RPC_URL || '';

// X402 config with custom RPC URL if provided
const x402Config = SVM_RPC_URL
  ? { svmConfig: { rpcUrl: SVM_RPC_URL } }
  : undefined;

/**
 * GET /api/v1/x402-facilitator/verify
 * Info endpoint for verify
 */
router.get('/verify', (req, res) => {
  res.json({
    endpoint: '/verify',
    description: 'POST to verify x402 payments',
    body: {
      paymentPayload: 'PaymentPayload',
      paymentRequirements: 'PaymentRequirements',
    },
  });
});

/**
 * POST /api/v1/x402-facilitator/verify
 * Verify x402 payment
 */
router.post('/verify', async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;

    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({ 
        error: 'Missing paymentPayload or paymentRequirements' 
      });
    }

    // Parse and validate schemas
    const parsedRequirements = PaymentRequirementsSchema.parse(paymentRequirements);
    const parsedPayload = PaymentPayloadSchema.parse(paymentPayload);

    console.log('🔍 Facilitator verify - Network:', parsedRequirements.network);
    console.log('🔍 Facilitator verify - Scheme:', parsedRequirements.scheme);

    // Use the correct client/signer based on the requested network
    // SVM verify requires a Signer because it signs & simulates the txn
    let client;
    if (SupportedEVMNetworks.includes(parsedRequirements.network)) {
      // For EVM, we can use a connected client (no private key needed for verify)
      client = createConnectedClient(parsedRequirements.network);
      console.log('✅ Using EVM connected client for network:', parsedRequirements.network);
    } else if (SupportedSVMNetworks.includes(parsedRequirements.network)) {
      // For SVM, we need a signer
      if (!SVM_PRIVATE_KEY) {
        throw new Error('SVM_PRIVATE_KEY required for SVM network verification');
      }
      client = await createSigner(parsedRequirements.network, SVM_PRIVATE_KEY);
      console.log('✅ Using SVM signer for network:', parsedRequirements.network);
    } else {
      throw new Error(`Unsupported network: ${parsedRequirements.network}`);
    }

    // Verify the payment
    const result = await verify(client, parsedPayload, parsedRequirements, x402Config);
    
    console.log('✅ Facilitator verify result:', {
      isValid: result.isValid,
      invalidReason: result.invalidReason,
      payer: result.payer
    });

    res.json(result);
  } catch (error) {
    console.error('❌ Facilitator verify error:', error);
    res.status(400).json({ 
      error: 'Invalid request',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/v1/x402-facilitator/settle
 * Info endpoint for settle
 */
router.get('/settle', (req, res) => {
  res.json({
    endpoint: '/settle',
    description: 'POST to settle x402 payments',
    body: {
      paymentPayload: 'PaymentPayload',
      paymentRequirements: 'PaymentRequirements',
    },
  });
});

/**
 * POST /api/v1/x402-facilitator/settle
 * Settle x402 payment
 */
router.post('/settle', async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;

    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({ 
        error: 'Missing paymentPayload or paymentRequirements' 
      });
    }

    // Parse and validate schemas
    const parsedRequirements = PaymentRequirementsSchema.parse(paymentRequirements);
    const parsedPayload = PaymentPayloadSchema.parse(paymentPayload);

    console.log('🔍 Facilitator settle - Network:', parsedRequirements.network);
    console.log('🔍 Facilitator settle - Scheme:', parsedRequirements.scheme);

    // Use the correct private key based on the requested network
    let signer;
    if (SupportedEVMNetworks.includes(parsedRequirements.network)) {
      if (!EVM_PRIVATE_KEY) {
        throw new Error('EVM_PRIVATE_KEY or WALLET_PRIVATE_KEY required for EVM network settlement');
      }
      signer = await createSigner(parsedRequirements.network, EVM_PRIVATE_KEY);
      console.log('✅ Using EVM signer for network:', parsedRequirements.network);
    } else if (SupportedSVMNetworks.includes(parsedRequirements.network)) {
      if (!SVM_PRIVATE_KEY) {
        throw new Error('SVM_PRIVATE_KEY required for SVM network settlement');
      }
      signer = await createSigner(parsedRequirements.network, SVM_PRIVATE_KEY);
      console.log('✅ Using SVM signer for network:', parsedRequirements.network);
    } else {
      throw new Error(`Unsupported network: ${parsedRequirements.network}`);
    }

    // Settle the payment
    const result = await settle(signer, parsedPayload, parsedRequirements, x402Config);
    
    console.log('✅ Facilitator settle result:', {
      success: result.success,
      txHash: result.txHash,
      error: result.error
    });

    res.json(result);
  } catch (error) {
    console.error('❌ Facilitator settle error:', error);
    res.status(400).json({ 
      error: 'Invalid request',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/v1/x402-facilitator/supported
 * Get supported payment kinds
 */
router.get('/supported', async (req, res) => {
  try {
    const kinds = [];

    // EVM networks
    if (EVM_PRIVATE_KEY) {
      // Add supported EVM networks
      const evmNetworks = ['base', 'base-sepolia', 'ethereum'];
      for (const network of evmNetworks) {
        if (SupportedEVMNetworks.includes(network)) {
          kinds.push({
            x402Version: 1,
            scheme: 'exact',
            network: network,
          });
        }
      }
    }

    // SVM networks
    if (SVM_PRIVATE_KEY) {
      try {
        const signer = await createSigner('solana-devnet', SVM_PRIVATE_KEY);
        const feePayer = isSvmSignerWallet(signer) ? signer.address : undefined;

        kinds.push({
          x402Version: 1,
          scheme: 'exact',
          network: 'solana-devnet',
          extra: {
            feePayer,
          },
        });
      } catch (error) {
        console.warn('⚠️ Could not create SVM signer:', error.message);
      }
    }

    res.json({ kinds });
  } catch (error) {
    console.error('❌ Facilitator supported error:', error);
    res.status(500).json({ 
      error: 'Failed to get supported kinds',
      message: error.message
    });
  }
});

export default router;

