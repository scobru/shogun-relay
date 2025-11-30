import { exact } from "x402/schemes";
import {
  processPriceToAtomicAmount,
  findMatchingPaymentRequirements
} from "x402/shared";
import { useFacilitator } from "x402/verify";

// Configuration
// Use local facilitator if available, otherwise fallback to public facilitator
// Local facilitator runs at /api/v1/x402-facilitator
// We construct the local URL dynamically based on request context
function getFacilitatorUrl(req = null) {
  if (process.env.FACILITATOR_URL) {
    return process.env.FACILITATOR_URL;
  }
  
  // Try to use local facilitator
  // If we have request context, use it to construct the URL
  if (req) {
    const protocol = req.protocol || 'http';
    const host = req.get('host') || `${process.env.RELAY_HOST || 'localhost'}:${process.env.RELAY_PORT || 8765}`;
    return `${protocol}://${host}/api/v1/x402-facilitator`;
  }
  
  // Fallback: try to construct from env vars
  if (process.env.RELAY_HOST) {
    const port = process.env.RELAY_PORT || 8765;
    return `http://${process.env.RELAY_HOST}:${port}/api/v1/x402-facilitator`;
  }
  
  // Last resort: use public facilitator
  return "https://x402.org/facilitator";
}

// Default facilitator URL (will be overridden in middleware if request is available)
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://x402.org/facilitator";
const WALLET_ADDRESS = process.env.WALLET_ADDRESS; // Must be set in .env
const X402_VERSION = 1;

if (!WALLET_ADDRESS) {
  console.warn("WARNING: WALLET_ADDRESS not set in .env. x402 payments will fail.");
}

// Create facilitator instance - URL will be set per-request
let facilitatorInstance = null;

function getFacilitator(req = null) {
  const url = getFacilitatorUrl(req);
  // Create new instance if URL changed or doesn't exist
  if (!facilitatorInstance || facilitatorInstance.url !== url) {
    facilitatorInstance = useFacilitator({ url });
  }
  return facilitatorInstance;
}

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

/**
 * Creates payment requirements for a given price and network
 * @param {string} price - Price string (e.g. "$0.01")
 * @param {string} network - Network identifier (e.g. "base", "sepolia")
 * @param {string} resource - Resource URL or identifier
 * @param {string} description - Description of the charge
 */
