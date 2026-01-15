/**
 * Registry Routes - On-chain relay management
 *
 * API endpoints for:
 * - Relay registration on-chain
 * - Staking/unstaking USDC
 * - Deal registration
 * - Registry queries
 */

import express, { Request, Response, Router } from "express";
import {
  createRegistryClient,
  createRegistryClientWithSigner,
  generateDealId,
  REGISTRY_ADDRESSES,
  USDC_ADDRESSES,
} from "../utils/registry-client.js";
import { registryConfig } from "../config";
import { loggers } from "../utils/logger";

const router: Router = express.Router();

// Get chain configuration from environment
const REGISTRY_CHAIN_ID: number = registryConfig.chainId;

/**
 * Get the relay private key dynamically to avoid caching issues.
 * This ensures that if the private key is changed and the server is restarted,
 * the new key is used instead of a cached value.
 * 
 * Priority order:
 * 1. RELAY_PRIVATE_KEY (preferred)
 * 2. PRIVATE_KEY (fallback)
 */
function getRelayPrivateKey(): string | undefined {
  const key = process.env.RELAY_PRIVATE_KEY || process.env.PRIVATE_KEY;
  // Log the source for debugging (only first/last 4 chars for security)
  if (key && key.length > 10) {
    const masked = `${key.slice(0, 6)}...${key.slice(-4)}`;
    const source = process.env.RELAY_PRIVATE_KEY ? 'RELAY_PRIVATE_KEY' : 'PRIVATE_KEY';
    loggers.registry.debug({ source, masked }, 'Using private key');
  }
  return key;
}

/**
 * Helper to compute wallet address from private key for debugging
 */
async function getWalletAddressFromKey(privateKey: string): Promise<string> {
  const { ethers } = await import("ethers");
  const wallet = new ethers.Wallet(privateKey);
  return wallet.address;
}

/**
 * GET /api/v1/registry/status
 *
 * Get this relay's on-chain registration status
 */
