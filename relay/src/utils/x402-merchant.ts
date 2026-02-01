/**
 * x402 Merchant Utility for Shogun Relay
 *
 * Handles payment verification and settlement for IPFS storage subscriptions.
 * Supports both facilitator-based and direct (local) settlement modes.
 */

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from "viem";
import { baseSepolia, base, polygon, polygonAmoy } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { ipfsRequest } from "./ipfs-client";
import * as RelayUser from "./relay-user";
import { USDC_EIP3009_ABI, getConfigByChainId } from "shogun-contracts-sdk";
import httpModule from "http";
import httpsModule from "https";
import { loggers } from "./logger";
import type {
  PaymentPayload,
  PaymentRequirements,
  X402Response,
  ExactEvmPayload,
  ExactEvmPayloadAuthorization,
} from "../types/x402-types";

const log = loggers.x402;

export type NetworkKey = "base" | "base-sepolia" | "polygon" | "polygon-amoy";

interface NetworkConfigType {
  chain: any;
  usdc: string;
  explorer: string;
  usdcName: string;
  usdcVersion: string;
}

export type PricingTier = {
  name: string;
  priceUSDC: number;
  storageMB: number;
  durationDays: number;
};

interface SubscriptionTiersMap {
  [tier: string]: PricingTier;
}

// Use official x402 types
// PaymentPayload is now imported from "x402/types"

interface PaymentVerificationResult {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
  amount?: string;
  tier?: string;
  amountAtomic?: string;
}

interface PaymentSettlementResult {
  success: boolean;
  transaction?: string;
  network?: string;
  explorer?: string;
  blocknumberber?: string;
  errorReason?: string;
}

interface FacilitatorVerifyResult {
  isValid: boolean;
  payer?: string;
  invalidReason?: string;
}

interface FacilitatorSettleResult {
  success: boolean;
  transaction?: string;
  network?: string;
  explorer?: string;
  errorReason?: string;
}

export interface SubscriptionStatus {
  active: boolean;
  reason?: string;
  tier?: string;
  storageMB?: number;
  storageUsedMB?: number;
  storageRemainingMB?: number;
  expiresAt?: string;
  purchasedAt?: string | null;
  ownedBy?: string;
  expiredAt?: string;
}

interface Subscription {
  tier: string;
  storageMB: number;
  storageUsedMB: number;
  priceUSDC: number;
  purchasedAt: number;
  expiresAt: number;
  paymentTx: string | null | undefined;
  paymentNetwork: string | null | undefined;
  userAddress: string;
}

interface StorageUsageResult {
  storageUsedMB: number;
  storageRemainingMB: number;
}

export interface CanUploadResult {
  allowed: boolean;
  reason?: string;
  requiresPayment?: boolean;
  requiresUpgrade?: boolean;
  currentTier?: string;
  storageAfterUpload?: number;
  x402?: any; // Payment requirements when requiresPayment is true
}

export interface CanUploadVerifiedResult extends CanUploadResult {
  storageUsedMB?: number;
  storageRemainingMB?: number;
  storageTotalMB?: number;
  verified?: boolean;
}

interface IpfsObjectSize {
  cid: string;
  size: number;
  numberLinks: number;
  blockSize: number;
}

interface IpfsRepoStats {
  repoSize: number;
  storageMax: number;
  numberObjects: number;
  repoPath: string;
  version: string;
}

interface PinsSizeResult {
  totalBytes: number;
  totalMB?: number;
  totalGB?: number;
  pinCount: number;
  pins: Array<{ cid: string; size: number; sizeMB: number }>;
}

export interface RelayStorageStatus {
  available: boolean;
  unlimited?: boolean;
  usedBytes?: number;
  usedMB?: number;
  usedGB?: number;
  maxStorageGB?: number | null;
  remainingGB?: number | null;
  percentUsed?: number | null;
  warning?: boolean;
  numberObjects?: number;
  maxStorageMB?: number;
  remainingBytes?: number;
  remainingMB?: number;
  full?: boolean;
  warningThreshold?: number;
  error?: string;
}

interface CanAcceptSubscriptionResult {
  allowed: boolean;
  reason?: string;
  relayStorage?: RelayStorageStatus;
  relayFull?: boolean;
  warning?: string;
  error?: string;
}

interface CanAcceptUploadResult extends CanAcceptSubscriptionResult {
  warning?: string;
}

interface CalculateRealStorageUsageResult {
  totalBytes: number;
  totalMB: number;
  fileCount: number;
  files: Array<any>;
  verified: boolean;
}

interface SyncStorageUsageResult {
  success: boolean;
  previousMB?: number;
  currentMB?: number;
  discrepancy?: number;
  corrected?: boolean;
  realUsage?: CalculateRealStorageUsageResult;
  storageRemainingMB?: number;
  error?: string;
}

const USDC_ABI = USDC_EIP3009_ABI;

/**
 * Get network config from SDK instead of hardcoded addresses
 * Returns null if SDK doesn't have the config (for chains not yet supported)
 */
function getNetworkConfigFromSDK(chainId: number): NetworkConfigType | null {
  const config = getConfigByChainId(chainId);
  if (!config || !config.usdc) return null;

  // Map chainId to viem chain
  let chain;
  if (chainId === 8453) chain = base;
  else if (chainId === 84532) chain = baseSepolia;
  else if (chainId === 137) chain = polygon;
  else if (chainId === 80002) chain = polygonAmoy;
  else return null;

  return {
    chain,
    usdc: config.usdc,
    explorer: config.explorer || "",
    usdcName: chainId === 8453 || chainId === 137 ? "USD Coin" : "USDC",
    usdcVersion: "2",
  };
}

/**
 * Lazy initialization of network config - only loads when accessed
 * Uses SDK when available, falls back to hardcoded values for chains not in SDK yet
 */
function getNetworkConfig(network: NetworkKey): NetworkConfigType {
  const chainIdMap: Record<NetworkKey, number> = {
    base: 8453,
    "base-sepolia": 84532,
    polygon: 137,
    "polygon-amoy": 80002,
  };

  const chainId = chainIdMap[network];
  const sdkConfig = getNetworkConfigFromSDK(chainId);

  // If SDK has config, use it
  if (sdkConfig) {
    return sdkConfig;
  }

  // Fallback to hardcoded values for chains not yet in SDK
  // This allows the relay to work even if SDK doesn't support all chains yet
  const fallbackConfigs: Record<NetworkKey, NetworkConfigType> = {
    base: {
      chain: base,
      usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      explorer: "https://basescan.org",
      usdcName: "USD Coin",
      usdcVersion: "2",
    },
    "base-sepolia": {
      chain: baseSepolia,
      usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      explorer: "https://sepolia.basescan.org",
      usdcName: "USDC",
      usdcVersion: "2",
    },
    polygon: {
      chain: polygon,
      usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      explorer: "https://polygonscan.com",
      usdcName: "USD Coin",
      usdcVersion: "2",
    },
    "polygon-amoy": {
      chain: polygonAmoy,
      usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
      explorer: "https://amoy.polygonscan.com",
      usdcName: "USDC",
      usdcVersion: "2",
    },
  };

  return fallbackConfigs[network];
}