export function createPaymentRequirements(price, network, resource, description = "") {
  if (!WALLET_ADDRESS) throw new Error("WALLET_ADDRESS not configured");

  // For Sepolia, x402 doesn't support "sepolia" network identifier
  // We create payment requirements manually for ETH native token
  // Price is in USD format (e.g., "$0.001") - convert to ETH wei
  // Using approximate ETH price: 1 ETH = $3000
  // In production, fetch current ETH price from an oracle
  
  const priceInUSD = parseFloat(price.replace('$', '').replace(',', ''));
  const ethPriceUSD = 3000; // Approximate - should be fetched from oracle in production
  const ethAmount = priceInUSD / ethPriceUSD;
  const weiAmount = BigInt(Math.floor(ethAmount * 1e18));
  
  // For native ETH on Sepolia, use zero address
  const asset = {
    address: "0x0000000000000000000000000000000000000000",
    eip712: {
      name: "Ether",
      version: "1"
    }
  };

  // x402 network identifier mapping
  // x402 supports: "base", "base-sepolia", "ethereum", etc.
  // It does NOT support Ethereum Sepolia (chainId 11155111)
  let networkIdentifier = network;
  if (network === "sepolia" || network === "11155111") {
    // Ethereum Sepolia is not supported by x402
    // Map to default network from env or "base-sepolia"
    const defaultNetwork = process.env.X402_NETWORK || "base-sepolia";
    networkIdentifier = defaultNetwork;
    console.warn(`⚠️ x402 does not support Ethereum Sepolia. Using "${defaultNetwork}" network instead.`);
  }
  
  return {
    scheme: "exact",
    network: networkIdentifier, // Use mapped network identifier
    maxAmountRequired: weiAmount,
    resource,
    description,
    mimeType: "application/json",
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
    const { price, network = "sepolia", description = "Access to resource" } = options;
    
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
      const serializedRequirements = serializeBigInts(paymentRequirements);
      return res.status(402).json({
        x402Version: X402_VERSION,
        error: "X-PAYMENT header is required",
        accepts: serializedRequirements,
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
      // Serialize BigInt values before sending JSON response
      const serializedRequirements = serializeBigInts(paymentRequirements);
      return res.status(402).json({
        x402Version: X402_VERSION,
        error: "Invalid or malformed payment header: " + error.message,
        accepts: serializedRequirements,
      });
    }

    // Verify payment
    try {
      // Normalize network identifiers for matching
      // x402 might return chainId while we use "sepolia" in requirements
      const normalizedDecodedPayment = {
        ...decodedPayment,
        network: decodedPayment.network === "11155111" ? "sepolia" : decodedPayment.network
      };
      
      // Try to find matching requirement with normalized network
      let selectedPaymentRequirement = findMatchingPaymentRequirements(
        paymentRequirements, 
        normalizedDecodedPayment
      );
      
      // If no match, try with original decoded payment
      if (!selectedPaymentRequirement) {
        selectedPaymentRequirement = findMatchingPaymentRequirements(
          paymentRequirements, 
          decodedPayment
        ) || paymentRequirements[0];
      }
      
      console.log('🔍 x402Middleware - Selected payment requirement:', {
        scheme: selectedPaymentRequirement.scheme,
        network: selectedPaymentRequirement.network,
        maxAmountRequired: selectedPaymentRequirement.maxAmountRequired,
        payTo: selectedPaymentRequirement.payTo,
        asset: selectedPaymentRequirement.asset
      });
      
      // Get facilitator instance with request context for local facilitator
      const facilitator = getFacilitator(req);
      const facilitatorUrl = getFacilitatorUrl(req);
      
      console.log('🔍 x402Middleware - Calling facilitator verify...');
      console.log('🔍 x402Middleware - Facilitator URL:', facilitatorUrl);
      
      let response;
      try {
        response = await facilitator.verify(decodedPayment, selectedPaymentRequirement);
      } catch (verifyError) {
        console.error('❌ x402Middleware - Facilitator verification error:', verifyError.message);
        console.error('❌ x402Middleware - Error code:', verifyError.code);
        console.error('❌ x402Middleware - Error cause:', verifyError.cause);
        
        // Check if it's a network/DNS error
        const isNetworkError = verifyError.code === 'ENOTFOUND' || 
                              verifyError.cause?.code === 'ENOTFOUND' ||
                              verifyError.message?.includes('fetch failed');
        
        // If facilitator is unreachable, we can't verify the payment
        // Return 402 with serialized payment requirements
        const serializedRequirements = serializeBigInts(paymentRequirements);
        const errorMessage = isNetworkError 
          ? `Facilitator unavailable (${facilitatorUrl}). Network error: ${verifyError.message}. Please check your network connection or facilitator URL.`
          : `Facilitator verification failed: ${verifyError.message}`;
        
        return res.status(402).json({
          x402Version: X402_VERSION,
          error: errorMessage,
          accepts: serializedRequirements,
        });
      }
      
      console.log('🔍 x402Middleware - Verification response:', {
        isValid: response.isValid,
        invalidReason: response.invalidReason,
        payer: response.payer
      });
      
      if (!response.isValid) {
        console.error('❌ x402Middleware - Payment verification failed:', response.invalidReason);
        // Serialize BigInt values in payment requirements before sending JSON response
        const serializedRequirements = serializeBigInts(paymentRequirements);
        return res.status(402).json({
          x402Version: X402_VERSION,
          error: response.invalidReason || "Payment verification failed",
          accepts: serializedRequirements,
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
        const settlement = await facilitator.settle(decodedPayment, selectedPaymentRequirement);
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
      // Serialize BigInt values before sending JSON response
      const serializedRequirements = serializeBigInts(paymentRequirements);
      return res.status(402).json({
        x402Version: X402_VERSION,
        error: "Payment verification failed: " + error.message,
        accepts: serializedRequirements,
      });
    }
  };
};