router.get("/status", async (req: Request, res: Response) => {
  try {
    const { getConfigByChainId } = await import("shogun-contracts-sdk");
    const config = getConfigByChainId(REGISTRY_CHAIN_ID);

    const relayPrivateKey = getRelayPrivateKey();
    if (!relayPrivateKey) {
      return res.json({
        success: true,
        registered: false,
        configured: false,
        message: "RELAY_PRIVATE_KEY not configured - on-chain features disabled",
        chainId: REGISTRY_CHAIN_ID,
        registryAddress: config?.relayRegistry || null,
      });
    }

    const client = createRegistryClientWithSigner(relayPrivateKey, REGISTRY_CHAIN_ID);
    const relayAddress: string = client.wallet.address;
    const info = await client.getRelayInfo(relayAddress);

    if (!info) {
      return res.json({
        success: true,
        registered: false,
        configured: true,
        relayAddress,
        chainId: REGISTRY_CHAIN_ID,
        registryAddress: client.registryAddress,
        message: "Relay not registered on-chain",
      });
    }

    // Get total deals count from StorageDealRegistry
    let totalDeals: number = 0;
    try {
      const { createStorageDealRegistryClient } = await import("../utils/registry-client.js");
      const storageDealRegistryClient = createStorageDealRegistryClient(REGISTRY_CHAIN_ID);
      const deals = await storageDealRegistryClient.getRelayDeals(relayAddress);
      totalDeals = deals.length;
    } catch (error: any) {
      loggers.registry.warn({ err: error }, "Could not fetch total deals count");
    }

    res.json({
      success: true,
      registered: true,
      configured: true,
      relayAddress,
      chainId: REGISTRY_CHAIN_ID,
      registryAddress: client.registryAddress,
      relay: {
        ...info,
        totalDeals,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/registry/balance
 *
 * Get wallet balances (ETH for gas, USDC for staking)
 */
router.get("/balance", async (req: Request, res: Response) => {
  try {
    const relayPrivateKey = getRelayPrivateKey();
    if (!relayPrivateKey) {
      return res.status(400).json({
        success: false,
        error: "RELAY_PRIVATE_KEY not configured",
      });
    }

    const client = createRegistryClientWithSigner(relayPrivateKey, REGISTRY_CHAIN_ID);
    const relayAddress: string = client.wallet.address;

    const [ethBalance, usdcBalance] = await Promise.all([
      client.provider.getBalance(relayAddress),
      client.usdc.balanceOf(relayAddress),
    ]);

    const { ethers } = await import("ethers");

    res.json({
      success: true,
      relayAddress,
      chainId: REGISTRY_CHAIN_ID,
      balances: {
        eth: ethers.formatEther(ethBalance),
        ethWei: ethBalance.toString(),
        usdc: ethers.formatUnits(usdcBalance, 6),
        usdcRaw: usdcBalance.toString(),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/registry/params
 *
 * Get registry parameters
 */
router.get("/params", async (req: Request, res: Response) => {
  try {
    const client = createRegistryClient(REGISTRY_CHAIN_ID);
    const params = await client.getRegistryParams();

    res.json({
      success: true,
      chainId: REGISTRY_CHAIN_ID,
      registryAddress: client.registryAddress,
      usdcAddress: client.usdcAddress,
      params,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/registry/register
 *
 * Register this relay on-chain
 * Requires: endpoint, gunPubKey, stakeAmount
 */
router.post("/register", async (req: Request, res: Response) => {
  try {
    const relayPrivateKey = getRelayPrivateKey();
    if (!relayPrivateKey) {
      return res.status(400).json({
        success: false,
        error: "RELAY_PRIVATE_KEY not configured",
      });
    }

    const { endpoint, gunPubKey, stakeAmount, griefingRatio } = req.body;

    if (!endpoint || !gunPubKey || !stakeAmount) {
      return res.status(400).json({
        success: false,
        error: "endpoint, gunPubKey, and stakeAmount are required",
      });
    }

    const client = createRegistryClientWithSigner(relayPrivateKey, REGISTRY_CHAIN_ID);

    // Check if already registered
    const existing = await client.getRelayInfo(client.wallet.address);
    if (existing && existing.status !== "Inactive") {
      return res.status(400).json({
        success: false,
        error: "Relay already registered",
        currentStatus: existing.status,
      });
    }

    // Convert stakeAmount to string if it's a number (for backward compatibility)
    const stakeAmountStr = typeof stakeAmount === "number" ? stakeAmount.toString() : String(stakeAmount);

    // Use provided griefingRatio or default to 0 (contract will use default)
    const finalGriefingRatio: number = griefingRatio !== undefined ? parseInt(griefingRatio) : 0;

    loggers.registry.info({ endpoint }, "Registering relay on-chain");
    const result = await client.registerRelay(endpoint, gunPubKey, stakeAmountStr, finalGriefingRatio);

    res.json({
      success: true,
      message: "Relay registered successfully",
      ...result,
    });
  } catch (error: any) {
    loggers.registry.error({ err: error }, "Registration error");
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/registry/update
 *
 * Update relay endpoint and/or pubkey
 */
router.post("/update", async (req: Request, res: Response) => {
  try {
    const relayPrivateKey = getRelayPrivateKey();
    if (!relayPrivateKey) {
      return res.status(400).json({
        success: false,
        error: "RELAY_PRIVATE_KEY not configured",
      });
    }

    const { newEndpoint, newGunPubKey } = req.body;

    if (!newEndpoint && !newGunPubKey) {
      return res.status(400).json({
        success: false,
        error: "At least one of newEndpoint or newGunPubKey required",
      });
    }

    const client = createRegistryClientWithSigner(relayPrivateKey, REGISTRY_CHAIN_ID);
    const result = await client.updateRelay(newEndpoint || "", newGunPubKey || "");

    res.json({
      success: true,
      message: "Relay updated successfully",
      ...result,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/registry/stake/increase
 *
 * Increase stake amount
 */
router.post("/stake/increase", async (req: Request, res: Response) => {
  try {
    const relayPrivateKey = getRelayPrivateKey();
    if (!relayPrivateKey) {
      return res.status(400).json({
        success: false,
        error: "RELAY_PRIVATE_KEY not configured",
      });
    }

    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({
        success: false,
        error: "amount is required (USDC)",
      });
    }

    // Convert amount to string if it's a number (for backward compatibility)
    const amountStr = typeof amount === "number" ? amount.toString() : String(amount);

    const client = createRegistryClientWithSigner(relayPrivateKey, REGISTRY_CHAIN_ID);
    const result = await client.increaseStake(amountStr);

    res.json({
      success: true,
      message: `Stake increased by ${amount} USDC`,
      ...result,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/registry/stake/unstake
 *
 * Request to unstake (starts 7-day delay)
 */
router.post("/stake/unstake", async (req: Request, res: Response) => {
  try {
    const relayPrivateKey = getRelayPrivateKey();
    if (!relayPrivateKey) {
      return res.status(400).json({
        success: false,
        error: "RELAY_PRIVATE_KEY not configured",
      });
    }

    const client = createRegistryClientWithSigner(relayPrivateKey, REGISTRY_CHAIN_ID);

    // Get current info
    const info = await client.getRelayInfo(client.wallet.address);
    if (!info || info.status !== "Active") {
      return res.status(400).json({
        success: false,
        error: "Relay must be Active to request unstake",
        currentStatus: info?.status || "Not registered",
      });
    }

    const result = await client.requestUnstake();
    const params = await client.getRegistryParams();

    res.json({
      success: true,
      message: "Unstake requested - stake will be available after delay period",
      unstakingDelayDays: params.unstakingDelayDays,
      stakedAmount: info.stakedAmount,
      ...result,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/registry/stake/withdraw
 *
 * Withdraw stake after unstaking delay
 */
router.post("/stake/withdraw", async (req: Request, res: Response) => {
  try {
    const relayPrivateKey = getRelayPrivateKey();
    if (!relayPrivateKey) {
      return res.status(400).json({
        success: false,
        error: "RELAY_PRIVATE_KEY not configured",
      });
    }

    const client = createRegistryClientWithSigner(relayPrivateKey, REGISTRY_CHAIN_ID);

    // Check status
    const info = await client.getRelayInfo(client.wallet.address);
    if (!info || info.status !== "Unstaking") {
      return res.status(400).json({
        success: false,
        error: "Relay must be in Unstaking status",
        currentStatus: info?.status || "Not registered",
      });
    }

    const result = await client.withdrawStake();

    res.json({
      success: true,
      message: "Stake withdrawn successfully",
      withdrawnAmount: info.stakedAmount,
      ...result,
    });
  } catch (error: any) {
    // Check for delay not passed error
    if (error.message.includes("UnstakingDelayNotPassed")) {
      return res.status(400).json({
        success: false,
        error: "Unstaking delay has not passed yet",
      });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/registry/unstake
 *
 * Alias for /stake/unstake (for backward compatibility)
 */
router.post("/unstake", async (req: Request, res: Response) => {
  try {
    const relayPrivateKey = getRelayPrivateKey();
    if (!relayPrivateKey) {
      return res.status(400).json({
        success: false,
        error: "RELAY_PRIVATE_KEY not configured",
      });
    }

    const client = createRegistryClientWithSigner(relayPrivateKey, REGISTRY_CHAIN_ID);

    // Get current info
    const info = await client.getRelayInfo(client.wallet.address);
    if (!info || info.status !== "Active") {
      return res.status(400).json({
        success: false,
        error: "Relay must be Active to request unstake",
        currentStatus: info?.status || "Not registered",
      });
    }

    const result = await client.requestUnstake();
    const params = await client.getRegistryParams();

    res.json({
      success: true,
      message: "Unstake requested - stake will be available after delay period",
      unstakingDelayDays: params.unstakingDelayDays,
      stakedAmount: info.stakedAmount,
      ...result,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/registry/withdraw
 *
 * Alias for /stake/withdraw (for backward compatibility)
 */
router.post("/withdraw", async (req: Request, res: Response) => {
  try {
    const relayPrivateKey = getRelayPrivateKey();
    if (!relayPrivateKey) {
      return res.status(400).json({
        success: false,
        error: "RELAY_PRIVATE_KEY not configured",
      });
    }

    const client = createRegistryClientWithSigner(relayPrivateKey, REGISTRY_CHAIN_ID);

    // Check status
    const info = await client.getRelayInfo(client.wallet.address);
    if (!info || info.status !== "Unstaking") {
      return res.status(400).json({
        success: false,
        error: "Relay must be in Unstaking status",
        currentStatus: info?.status || "Not registered",
      });
    }

    const result = await client.withdrawStake();

    res.json({
      success: true,
      message: "Stake withdrawn successfully",
      withdrawnAmount: info.stakedAmount,
      ...result,
    });
  } catch (error: any) {
    // Check for delay not passed error
    if (error.message.includes("UnstakingDelayNotPassed")) {
      return res.status(400).json({
        success: false,
        error: "Unstaking delay has not passed yet",
      });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/registry/emergency-withdraw
 *
 * Owner-only rescue of tokens from registry contract
 */
router.post("/emergency-withdraw", async (req: Request, res: Response) => {
  try {
    const relayPrivateKey = getRelayPrivateKey();
    if (!relayPrivateKey) {
      return res.status(400).json({
        success: false,
        error: "RELAY_PRIVATE_KEY not configured",
      });
    }

    const { tokenAddress, amount, amountRaw } = req.body;
    if (!tokenAddress || (!amount && !amountRaw)) {
      return res.status(400).json({
        success: false,
        error: "tokenAddress and amount (or amountRaw) are required",
      });
    }

    const client = createRegistryClientWithSigner(relayPrivateKey, REGISTRY_CHAIN_ID);
    const { ethers } = await import("ethers");
    const { ERC20_ABI } = await import("shogun-contracts-sdk");

    let amountWei: bigint;
    if (amountRaw) {
      amountWei = BigInt(amountRaw);
    } else {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, client.provider);
      let decimals = 6;
      try {
        decimals = Number(await token.decimals());
      } catch {}
      amountWei = ethers.parseUnits(String(amount), decimals);
    }

    const registry = client.relayRegistry.getContract();
    const tx = await registry.emergencyWithdraw(tokenAddress, amountWei);
    const receipt = await tx.wait();

    res.json({
      success: true,
      message: "Emergency withdraw sent",
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/registry/deal/register
 *
 * Register a storage deal on-chain
 */
router.post("/deal/register", async (req: Request, res: Response) => {
  try {
    const relayPrivateKey = getRelayPrivateKey();
    if (!relayPrivateKey) {
      return res.status(400).json({
        success: false,
        error: "RELAY_PRIVATE_KEY not configured",
      });
    }

    const { dealId, clientAddress, cid, sizeMB, priceUSDC, durationDays, clientStake } = req.body;

    if (!clientAddress || !cid || !sizeMB || !priceUSDC || !durationDays) {
      return res.status(400).json({
        success: false,
        error: "clientAddress, cid, sizeMB, priceUSDC, durationDays are required",
      });
    }

    const client = createRegistryClientWithSigner(relayPrivateKey, REGISTRY_CHAIN_ID);

    // Generate deal ID if not provided
    const finalDealId: string = dealId || generateDealId(cid, clientAddress);

    // Use provided clientStake or default to '0'
    const finalClientStake: string = clientStake || "0";

    const result = await client.registerDeal(
      finalDealId,
      clientAddress,
      cid,
      sizeMB,
      priceUSDC,
      durationDays,
      finalClientStake
    );

    res.json({
      success: true,
      message: "Deal registered on-chain",
      dealId: finalDealId,
      ...result,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/registry/deal/complete
 *
 * Mark a deal as completed
 */
router.post("/deal/complete", async (req: Request, res: Response) => {
  try {
    const relayPrivateKey = getRelayPrivateKey();
    if (!relayPrivateKey) {
      return res.status(400).json({
        success: false,
        error: "RELAY_PRIVATE_KEY not configured",
      });
    }

    const { dealId } = req.body;

    if (!dealId) {
      return res.status(400).json({
        success: false,
        error: "dealId is required",
      });
    }

    const client = createRegistryClientWithSigner(relayPrivateKey, REGISTRY_CHAIN_ID);
    const result = await client.completeDeal(dealId);

    res.json({
      success: true,
      message: "Deal marked as completed",
      ...result,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/registry/deals
 *
 * Get all deals for this relay from StorageDealRegistry
 * Note: Payment is automatically transferred to relay when registerDeal() is called
 * The relay receives payment immediately upon deal registration (via safeTransferFrom in the contract)
 */
router.get("/deals", async (req: Request, res: Response) => {
  try {
    const relayPrivateKey = getRelayPrivateKey();
    if (!relayPrivateKey) {
      return res.status(400).json({
        success: false,
        error: "RELAY_PRIVATE_KEY not configured",
      });
    }

    const { createStorageDealRegistryClient } = await import("../utils/registry-client.js");
    const storageDealRegistryClient = createStorageDealRegistryClient(REGISTRY_CHAIN_ID);
    const registryClient = createRegistryClientWithSigner(relayPrivateKey, REGISTRY_CHAIN_ID);
    const relayAddress: string = registryClient.wallet.address;

    // Get deals from StorageDealRegistry (not from RelayRegistry)
    const deals = await storageDealRegistryClient.getRelayDeals(relayAddress);

    // Enrich deals with payment status
    // Payment is automatically received when registerDeal() is called (via safeTransferFrom)
    // Note: If deal.active is false, it means registerDeal() was called but the deal is not active
    // This could mean the deal expired, was terminated, or was never properly activated
    const enrichedDeals = deals.map((deal: any) => ({
      ...deal,
      paymentReceived: deal.active && deal.createdAt !== "1970-01-01T00:00:00.000Z", // Payment received when deal is active and created
      // If deal exists on-chain but is not active, payment status depends on whether registerDeal was called
      // If registerDeal was called, payment was received (even if deal is now inactive)
      // If registerDeal was NOT called, payment is still pending
      paymentStatus: deal.active
        ? "paid"
        : deal.createdAt && deal.createdAt !== "1970-01-01T00:00:00.000Z"
          ? "paid"
          : "pending",
      canWithdraw: false, // Payment is already in relay wallet - no withdrawal needed
    }));

    res.json({
      success: true,
      relayAddress,
      dealCount: deals.length,
      deals: enrichedDeals,
      note: "Payment is automatically transferred to relay wallet when registerDeal() is called. No manual withdrawal needed.",
    });
  } catch (error: any) {
    loggers.registry.error({ err: error }, "Error fetching relay deals");
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/registry/config
 *
 * Get current registry configuration (addresses, chain info)
 */
router.get("/config", async (req: Request, res: Response) => {
  try {
    const { CONTRACTS_CONFIG, getConfigByChainId } = await import("shogun-contracts-sdk");
    const config = getConfigByChainId(REGISTRY_CHAIN_ID);

    if (!config) {
      return res.status(404).json({
        success: false,
        error: `No configuration found for chain ID ${REGISTRY_CHAIN_ID}`,
      });
    }

    // Get network name
    const networkName: string =
      Object.keys(CONTRACTS_CONFIG).find(
        (key: string) => (CONTRACTS_CONFIG as any)[key].chainId === REGISTRY_CHAIN_ID
      ) || "Unknown";

    res.json({
      success: true,
      chainId: REGISTRY_CHAIN_ID,
      chainName:
        networkName === "baseSepolia"
          ? "Base Sepolia"
          : networkName === "base"
            ? "Base Mainnet"
            : networkName,
      registryAddress: config.relayRegistry,
      usdcAddress: config.usdc,
      configured: !!getRelayPrivateKey(),
      explorerUrl: config.explorer,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/v1/registry/grief/missed-proof
 *
 * Report a missed proof
 */
router.post("/grief/missed-proof", async (req: Request, res: Response) => {
  try {
    const relayPrivateKey = getRelayPrivateKey();
    if (!relayPrivateKey) {
      return res.status(400).json({ success: false, error: "RELAY_PRIVATE_KEY not configured" });
    }
    const { relayAddress, dealId, evidence } = req.body;
    if (!relayAddress || !dealId || !evidence) {
      return res
        .status(400)
        .json({ success: false, error: "relayAddress, dealId, and evidence are required" });
    }

    const client = createRegistryClientWithSigner(relayPrivateKey, REGISTRY_CHAIN_ID);
    const result = await client.griefMissedProof(relayAddress, dealId, evidence);
    res.json({ success: true, message: "Missed proof reported", ...result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/registry/grief/data-loss
 *
 * Report data loss
 */
router.post("/grief/data-loss", async (req: Request, res: Response) => {
  try {
    const relayPrivateKey = getRelayPrivateKey();
    if (!relayPrivateKey) {
      return res.status(400).json({ success: false, error: "RELAY_PRIVATE_KEY not configured" });
    }
    const { relayAddress, dealId, evidence } = req.body;
    if (!relayAddress || !dealId || !evidence) {
      return res
        .status(400)
        .json({ success: false, error: "relayAddress, dealId, and evidence are required" });
    }

    const client = createRegistryClientWithSigner(relayPrivateKey, REGISTRY_CHAIN_ID);
    const result = await client.griefDataLoss(relayAddress, dealId, evidence);
    res.json({ success: true, message: "Data loss reported", ...result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/registry/deal/grief
 *
 * Grief a storage deal
 */
router.post("/deal/grief", async (req: Request, res: Response) => {
  try {
    const relayPrivateKey = getRelayPrivateKey();
    if (!relayPrivateKey) {
      return res.status(400).json({ success: false, error: "RELAY_PRIVATE_KEY not configured" });
    }
    const { dealId, slashAmount, reason } = req.body;
    if (!dealId || !slashAmount || !reason) {
      return res
        .status(400)
        .json({ success: false, error: "dealId, slashAmount, and reason are required" });
    }

    const { createStorageDealRegistryClientWithSigner } =
      await import("../utils/registry-client.js");
    const client = createStorageDealRegistryClientWithSigner(relayPrivateKey, REGISTRY_CHAIN_ID);
    const result = await client.grief(dealId, slashAmount, reason);
    res.json({ success: true, message: "Deal griefed", ...result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/registry/debug/wallet
 *
 * Debug endpoint to verify wallet address derivation from current private key.
 * Shows where the key is coming from and what address it maps to.
 * Useful for troubleshooting caching issues.
 */
router.get("/debug/wallet", async (req: Request, res: Response) => {
  try {
    const { ethers } = await import("ethers");
    
    // Read directly from process.env (no caching)
    const relayPrivateKeyFromEnv = process.env.RELAY_PRIVATE_KEY;
    const privateKeyFromEnv = process.env.PRIVATE_KEY;
    const keyFromConfig = registryConfig.relayPrivateKey;
    const keyFromGetter = getRelayPrivateKey();

    const results: any = {
      timestamp: new Date().toISOString(),
      sources: {
        RELAY_PRIVATE_KEY: relayPrivateKeyFromEnv ? {
          present: true,
          length: relayPrivateKeyFromEnv.length,
          prefix: relayPrivateKeyFromEnv.slice(0, 6),
          suffix: relayPrivateKeyFromEnv.slice(-4),
        } : { present: false },
        PRIVATE_KEY: privateKeyFromEnv ? {
          present: true,
          length: privateKeyFromEnv.length,
          prefix: privateKeyFromEnv.slice(0, 6),
          suffix: privateKeyFromEnv.slice(-4),
        } : { present: false },
        configCached: keyFromConfig ? {
          present: true,
          length: keyFromConfig.length,
          prefix: keyFromConfig.slice(0, 6),
          suffix: keyFromConfig.slice(-4),
        } : { present: false },
        getterFunction: keyFromGetter ? {
          present: true,
          length: keyFromGetter.length,
          prefix: keyFromGetter.slice(0, 6),
          suffix: keyFromGetter.slice(-4),
        } : { present: false },
      },
      addresses: {} as any,
      match: false,
    };

    // Compute addresses for each source
    if (relayPrivateKeyFromEnv) {
      try {
        const wallet = new ethers.Wallet(relayPrivateKeyFromEnv);
        results.addresses.fromRELAY_PRIVATE_KEY = wallet.address;
      } catch (e: any) {
        results.addresses.fromRELAY_PRIVATE_KEY = `Error: ${e.message}`;
      }
    }

    if (privateKeyFromEnv) {
      try {
        const wallet = new ethers.Wallet(privateKeyFromEnv);
        results.addresses.fromPRIVATE_KEY = wallet.address;
      } catch (e: any) {
        results.addresses.fromPRIVATE_KEY = `Error: ${e.message}`;
      }
    }

    if (keyFromConfig) {
      try {
        const wallet = new ethers.Wallet(keyFromConfig);
        results.addresses.fromConfigCached = wallet.address;
      } catch (e: any) {
        results.addresses.fromConfigCached = `Error: ${e.message}`;
      }
    }

    if (keyFromGetter) {
      try {
        const wallet = new ethers.Wallet(keyFromGetter);
        results.addresses.fromGetterFunction = wallet.address;
      } catch (e: any) {
        results.addresses.fromGetterFunction = `Error: ${e.message}`;
      }
    }

    // Check if all addresses match
    const addressValues = Object.values(results.addresses).filter(
      (a: any) => typeof a === 'string' && a.startsWith('0x')
    );
    results.match = addressValues.length > 0 && 
      addressValues.every((a: any) => a === addressValues[0]);
    
    results.activeAddress = results.addresses.fromGetterFunction || 
      results.addresses.fromRELAY_PRIVATE_KEY || 
      results.addresses.fromPRIVATE_KEY || 
      'Not configured';

    res.json({
      success: true,
      debug: results,
      note: "If addresses don't match, there's a caching issue. Restart the container to refresh.",
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Log all registered routes for debugging
if (process.env.NODE_ENV !== "production") {
  const routes: string[] = [];
  router.stack.forEach((middleware: any) => {
    if (middleware.route) {
      const methods = Object.keys(middleware.route.methods).join(",").toUpperCase();
      routes.push(`${methods} ${middleware.route.path}`);
    }
  });
  loggers.registry.debug({ routes }, "Registry routes registered");
}

export default router;