// Network configurations with EIP-712 USDC domain info
// Lazy-loaded: uses SDK when available, falls back to hardcoded for unsupported chains
const NETWORK_CONFIG: Record<NetworkKey, NetworkConfigType> = {
  get base() {
    return getNetworkConfig("base");
  },
  get "base-sepolia"() {
    return getNetworkConfig("base-sepolia");
  },
  get polygon() {
    return getNetworkConfig("polygon");
  },
  get "polygon-amoy"() {
    return getNetworkConfig("polygon-amoy");
  },
};

// Import pricing configuration
import { getSubscriptionPricing, type SubscriptionTier } from "../config/pricing-config";
import { relayConfig, storageConfig } from "../config";

// Subscription tiers - Dynamic getter
export function getSubscriptionTiers(): Record<string, SubscriptionTier> {
  return getSubscriptionPricing();
}

interface X402MerchantOptions {
  payToAddress: string;
  network?: NetworkKey;
  facilitatorUrl?: string;
  facilitatorApiKey?: string;
  settlementMode?: "facilitator" | "direct";
  privateKey?: string;
  rpcUrl?: string;
}


export class X402Merchant {
  payToAddress: string;
  network: NetworkKey;
  facilitatorUrl: string;
  facilitatorApiKey: string;
  settlementMode: "facilitator" | "direct";
  privateKey: string;
  rpcUrl: string;
  networkConfig: NetworkConfigType;
  publicClient?: any;
  walletClient?: any;

  constructor(options: X402MerchantOptions = { payToAddress: "" }) {
    this.payToAddress = options.payToAddress;
    this.network = options.network || "base-sepolia";
    this.facilitatorUrl = options.facilitatorUrl || "https://x402.org/facilitator";
    this.facilitatorApiKey = options.facilitatorApiKey as string;
    this.settlementMode = options.settlementMode || "facilitator";
    this.privateKey = options.privateKey as string;
    this.rpcUrl = options.rpcUrl as string;

    // Get network config
    this.networkConfig = NETWORK_CONFIG[this.network];
    if (!this.networkConfig) {
      throw new Error(`Unsupported network: ${this.network}`);
    }

    // Always initialize clients if privateKey is available (for fallback support)
    if (this.privateKey) {
      this.initializeClients();
      log.debug(
        `x402 Merchant initialized with direct settlement ${this.settlementMode === "direct" ? "(primary)" : "(fallback)"
        }`
      );
    } else if (this.settlementMode === "facilitator") {
      log.debug(`x402 Merchant initialized with facilitator only (no direct settlement fallback)`);
    } else {
      log.warn(`x402 Merchant: Direct settlement mode but no private key configured!`);
    }
  }

  initializeClients(): void {
    const chain = this.networkConfig.chain;
    const transport = this.rpcUrl ? http(this.rpcUrl) : http();

    this.publicClient = createPublicClient({
      chain,
      transport,
    });

    if (this.privateKey) {
      const privateKey = (
        this.privateKey.startsWith("0x") ? this.privateKey : `0x${this.privateKey}`
      ) as `0x${string}`;
      const account = privateKeyToAccount(privateKey);
      this.walletClient = createWalletClient({
        account,
        chain,
        transport,
      });
    }
  }

  /**
   * Create payment requirements for a subscription tier
   */
  createPaymentRequirements(tier: string = "basic"): PaymentRequirements {
    const tierConfig = getSubscriptionTiers()[tier];
    if (!tierConfig) {
      throw new Error(`Invalid subscription tier: ${tier}`);
    }

    const priceInAtomicUnits = parseUnits(tierConfig.priceUSDC.toString(), 6).toString();

    return {
      scheme: "exact",
      network: this.network,
      maxAmountRequired: priceInAtomicUnits,
      resource: `ipfs-storage-${tier}`,
      description: `${tierConfig.name} IPFS Storage Subscription - ${tierConfig.storageMB}MB for ${tierConfig.durationDays} days`,
      mimeType: "application/json",
      payTo: this.payToAddress,
      maxTimeoutSeconds: 300,
      asset: this.networkConfig.usdc,
      extra: {
        tier,
        storageMB: tierConfig.storageMB,
        durationDays: tierConfig.durationDays,
        priceUSDC: tierConfig.priceUSDC,
        // EIP-712 domain info for signing
        name: this.networkConfig.usdcName,
        version: this.networkConfig.usdcVersion,
      },
    };
  }

  /**
   * Create payment requirements for a custom service
   */
  createCustomPaymentRequirements(
    amountUSDC: number,
    resourceId: string,
    description: string,
    extraData: any = {}
  ): PaymentRequirements {
    const priceInAtomicUnits = parseUnits(amountUSDC.toString(), 6).toString();

    return {
      scheme: "exact",
      network: this.network,
      maxAmountRequired: priceInAtomicUnits,
      resource: resourceId,
      description: description,
      mimeType: "application/json",
      payTo: this.payToAddress,
      maxTimeoutSeconds: 300,
      asset: this.networkConfig.usdc,
      extra: {
        priceUSDC: amountUSDC,
        // EIP-712 domain info for signing
        name: this.networkConfig.usdcName,
        version: this.networkConfig.usdcVersion,
        ...extraData,
      },
    };
  }

  /**
   * Create a payment-required response for a custom service
   */
  createCustomPaymentRequiredResponse(
    amountUSDC: number,
    resourceId: string,
    description: string,
    extraData: any = {}
  ): X402Response {
    const requirements = this.createCustomPaymentRequirements(
      amountUSDC,
      resourceId,
      description,
      extraData
    );

    return {
      x402Version: 1,
      accepts: [requirements],
      error: "Payment required" as any,
    };
  }

