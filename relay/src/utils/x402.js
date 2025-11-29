import { exact } from "x402/schemes";
import {
  processPriceToAtomicAmount,
  findMatchingPaymentRequirements
} from "x402/shared";
import { useFacilitator } from "x402/verify";

// Configuration
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://facilitator.x402.org";
const WALLET_ADDRESS = process.env.WALLET_ADDRESS; // Must be set in .env
const X402_VERSION = 1;

if (!WALLET_ADDRESS) {
  console.warn("WARNING: WALLET_ADDRESS not set in .env. x402 payments will fail.");
}

const { verify, settle } = useFacilitator({ url: FACILITATOR_URL });

/**
 * Creates payment requirements for a given price and network
 * @param {string} price - Price string (e.g. "$0.01")
 * @param {string} network - Network identifier (e.g. "base", "base-sepolia")
 * @param {string} resource - Resource URL or identifier
 * @param {string} description - Description of the charge
 */
export function createPaymentRequirements(price, network, resource, description = "") {
  if (!WALLET_ADDRESS) throw new Error("WALLET_ADDRESS not configured");

  const atomicAmountForAsset = processPriceToAtomicAmount(price, network);
  if ("error" in atomicAmountForAsset) {
    throw new Error(atomicAmountForAsset.error);
  }
  const { maxAmountRequired, asset } = atomicAmountForAsset;

  return {
    scheme: "exact",
    network,
    maxAmountRequired,
    resource,
    description,
    mimeType: "",
    payTo: WALLET_ADDRESS,
    maxTimeoutSeconds: 60,
    asset: asset.address,
    outputSchema: undefined,
    extra: {
      name: asset.eip712.name,
      version: asset.eip712.version,
    },
  };
}

/**
 * Express middleware to verify x402 payment
 * @param {object} options - Options { price, network, description }
 */
export const x402Middleware = (options) => {
  return async (req, res, next) => {
    const { price, network = "base-sepolia", description = "Access to resource" } = options;
    
    // Construct resource ID from request
    const resource = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    
    let paymentRequirements;
    try {
      paymentRequirements = [
        createPaymentRequirements(price, network, resource, description)
      ];
    } catch (err) {
      console.error("Error creating payment requirements:", err);
      return res.status(500).json({ error: "Server configuration error" });
    }

    const paymentHeader = req.header("X-PAYMENT") || req.header("x-payment");
    
    console.log('🔍 x402Middleware - Payment header present:', !!paymentHeader);
    if (paymentHeader) {
      console.log('🔍 x402Middleware - Payment header length:', paymentHeader.length);
      console.log('🔍 x402Middleware - Payment header preview:', paymentHeader.substring(0, 100));
    }
    
    // If no payment header, return 402 with requirements
    if (!paymentHeader) {
      console.log('⚠️ x402Middleware - No payment header found');
      return res.status(402).json({
        x402Version: X402_VERSION,
        error: "X-PAYMENT header is required",
        accepts: paymentRequirements,
      });
    }

    // Decode payment
    let decodedPayment;
    try {
      console.log('🔍 x402Middleware - Attempting to decode payment header...');
      decodedPayment = exact.evm.decodePayment(paymentHeader);
      decodedPayment.x402Version = X402_VERSION;
      console.log('✅ x402Middleware - Payment decoded successfully');
      console.log('🔍 x402Middleware - Decoded payment scheme:', decodedPayment.scheme);
      console.log('🔍 x402Middleware - Decoded payment network:', decodedPayment.network);
    } catch (error) {
      console.error('❌ x402Middleware - Payment decode error:', error.message);
      console.error('❌ x402Middleware - Payment decode stack:', error.stack);
      return res.status(402).json({
        x402Version: X402_VERSION,
        error: "Invalid or malformed payment header: " + error.message,
        accepts: paymentRequirements,
      });
    }

    // Verify payment
    try {
      const selectedPaymentRequirement =
        findMatchingPaymentRequirements(paymentRequirements, decodedPayment) ||
        paymentRequirements[0];
      
      console.log('🔍 x402Middleware - Selected payment requirement:', {
        scheme: selectedPaymentRequirement.scheme,
        network: selectedPaymentRequirement.network,
        maxAmountRequired: selectedPaymentRequirement.maxAmountRequired,
        payTo: selectedPaymentRequirement.payTo,
        asset: selectedPaymentRequirement.asset
      });
      
      console.log('🔍 x402Middleware - Calling facilitator verify...');
      const response = await verify(decodedPayment, selectedPaymentRequirement);
      
      console.log('🔍 x402Middleware - Verification response:', {
        isValid: response.isValid,
        invalidReason: response.invalidReason,
        payer: response.payer
      });
      
      if (!response.isValid) {
        console.error('❌ x402Middleware - Payment verification failed:', response.invalidReason);
        return res.status(402).json({
          x402Version: X402_VERSION,
          error: response.invalidReason || "Payment verification failed",
          accepts: paymentRequirements,
          payer: response.payer,
        });
      }
      
      console.log('✅ x402Middleware - Payment verified successfully, payer:', response.payer);
      
      // Attach payment info to request for downstream use
      req.payment = {
        payer: response.payer,
        amount: selectedPaymentRequirement.maxAmountRequired,
        token: selectedPaymentRequirement.asset
      };
      
      // Settle payment and add response header
      try {
        const settlement = await settle(decodedPayment, selectedPaymentRequirement);
        if (settlement && settlement.success !== false) {
          // Add settlement response header
          const settlementHeader = Buffer.from(JSON.stringify(settlement)).toString('base64');
          res.setHeader('X-PAYMENT-RESPONSE', settlementHeader);
          res.setHeader('Access-Control-Expose-Headers', 'X-PAYMENT-RESPONSE');
        }
      } catch (settleError) {
        // Log settlement error but don't block the request
        // Payment is already verified, settlement is best-effort
        console.error("Payment settlement failed (non-blocking):", settleError);
      }
      
      next();
      
    } catch (error) {
      console.error("Payment verification failed:", error);
      return res.status(402).json({
        x402Version: X402_VERSION,
        error: "Payment verification failed",
        accepts: paymentRequirements,
      });
    }
  };
};