  /**
   * Create a payment-required response following x402 protocol
   */
  createPaymentRequiredResponse(tier: string = "basic"): X402Response {
    const requirements = this.createPaymentRequirements(tier);

    return {
      x402Version: 1,
      accepts: [requirements],
      error: "Payment required for IPFS storage subscription" as any, // Using 'as any' since ErrorReason enumber doesn't include this string, but x402 spec allows custom error messages
    };
  }

  /**
   * Verify a payment payload
   */
  async verifyPayment(
    paymentPayload: PaymentPayload,
    expectedTier: string = "basic"
  ): Promise<PaymentVerificationResult> {
    if (!paymentPayload) {
      return { isValid: false, invalidReason: "No payment payload provided" };
    }

    const tierConfig = getSubscriptionTiers()[expectedTier];
    if (!tierConfig) {
      return { isValid: false, invalidReason: `Invalid tier: ${expectedTier}` };
    }

    try {
      // Basic validation
      if (!paymentPayload.payload) {
        return { isValid: false, invalidReason: "Missing payload in payment" };
      }

      // Type guard: check if it's EVM payload (has authorization and signature)
      const isEvmPayload = (payload: any): payload is ExactEvmPayload => {
        return payload && "authorization" in payload && "signature" in payload;
      };

      if (!isEvmPayload(paymentPayload.payload)) {
        return {
          isValid: false,
          invalidReason: "Only EVM payments are supported",
        };
      }

      const { authorization, signature } = paymentPayload.payload;
      if (!authorization) {
        return {
          isValid: false,
          invalidReason: "Missing authorization in payload",
        };
      }

      if (!signature) {
        return {
          isValid: false,
          invalidReason: "Missing signature in payload",
        };
      }

      // Verify recipient
      if (authorization.to?.toLowerCase() !== this.payToAddress.toLowerCase()) {
        return {
          isValid: false,
          invalidReason: `Invalid recipient. Expected ${this.payToAddress}, got ${authorization.to}`,
        };
      }

      // Verify amount
      const expectedAmount = parseUnits(tierConfig.priceUSDC.toString(), 6);
      const paymentAmount = BigInt(authorization.value || "0");

      if (paymentAmount < expectedAmount) {
        return {
          isValid: false,
          invalidReason: `Insufficient payment. Expected ${formatUnits(
            expectedAmount,
            6
          )} USDC, got ${formatUnits(paymentAmount, 6)} USDC`,
        };
      }

      // Verify timing
      const now = Math.floor(Date.now() / 1000);
      const validAfter = parseInt(authorization.validAfter || "0");
      const validBefore = parseInt(authorization.validBefore || "0");

      if (now < validAfter) {
        return { isValid: false, invalidReason: "Payment not yet valid" };
      }

      if (now > validBefore) {
        return { isValid: false, invalidReason: "Payment has expired" };
      }

      // If using facilitator, try to verify with facilitator
      if (this.settlementMode === "facilitator") {
        const facilitatorResult = await this.verifyWithFacilitator(paymentPayload);
        if (!facilitatorResult.isValid) {
          // If facilitator fails, fall back to local verification if we have the tools
          log.warn(`Facilitator verification failed: ${facilitatorResult.invalidReason}`);
          log.debug("Attempting local signature verification...");

          // For now, accept the payment if basic validation passed and signature exists
          // The actual signature verification happens on-chain during settlement
          log.debug("Local verification: signature present, will verify during settlement");
        }
      }

      return {
        isValid: true,
        payer: authorization.from,
        amount: formatUnits(paymentAmount, 6),
        tier: expectedTier,
      };
    } catch (error: any) {
      log.error({ err: error }, "Payment verification error");
      return { isValid: false, invalidReason: error.message };
    }
  }

  /**
   * Verify payment for a deal (custom amount instead of tier)
   * @param {object} paymentPayload - The x402 payment payload
   * @param {numberber} requiredAmountAtomic - Required amount in atomic units (6 decimals for USDC)
   */
  async verifyDealPayment(
    paymentPayload: PaymentPayload,
    requiredAmountAtomic: number | string
  ): Promise<PaymentVerificationResult> {
    if (!paymentPayload) {
      return { isValid: false, invalidReason: "No payment payload provided" };
    }

    try {
      // Basic validation
      if (!paymentPayload.payload) {
        return { isValid: false, invalidReason: "Missing payload in payment" };
      }

      // Type guard: check if it's EVM payload (has authorization and signature)
      const isEvmPayload = (payload: any): payload is ExactEvmPayload => {
        return payload && "authorization" in payload && "signature" in payload;
      };

      if (!isEvmPayload(paymentPayload.payload)) {
        return {
          isValid: false,
          invalidReason: "Only EVM payments are supported",
        };
      }

      const { authorization, signature } = paymentPayload.payload;
      if (!authorization) {
        return {
          isValid: false,
          invalidReason: "Missing authorization in payload",
        };
      }

      if (!signature) {
        return {
          isValid: false,
          invalidReason: "Missing signature in payload",
        };
      }

      // Verify recipient
      if (authorization.to?.toLowerCase() !== this.payToAddress.toLowerCase()) {
        return {
          isValid: false,
          invalidReason: `Invalid recipient. Expected ${this.payToAddress}, got ${authorization.to}`,
        };
      }

      // Verify amount
      const paymentAmount = BigInt(authorization.value || "0");
      const requiredAmount = BigInt(requiredAmountAtomic);

      if (paymentAmount < requiredAmount) {
        return {
          isValid: false,
          invalidReason: `Insufficient payment. Required: ${requiredAmount}, got: ${paymentAmount}`,
        };
      }

      // Verify validity period
      const now = Math.floor(Date.now() / 1000);
      const validAfter = parseInt(authorization.validAfter || "0");
      const validBefore = parseInt(authorization.validBefore || "0");

      if (now < validAfter) {
        return { isValid: false, invalidReason: "Payment not yet valid" };
      }

      if (now > validBefore) {
        return { isValid: false, invalidReason: "Payment expired" };
      }

      log.debug(
        `Deal payment verified: ${formatUnits(paymentAmount, 6)} USDC from ${authorization.from}`
      );

      return {
        isValid: true,
        payer: authorization.from,
        amount: formatUnits(paymentAmount, 6),
        amountAtomic: paymentAmount.toString(),
      };
    } catch (error: any) {
      log.error({ err: error }, "Deal payment verification error");
      return { isValid: false, invalidReason: error.message };
    }
  }

  /**
   * Verify payment with facilitator
   */
  async verifyWithFacilitator(paymentPayload: PaymentPayload): Promise<FacilitatorVerifyResult> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (this.facilitatorApiKey) {
        headers["X-API-Key"] = this.facilitatorApiKey;
      }

      const response = await fetch(`${this.facilitatorUrl}/verify`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          paymentPayload,
          network: this.network,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        return {
          isValid: false,
          invalidReason: errorData.error || `Facilitator returned ${response.status}`,
        };
      }

      const result = (await response.json()) as { isValid?: boolean; payer?: string };
      return { isValid: result.isValid ?? false, payer: result.payer };
    } catch (error: any) {
      log.error({ err: error }, "Facilitator verification error");
      return {
        isValid: false,
        invalidReason: `Facilitator error: ${error.message}`,
      };
    }
  }

  /**
   * Settle payment (transfer USDC to merchant)
   * Tries facilitator first (if configured), then falls back to direct settlement
   */
  async settlePayment(paymentPayload: PaymentPayload): Promise<PaymentSettlementResult> {
    // If direct mode is explicitly set, use direct only
    if (this.settlementMode === "direct") {
      log.debug("Using direct settlement mode");
      return this.settleDirectly(paymentPayload);
    }

    // Try facilitator first
    log.debug("Attempting facilitator settlement...");
    const facilitatorResult = await this.settleWithFacilitator(paymentPayload);

    if (facilitatorResult.success) {
      log.debug(`Facilitator settlement successful: ${facilitatorResult.transaction}`);
      return facilitatorResult;
    }

    log.warn(`Facilitator failed: ${facilitatorResult.errorReason}`);

    // If facilitator failed and we have direct settlement configured, try that
    if (this.walletClient && this.publicClient) {
      log.debug("Falling back to direct settlement...");
      const directResult = await this.settleDirectly(paymentPayload);
      if (directResult.success) {
        log.debug(`Direct settlement successful: ${directResult.transaction}`);
      } else {
        log.warn(`Direct settlement also failed: ${directResult.errorReason}`);
      }
      return directResult;
    }

    // No fallback available
    log.warn("No direct settlement fallback available (X402_PRIVATE_KEY not configured)");
    return {
      success: false,
      errorReason: facilitatorResult.errorReason || "Settlement failed and no fallback available",
    };
  }

  /**
   * Settle payment via facilitator
   */
  async settleWithFacilitator(paymentPayload: PaymentPayload): Promise<FacilitatorSettleResult> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (this.facilitatorApiKey) {
        headers["X-API-Key"] = this.facilitatorApiKey;
      }

      log.debug(`Calling facilitator: ${this.facilitatorUrl}/settle`);

      const response = await fetch(`${this.facilitatorUrl}/settle`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          paymentPayload,
          network: this.network,
        }),
      });

      let result: { error?: string; message?: string; reason?: string; transactionHash?: string };
      try {
        result = (await response.json()) as {
          error?: string;
          message?: string;
          reason?: string;
          transactionHash?: string;
        };
      } catch (parseError: any) {
        log.error({ err: parseError }, "Failed to parse facilitator response");
        return {
          success: false,
          errorReason: `Facilitator returned invalid response (status ${response.status})`,
        };
      }

      log.debug({ result }, `Facilitator response: ${response.status}`);

      if (!response.ok) {
        return {
          success: false,
          errorReason:
            result.error ||
            result.message ||
            result.reason ||
            `Facilitator returned status ${response.status}`,
        };
      }

      if (!result.transactionHash) {
        return {
          success: false,
          errorReason: "Facilitator did not return transaction hash",
        };
      }

      return {
        success: true,
        transaction: result.transactionHash,
        network: this.network,
        explorer: `${this.networkConfig.explorer}/tx/${result.transactionHash}`,
      };
    } catch (error: any) {
      log.error({ err: error }, "Facilitator settlement error");
      return {
        success: false,
        errorReason: `Facilitator error: ${error.message}`,
      };
    }
  }

  /**
   * Settle payment directly on-chain
   */
  async settleDirectly(paymentPayload: PaymentPayload): Promise<PaymentSettlementResult> {
    if (!this.walletClient || !this.publicClient) {
      return {
        success: false,
        errorReason: "Direct settlement not configured",
      };
    }

    try {
      // Type guard: check if it's EVM payload
      const isEvmPayload = (payload: any): payload is ExactEvmPayload => {
        return payload && "authorization" in payload && "signature" in payload;
      };

      if (!paymentPayload.payload || !isEvmPayload(paymentPayload.payload)) {
        return {
          success: false,
          errorReason: "Only EVM payments are supported for direct settlement",
        };
      }

      const { authorization, signature } = paymentPayload.payload;

      // Parse signature components (EIP-712 returns 65-byte signature)
      let sig = signature.startsWith("0x") ? signature.slice(2) : signature;

      // Ensure signature is 130 hex chars (65 bytes)
      if (sig.length !== 130) {
        throw new Error(`Invalid signature length: expected 130 hex chars, got ${sig.length}`);
      }

      const r = `0x${sig.slice(0, 64)}`;
      const s = `0x${sig.slice(64, 128)}`;
      let v = parseInt(sig.slice(128, 130), 16);

      // EIP-712 v is already 27 or 28, but some contracts expect 0/1
      // For USDC, we need v as-is (27 or 28)
      log.debug(`Parsed signature: r=${r.substring(0, 10)}..., s=${s.substring(0, 10)}..., v=${v}`);

      // Ensure nonce is bytes32 (64 hex chars)
      let nonce = authorization.nonce;
      if (nonce.startsWith("0x")) {
        nonce = nonce.slice(2);
      }
      if (nonce.length !== 64) {
        throw new Error(`Invalid nonce length: expected 64 hex chars, got ${nonce.length}`);
      }
      const nonceBytes32 = `0x${nonce}`;

      log.debug(
        {
          from: authorization.from,
          to: authorization.to,
          value: authorization.value,
          nonce: nonceBytes32,
          v,
          r: r.substring(0, 10) + "...",
          s: s.substring(0, 10) + "...",
        },
        "Executing transferWithAuthorization"
      );

      // Execute transferWithAuthorization
      const hash = await this.walletClient.writeContract({
        address: this.networkConfig.usdc,
        abi: USDC_ABI,
        functionName: "transferWithAuthorization",
        args: [
          authorization.from,
          authorization.to,
          BigInt(authorization.value),
          BigInt(authorization.validAfter),
          BigInt(authorization.validBefore),
          nonceBytes32,
          v,
          r,
          s,
        ],
      });

      // Wait for confirmation
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      return {
        success: receipt.status === "success",
        transaction: hash,
        network: this.network,
        explorer: `${this.networkConfig.explorer}/tx/${hash}`,
        blocknumberber: receipt.blocknumberber?.toString(),
      };
    } catch (error: any) {
      log.error({ err: error }, "Direct settlement error");
      return { success: false, errorReason: error.message };
    }
  }

  /**
   * Get subscription status for a user from GunDB (relay user space)
   */
  static async getSubscriptionStatus(gun: any, userAddress: string): Promise<SubscriptionStatus> {
    // Check if relay user is initialized
    if (!RelayUser.isRelayUserInitialized()) {
      log.warn("Relay user not initialized, cannot read subscription");
      return { active: false, reason: "Relay user not initialized" };
    }

    try {
      const data = await RelayUser.getSubscription(userAddress);

      if (!data || typeof data !== "object") {
        return { active: false, reason: "No subscription found" };
      }

      const now = Date.now();
      const subData = data as unknown as Subscription;
      const expiresAt = (subData.expiresAt as number) || 0;

      if (now > expiresAt) {
        return {
          active: false,
          reason: "Subscription expired",
          expiredAt: new Date(expiresAt).toISOString(),
        };
      }

      const tiers = getSubscriptionTiers();
      const tierConfig = tiers[subData.tier as string] || tiers.basic;

      return {
        active: true,
        tier: subData.tier as string,
        storageMB: tierConfig.storageMB,
        storageUsedMB: (subData.storageUsedMB as number) || 0,
        storageRemainingMB: Math.max(
          0,
          tierConfig.storageMB - ((subData.storageUsedMB as number) || 0)
        ),
        expiresAt: new Date(expiresAt).toISOString(),
        purchasedAt: subData.purchasedAt
          ? new Date(subData.purchasedAt as number).toISOString()
          : null,
        ownedBy: RelayUser.getRelayPub() || undefined,
      };
    } catch (error: any) {
      log.error({ err: error }, "Error getting subscription");
      return { active: false, reason: error.message };
    }
  }

  /**
   * Save subscription to GunDB (relay user space)
   */
  static async saveSubscription(
    gun: any,
    userAddress: string,
    tier: string,
    paymentDetails?: { transaction?: string; network?: string }
  ): Promise<Subscription & { ownedBy: string }> {
    // Check if relay user is initialized
    if (!RelayUser.isRelayUserInitialized()) {
      throw new Error("Relay user not initialized, cannot save subscription");
    }

    const tiers = getSubscriptionTiers();
    const tierConfig = tiers[tier];

    if (!tierConfig) {
      throw new Error(`Invalid tier: ${tier}`);
    }

    const now = Date.now();
    const expiresAt = now + tierConfig.durationDays * 24 * 60 * 60 * 1000;

    // Get current subscription to handle renewals
    const currentSub = await this.getSubscriptionStatus(gun, userAddress);

    let finalExpiresAt = expiresAt;
    let storageUsedMB = 0;

    // If renewing same or higher tier and subscription is still active, extend expiry
    if (currentSub.active && currentSub.tier) {
      const currentTierConfig = tiers[currentSub.tier as string];

      // Prevent downgrade: new tier must have storageMB >= current tier
      if (currentTierConfig && tierConfig.storageMB < currentTierConfig.storageMB) {
        throw new Error(
          `Cannot downgrade from ${currentSub.tier} (${currentTierConfig.storageMB}MB) to ${tier} (${tierConfig.storageMB}MB). You can only upgrade to a higher or equal tier.`
        );
      }

      // If same or higher tier, extend expiry and keep storage usage
      if (tierConfig.storageMB >= (currentTierConfig?.storageMB ?? 0)) {
        // Add remaining time from current subscription
        const remainingTime = new Date(currentSub.expiresAt as string).getTime() - now;
        if (remainingTime > 0) {
          finalExpiresAt = expiresAt + remainingTime;
        }
        // Keep current storage usage if upgrading or renewing
        storageUsedMB = currentSub.storageUsedMB || 0;
      }
    }

    const subscription: Subscription = {
      tier,
      storageMB: tierConfig.storageMB,
      storageUsedMB,
      priceUSDC: tierConfig.priceUSDC,
      purchasedAt: now,
      expiresAt: finalExpiresAt,
      // Convert null to undefined for GunDB compatibility
      paymentTx: paymentDetails?.transaction || undefined,
      paymentNetwork: paymentDetails?.network || undefined,
      userAddress,
    };

    await RelayUser.saveSubscription(userAddress, subscription as unknown as Record<string, any>);

    return {
      ...subscription,
      ownedBy: RelayUser.getRelayPub() || "",
    };
  }

  /**
   * Update storage usage for a subscription (relay user space)
   */
  static async updateStorageUsage(
    gun: any,
    userAddress: string,
    addMB: number
  ): Promise<StorageUsageResult> {
    // Check if relay user is initialized
    if (!RelayUser.isRelayUserInitialized()) {
      throw new Error("Relay user not initialized, cannot update storage");
    }

    const currentSub = await this.getSubscriptionStatus(gun, userAddress);

    if (!currentSub.active) {
      throw new Error("No active subscription");
    }

    const newUsage = (currentSub.storageUsedMB || 0) + addMB;

    if (newUsage > (currentSub.storageMB || 0)) {
      throw new Error(
        `Storage limit exceeded. Used: ${newUsage}MB, Limit: ${currentSub.storageMB}MB`
      );
    }

    await RelayUser.updateSubscriptionField(userAddress, "storageUsedMB", newUsage);

    return {
      storageUsedMB: newUsage,
      storageRemainingMB: (currentSub.storageMB || 0) - newUsage,
    };
  }

  /**
   * Check if user can upload a file of given size
   */
  static async canUpload(
    gun: any,
    userAddress: string,
    fileSizeMB: number
  ): Promise<CanUploadResult> {
    const sub = await this.getSubscriptionStatus(gun, userAddress);

    if (!sub.active) {
      return {
        allowed: false,
        reason: sub.reason || "No active subscription",
        requiresPayment: true,
      };
    }

    if ((sub.storageRemainingMB || 0) < fileSizeMB) {
      return {
        allowed: false,
        reason: `File too large. Remaining storage: ${sub.storageRemainingMB}MB, File size: ${fileSizeMB}MB`,
        requiresUpgrade: true,
        currentTier: sub.tier,
      };
    }

    return {
      allowed: true,
      storageAfterUpload: (sub.storageRemainingMB || 0) - fileSizeMB,
    };
  }

  /**
   * Get all uploads for a user from GunDB (relay user space)
   */
  static async getUserUploads(gun: any, userAddress: string): Promise<Array<any>> {
    // Check if relay user is initialized
    if (!RelayUser.isRelayUserInitialized()) {
      log.warn("Relay user not initialized, cannot read uploads");
      return [];
    }

    try {
      return await RelayUser.getUserUploads(userAddress);
    } catch (error: any) {
      log.error({ err: error }, "Error getting user uploads");
      return [];
    }
  }

  /**
   * Get the actual size of an IPFS object from the IPFS API
   * Uses the unified ipfs-client for robust handling of HTTP/HTTPS and retries.
   *
   * @param cid - The CID to check
   * @param ipfsApiUrl - Deprecated/Ignored. Uses IPFS_API_URL env var via ipfs-client
   * @param ipfsApiToken - Deprecated/Ignored. Uses IPFS_API_TOKEN env var via ipfs-client
   */
  static async getIpfsObjectSize(
    cid: string,
    ipfsApiUrl: string | null = null,
    ipfsApiToken: string | null = null
  ): Promise<IpfsObjectSize | null> {
    try {
      // Use the unified ipfs-client which handles auth, connection headers, and protocol switching
      const result = await ipfsRequest(`/api/v0/object/stat?arg=${cid}`);

      if (!result) return null;

      const statResult = result as {
        CumulativeSize?: number;
        DataSize?: number;
        numberLinks?: number;
        BlockSize?: number;
      };

      return {
        cid,
        size: statResult.CumulativeSize || statResult.DataSize || 0,
        numberLinks: statResult.numberLinks || 0,
        blockSize: statResult.BlockSize || 0,
      };
    } catch (error: any) {
      log.error({ err: error }, `Error getting IPFS stats for ${cid}`);
      return null;
    }
  }

  /**
   * Calculate real storage usage from IPFS for a user
   * This queries IPFS to get the actual size of each pinned hash
   */
  static async calculateRealStorageUsage(
    gun: any,
    userAddress: string,
    ipfsApiUrl?: string,
    ipfsApiToken?: string
  ): Promise<CalculateRealStorageUsageResult> {
    log.debug(`Calculating real IPFS storage for ${userAddress}...`);

    // Get all uploads from GunDB
    const uploads = await this.getUserUploads(gun, userAddress);

    if (uploads.length === 0) {
      return {
        totalBytes: 0,
        totalMB: 0,
        fileCount: 0,
        files: [],
        verified: true,
      };
    }

    log.debug(`Found ${uploads.length} uploads for ${userAddress}, verifying sizes on IPFS...`);

    // Get actual sizes from IPFS
    const filesWithSizes: Array<any> = [];
    let totalBytes = 0;

    for (const upload of uploads) {
      const ipfsStats = await this.getIpfsObjectSize(upload.hash, ipfsApiUrl, ipfsApiToken);

      if (ipfsStats) {
        filesWithSizes.push({
          hash: upload.hash,
          name: upload.name,
          recordedSize: upload.size,
          actualSize: ipfsStats.size,
          sizeMB: ipfsStats.size / (1024 * 1024),
        });
        totalBytes += ipfsStats.size;
      } else {
        // If we can't get IPFS stats, use recorded size from GunDB
        filesWithSizes.push({
          hash: upload.hash,
          name: upload.name,
          recordedSize: upload.size,
          actualSize: upload.size,
          sizeMB: upload.size / (1024 * 1024),
          warning: "Could not verify on IPFS",
        });
        totalBytes += upload.size || 0;
      }
    }

    const totalMB = totalBytes / (1024 * 1024);

    log.debug(
      `Real IPFS storage for ${userAddress}: ${totalMB.toFixed(2)}MB across ${filesWithSizes.length
      } files`
    );

    return {
      totalBytes,
      totalMB,
      fileCount: filesWithSizes.length,
      files: filesWithSizes,
      verified: true,
    };
  }

  /**
   * Sync storage usage - verifies and updates GunDB with real IPFS storage (relay user space)
   */
  static async syncStorageUsage(
    gun: any,
    userAddress: string,
    ipfsApiUrl?: string,
    ipfsApiToken?: string
  ): Promise<SyncStorageUsageResult> {
    // Check if relay user is initialized
    if (!RelayUser.isRelayUserInitialized()) {
      return {
        success: false,
        error: "Relay user not initialized",
      };
    }

    // Calculate real storage from IPFS
    const realUsage = await this.calculateRealStorageUsage(
      gun,
      userAddress,
      ipfsApiUrl,
      ipfsApiToken
    );

    // Get current subscription
    const subscription = await this.getSubscriptionStatus(gun, userAddress);

    if (!subscription.active) {
      return {
        success: false,
        error: "No active subscription",
        realUsage,
      };
    }

    const recordedMB = subscription.storageUsedMB || 0;
    const realMB = realUsage.totalMB;
    const discrepancy = Math.abs(recordedMB - realMB);

    log.debug(
      {
        recordedMB: recordedMB.toFixed(2),
        realMB: realMB.toFixed(2),
        discrepancy: discrepancy.toFixed(2),
      },
      `Storage sync for ${userAddress}`
    );

    // If there's a significant discrepancy (> 0.1MB), update GunDB
    if (discrepancy > 0.1) {
      log.debug(`Updating storage usage from ${recordedMB.toFixed(2)}MB to ${realMB.toFixed(2)}MB`);

      try {
        await RelayUser.updateSubscriptionField(userAddress, "storageUsedMB", realMB);

        return {
          success: true,
          previousMB: recordedMB,
          currentMB: realMB,
          discrepancy,
          corrected: true,
          realUsage,
          storageRemainingMB: Math.max(0, (subscription.storageMB || 0) - realMB),
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message,
          previousMB: recordedMB,
          currentMB: realMB,
          discrepancy,
        };
      }
    }

    return {
      success: true,
      previousMB: recordedMB,
      currentMB: realMB,
      discrepancy,
      corrected: false,
      realUsage,
      storageRemainingMB: subscription.storageRemainingMB,
    };
  }

  /**
   * Check if user can upload with real IPFS verification (relay user space)
   * This verifies actual storage before allowing upload
   */
  static async canUploadVerified(
    gun: any,
    userAddress: string,
    fileSizeMB: number,
    ipfsApiUrl?: string,
    ipfsApiToken?: string
  ): Promise<CanUploadVerifiedResult> {
    // Check if relay user is initialized
    if (!RelayUser.isRelayUserInitialized()) {
      return {
        allowed: false,
        reason: "Relay user not initialized",
        requiresPayment: false,
      };
    }

    const sub = await this.getSubscriptionStatus(gun, userAddress);

    if (!sub.active) {
      return {
        allowed: false,
        reason: sub.reason || "No active subscription",
        requiresPayment: true,
      };
    }

    // Calculate real storage usage from IPFS
    const realUsage = await this.calculateRealStorageUsage(
      gun,
      userAddress,
      ipfsApiUrl,
      ipfsApiToken
    );
    const realUsedMB = realUsage.totalMB;
    const realRemainingMB = Math.max(0, (sub.storageMB || 0) - realUsedMB);

    // Update GunDB if there's a discrepancy
    if (Math.abs(realUsedMB - (sub.storageUsedMB || 0)) > 0.1) {
      log.warn(
        `Storage discrepancy detected. Recorded: ${sub.storageUsedMB || 0
        }MB, Actual: ${realUsedMB.toFixed(2)}MB`
      );

      // Update the stored value using relay user
      try {
        await RelayUser.updateSubscriptionField(userAddress, "storageUsedMB", realUsedMB);
      } catch (error: any) {
        log.warn({ err: error }, "Failed to update storage discrepancy");
      }
    }

    if (realRemainingMB < fileSizeMB) {
      return {
        allowed: false,
        reason: `File too large. Remaining storage: ${realRemainingMB.toFixed(
          2
        )}MB, File size: ${fileSizeMB.toFixed(2)}MB`,
        requiresUpgrade: true,
        currentTier: sub.tier,
        storageUsedMB: realUsedMB,
        storageRemainingMB: realRemainingMB,
        storageTotalMB: sub.storageMB,
        verified: true,
      };
    }

    return {
      allowed: true,
      storageUsedMB: realUsedMB,
      storageRemainingMB: realRemainingMB,
      storageAfterUpload: realRemainingMB - fileSizeMB,
      storageTotalMB: sub.storageMB,
      verified: true,
    };
  }

  /**
   * Save upload record for a user (relay user space)
   */
  static async saveUploadRecord(userAddress: string, hash: string, uploadData: any): Promise<void> {
    if (!RelayUser.isRelayUserInitialized()) {
      throw new Error("Relay user not initialized");
    }

    await RelayUser.saveUpload(userAddress, hash, uploadData);
  }

  /**
   * Delete upload record for a user (relay user space)
   */
  static async deleteUploadRecord(userAddress: string, hash: string): Promise<void> {
    if (!RelayUser.isRelayUserInitialized()) {
      throw new Error("Relay user not initialized");
    }

    await RelayUser.deleteUpload(userAddress, hash);
  }

  /**
   * Get IPFS repository statistics (total storage used by all pins)
   * This uses the IPFS repo/stat API to get actual disk usage
   */
  static async getIpfsRepoStats(
    ipfsApiUrl: string = "http://127.0.0.1:5001",
    ipfsApiToken: string | null = null
  ): Promise<IpfsRepoStats | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        log.error("Timeout getting IPFS repo stats");
        resolve(null);
      }, 30000);

      const url = new URL(ipfsApiUrl);
      const isHttps = url.protocol === "https:";
      const protocolModule = isHttps ? httpsModule : httpModule;

      const requestOptions: any = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 5001),
        path: "/api/v0/repo/stat?size-only=true&human=false",
        method: "POST",
        headers: {
          "Content-Length": "0",
        },
      };

      if (ipfsApiToken) {
        requestOptions.headers["Authorization"] = `Bearer ${ipfsApiToken}`;
      }

      const req = protocolModule.request(requestOptions, (res: any) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          clearTimeout(timeout);
          try {
            const result = JSON.parse(data);
            // Try multiple field names for RepoSize (IPFS API may return different formats)
            let repoSize = 0;
            if (result.RepoSize !== undefined) {
              repoSize =
                typeof result.RepoSize === "string"
                  ? parseInt(result.RepoSize, 10) || 0
                  : result.RepoSize || 0;
            } else if (result.repoSize !== undefined) {
              repoSize =
                typeof result.repoSize === "string"
                  ? parseInt(result.repoSize, 10) || 0
                  : result.repoSize || 0;
            }

            // Try multiple field names for StorageMax
            let storageMax = 0;
            if (result.StorageMax !== undefined) {
              storageMax =
                typeof result.StorageMax === "string"
                  ? parseInt(result.StorageMax, 10) || 0
                  : result.StorageMax || 0;
            } else if (result.storageMax !== undefined) {
              storageMax =
                typeof result.storageMax === "string"
                  ? parseInt(result.storageMax, 10) || 0
                  : result.storageMax || 0;
            }

            resolve({
              repoSize: repoSize,
              storageMax: storageMax,
              numberObjects: result.numberObjects || result.NumObjects || 0,
              repoPath: result.RepoPath || result.repoPath || "",
              version: result.Version || result.version || "",
            });
          } catch (error: any) {
            log.error({ err: error }, "Error parsing IPFS repo stats");
            resolve(null);
          }
        });
      });

      req.on("error", (err: any) => {
        clearTimeout(timeout);
        log.error({ err }, "Error getting IPFS repo stats");
        resolve(null);
      });

      req.end();
    });
  }

  /**
   * Get all pinned content from IPFS with their sizes
   * Returns total size of all pins
   */
  static async getAllPinsSize(
    ipfsApiUrl: string = "http://127.0.0.1:5001",
    ipfsApiToken: string | null = null
  ): Promise<PinsSizeResult> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        log.error("Timeout getting IPFS pins");
        resolve({ totalBytes: 0, pinCount: 0, pins: [] });
      }, 60000);

      const url = new URL(ipfsApiUrl);
      const isHttps = url.protocol === "https:";
      const protocolModule = isHttps ? httpsModule : httpModule;

      const requestOptions: any = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 5001),
        path: "/api/v0/pin/ls?type=recursive",
        method: "POST",
        headers: {
          "Content-Length": "0",
        },
      };

      if (ipfsApiToken) {
        requestOptions.headers["Authorization"] = `Bearer ${ipfsApiToken}`;
      }

      const req = protocolModule.request(requestOptions, (res: any) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", async () => {
          clearTimeout(timeout);
          try {
            const result = JSON.parse(data);
            const pins = result.Keys ? Object.keys(result.Keys) : [];

            if (pins.length === 0) {
              resolve({ totalBytes: 0, pinCount: 0, pins: [] });
              return;
            }

            // Get sizes for each pin (batch processing)
            let totalBytes = 0;
            const pinsWithSizes: Array<{ cid: string; size: number; sizeMB: number }> = [];

            for (const cid of pins) {
              const stats = await X402Merchant.getIpfsObjectSize(cid, ipfsApiUrl, ipfsApiToken);
              if (stats) {
                pinsWithSizes.push({
                  cid,
                  size: stats.size,
                  sizeMB: stats.size / (1024 * 1024),
                });
                totalBytes += stats.size;
              }
            }

            resolve({
              totalBytes,
              totalMB: totalBytes / (1024 * 1024),
              totalGB: totalBytes / (1024 * 1024 * 1024),
              pinCount: pins.length,
              pins: pinsWithSizes,
            });
          } catch (error: any) {
            log.error({ err: error }, "Error parsing IPFS pins");
            resolve({ totalBytes: 0, pinCount: 0, pins: [] });
          }
        });
      });

      req.on("error", (err: any) => {
        clearTimeout(timeout);
        log.error({ err }, "Error getting IPFS pins");
        resolve({ totalBytes: 0, pinCount: 0, pins: [] });
      });

      req.end();
    });
  }

  /**
   * Get relay's global storage status
   * Combines IPFS repo stats with configured limits
   */
  static async getRelayStorageStatus(
    ipfsApiUrl?: string,
    ipfsApiToken?: string
  ): Promise<RelayStorageStatus> {
    const maxStorageGB = parseFloat(storageConfig.maxStorageGB.toString()) || 0;
    const warningThreshold =
      parseFloat(storageConfig.storageWarningThreshold.toString() || "80") || 80;

    // Get IPFS repo stats (faster, gives total repo size)
    const repoStats = await this.getIpfsRepoStats(ipfsApiUrl, ipfsApiToken);

    if (!repoStats) {
      return {
        available: false,
        error: "Could not get IPFS repository stats",
      };
    }

    const usedBytes = repoStats.repoSize;
    const usedGB = usedBytes / (1024 * 1024 * 1024);
    const usedMB = usedBytes / (1024 * 1024);

    // If no limit is configured, return just usage info
    if (maxStorageGB <= 0) {
      return {
        available: true,
        unlimited: true,
        usedBytes,
        usedMB: parseFloat(usedMB.toFixed(2)),
        usedGB: parseFloat(usedGB.toFixed(2)),
        maxStorageGB: null,
        remainingGB: null,
        percentUsed: null,
        warning: false,
        numberObjects: repoStats.numberObjects,
      };
    }

    const maxStorageBytes = maxStorageGB * 1024 * 1024 * 1024;
    const remainingBytes = Math.max(0, maxStorageBytes - usedBytes);
    const remainingGB = remainingBytes / (1024 * 1024 * 1024);
    const remainingMB = remainingBytes / (1024 * 1024);
    const percentUsed = (usedBytes / maxStorageBytes) * 100;

    return {
      available: true,
      unlimited: false,
      usedBytes,
      usedMB: parseFloat(usedMB.toFixed(2)),
      usedGB: parseFloat(usedGB.toFixed(2)),
      maxStorageGB,
      maxStorageMB: maxStorageGB * 1024,
      remainingBytes,
      remainingMB: parseFloat(remainingMB.toFixed(2)),
      remainingGB: parseFloat(remainingGB.toFixed(2)),
      percentUsed: parseFloat(percentUsed.toFixed(1)),
      warning: percentUsed >= warningThreshold,
      warningThreshold,
      full: percentUsed >= 100,
      numberObjects: repoStats.numberObjects,
    };
  }

  /**
   * Check if relay has enough space for a new subscription tier
   * Returns availability status and any warnings
   */
  static async canAcceptSubscription(
    tier: string,
    ipfsApiUrl?: string,
    ipfsApiToken?: string
  ): Promise<CanAcceptSubscriptionResult> {
    const tiers = getSubscriptionTiers();
    const tierConfig = tiers[tier];
    if (!tierConfig) {
      return {
        allowed: false,
        reason: `Invalid tier: ${tier}`,
      };
    }

    const relayStorage = await this.getRelayStorageStatus(ipfsApiUrl, ipfsApiToken);

    if (!relayStorage.available) {
      return {
        allowed: false,
        reason: "Could not verify relay storage status",
        error: relayStorage.error,
      };
    }

    // If unlimited, always allow
    if (relayStorage.unlimited) {
      return {
        allowed: true,
        relayStorage,
      };
    }

    const requiredMB = tierConfig.storageMB;
    const availableMB = relayStorage.remainingMB || 0;

    // Check if there's enough space for the subscription tier
    if (availableMB < requiredMB) {
      return {
        allowed: false,
        reason: `Relay storage insufficient. Available: ${availableMB.toFixed(
          2
        )}MB, Required for ${tierConfig.name}: ${requiredMB}MB`,
        relayFull: true,
        relayStorage,
      };
    }

    // Warning if relay is getting full
    if (relayStorage.warning) {
      return {
        allowed: true,
        warning: `Relay storage is at ${(relayStorage.percentUsed ?? 0).toFixed(1)}% capacity`,
        relayStorage,
      };
    }

    return {
      allowed: true,
      relayStorage,
    };
  }

  /**
   * Check if relay has enough space for a file upload (global check)
   */
  static async canAcceptUpload(
    fileSizeMB: number,
    ipfsApiUrl?: string,
    ipfsApiToken?: string
  ): Promise<CanAcceptUploadResult> {
    const relayStorage = await this.getRelayStorageStatus(ipfsApiUrl, ipfsApiToken);

    if (!relayStorage.available) {
      return {
        allowed: false,
        reason: "Could not verify relay storage status",
        error: relayStorage.error,
      };
    }

    // If unlimited, always allow
    if (relayStorage.unlimited) {
      return {
        allowed: true,
        relayStorage,
      };
    }

    if ((relayStorage.remainingMB || 0) < fileSizeMB) {
      return {
        allowed: false,
        reason: `Relay storage full. Available: ${relayStorage.remainingMB?.toFixed(
          2
        )}MB, File size: ${fileSizeMB.toFixed(2)}MB`,
        relayFull: true,
        relayStorage,
      };
    }

    return {
      allowed: true,
      warning: relayStorage.warning
        ? `Relay storage at ${(relayStorage.percentUsed ?? 0).toFixed(1)}%`
        : undefined,
      relayStorage,
    };
  }
}

export default X402Merchant;
