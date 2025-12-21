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

import express, { Request, Response, Router } from "express";
import http from "http";
import https from "https";
import crypto from "crypto";
import multer from "multer";
import FormData from "form-data";
import { ethers } from "ethers";
import * as StorageDeals from "../utils/storage-deals";
import type { Deal } from "../utils/storage-deals";
import * as ErasureCoding from "../utils/erasure-coding";
import * as FrozenData from "../utils/frozen-data.js";
import { getRelayUser, getRelayPub } from "../utils/relay-user";
import { X402Merchant } from "../utils/x402-merchant";
import * as Reputation from "../utils/relay-reputation";
import { ipfsUpload, ipfsRequest } from "../utils/ipfs-client";
import {
  createRegistryClient,
  createRegistryClientWithSigner,
  createStorageDealRegistryClient,
  createStorageDealRegistryClientWithSigner,
} from "../utils/registry-client";
import * as DealSync from "../utils/deal-sync";
import { loggers } from "../utils/logger";
import {
  registryConfig,
  ipfsConfig,
  replicationConfig,
  serverConfig,
  x402Config,
  authConfig,
  relayKeysConfig,
  relayConfig,
} from "../config";
import { getConfigByChainId } from "shogun-contracts-sdk";

const router: Router = express.Router();
// IPFS_API_TOKEN is handled by ipfs-client.js
const IPFS_API_TOKEN: string | undefined = ipfsConfig.apiToken;

// In-memory cache for recently created deals (GunDB sync can be slow)
// Deals are cached for 10 minutes to allow time for payment
const pendingDealsCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function cacheDeal(deal: Deal) {
  pendingDealsCache.set(deal.id, {
    deal,
    cachedAt: Date.now(),
  });

  // Clean expired entries
  for (const [id, entry] of pendingDealsCache) {
    if (Date.now() - (entry as any).cachedAt > CACHE_TTL) {
      pendingDealsCache.delete(id);
    }
  }
}

function getCachedDeal(dealId: string): Deal | null {
  const entry = pendingDealsCache.get(dealId) as { deal: Deal; cachedAt: number } | undefined;
  if (entry && Date.now() - entry.cachedAt < CACHE_TTL) {
    return entry.deal;
  }
  pendingDealsCache.delete(dealId);
  return null;
}

function removeCachedDeal(dealId: string) {
  pendingDealsCache.delete(dealId);
}

/**
 * Apply tier-specific features (erasure coding and replication)
 * Called automatically when premium/enterprise deals are activated
 *
 * @param {object} deal - Activated deal
 * @param {object} req - Express request object (for accessing app context)
 */
async function applyTierFeatures(deal: Deal, req: Request) {
  if (!req || !req.app) {
    loggers.server.warn("⚠️ Request context not available, skipping tier features");
    return;
  }

  const gun = req.app.get("gunInstance");
  if (!gun) {
    loggers.server.warn("⚠️ Gun not available, skipping tier features");
    return;
  }

  const cid = deal.cid;
  const replicationFactor = deal.replicationFactor || 1;
  const shouldApplyErasure = deal.erasureCoding || false;

  loggers.server.info(
    { dealId: deal.id, erasureCoding: shouldApplyErasure, replicationFactor },
    `🔧 Applying tier features for deal ${deal.id}:`
  );
  loggers.server.debug(`   - Erasure Coding: ${shouldApplyErasure ? "Yes" : "No"}`);
  loggers.server.debug(`   - Replication Factor: ${replicationFactor}x`);

  // Apply erasure coding if enabled
  if (shouldApplyErasure) {
    try {
      loggers.server.info({ cid }, `📦 Applying erasure coding to CID: ${cid}`);

      // Helper function to download from IPFS
      const downloadFromIPFS = async (cidToDownload: string): Promise<Buffer> => {
        const result = await ipfsRequest(`/cat?arg=${encodeURIComponent(cidToDownload)}`, {
          responseType: "arraybuffer",
        });
        return Buffer.isBuffer(result) ? result : Buffer.from(result as ArrayBuffer);
      };

      // Helper function to upload buffer to IPFS
      const uploadToIPFS = async (buffer: Buffer, filename = "chunk"): Promise<string> => {
        const form = new FormData();
        form.append("file", buffer, {
          filename: filename,
          contentType: "application/octet-stream",
        });

        // Use unified ipfsUpload
        const result = await ipfsUpload("/api/v0/add?pin=true", form);
        return result.Hash;
      };

      // Step 1: Download file from IPFS
      loggers.server.debug({ cid }, `📥 Downloading file from IPFS: ${cid}`);
      const fileData = await downloadFromIPFS(cid);
      loggers.server.debug(
        { cid, sizeMB: (fileData.length / 1024 / 1024).toFixed(2) },
        `✅ Downloaded ${(fileData.length / 1024 / 1024).toFixed(2)} MB`
      );

      // Step 2: Apply erasure coding
      const erasureConfig = {
        chunkSize: 256 * 1024, // 256KB chunks
        dataChunks: 10, // 10 data chunks
        parityChunks: 4, // 4 parity chunks (40% redundancy)
        minChunksForRecovery: 10, // Need 10 chunks to recover
      };

      loggers.server.debug({ cid }, `🔧 Encoding data with erasure coding...`);
      const encoded = ErasureCoding.encodeData(fileData as any, erasureConfig);

      loggers.server.info(
        {
          cid,
          dataChunks: encoded.dataChunkCount,
          parityChunks: encoded.parityChunkCount,
        },
        `✅ Encoded into ${encoded.dataChunkCount} data chunks + ${encoded.parityChunkCount} parity chunks`
      );

      // Step 3: Upload all chunks to IPFS
      loggers.server.debug({ cid }, `📤 Uploading chunks to IPFS...`);
      const chunkCids = [];

      // Upload data chunks
      for (let i = 0; i < encoded.dataChunks.length; i++) {
        const chunkCid = await uploadToIPFS(encoded.dataChunks[i], `data-chunk-${i}`);
        const chunkInfo = encoded.chunks[i]; // chunkInfos array has metadata
        chunkCids.push({
          type: "data",
          index: i,
          cid: chunkCid,
          hash: chunkInfo.hash,
          size: chunkInfo.size,
        });
        loggers.server.debug(
          { cid, chunkCid, index: i + 1, total: encoded.dataChunkCount },
          `  ✅ Data chunk ${i + 1}/${encoded.dataChunkCount}: ${chunkCid}`
        );
      }

      // Upload parity chunks
      for (let i = 0; i < encoded.parityChunks.length; i++) {
        const parityIndex = encoded.dataChunkCount + i;
        const parityCid = await uploadToIPFS(encoded.parityChunks[i], `parity-chunk-${i}`);
        const chunkInfo = encoded.chunks[parityIndex]; // chunkInfos includes both data and parity
        chunkCids.push({
          type: "parity",
          index: i,
          cid: parityCid,
          hash: chunkInfo.hash,
          size: chunkInfo.size,
        });
        loggers.server.debug(
          { cid, parityCid, index: i + 1, total: encoded.parityChunkCount },
          `  ✅ Parity chunk ${i + 1}/${encoded.parityChunkCount}: ${parityCid}`
        );
      }

      // Step 4: Store erasure metadata in deal
      const erasureMetadata = {
        originalCid: cid,
        originalSize: fileData.length,
        chunkSize: erasureConfig.chunkSize,
        dataChunks: encoded.dataChunkCount,
        parityChunks: encoded.parityChunkCount,
        minChunksForRecovery: erasureConfig.minChunksForRecovery,
        redundancyPercent: encoded.redundancyPercent,
        chunks: chunkCids,
        encodedAt: Date.now(),
      };

      deal.erasureMetadata = erasureMetadata;

      // Save updated deal with erasure metadata
      const relayUser = getRelayUser();
      if (relayUser && (relayUser as any)?._?.sea) {
        await StorageDeals.saveDeal(gun, deal, (relayUser as any)._?.sea);
        loggers.server.info(
          { dealId: deal.id },
          `✅ Erasure coding metadata saved to deal ${deal.id}`
        );
      }

      loggers.server.info(
        {
          dealId: deal.id,
          cid,
          totalChunks: chunkCids.length,
          dataChunks: encoded.dataChunkCount,
          parityChunks: encoded.parityChunkCount,
          redundancyPercent: encoded.redundancyPercent,
        },
        `✅ Erasure coding completed successfully for deal ${deal.id}`
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggers.server.error({ err: error, dealId: deal.id, cid }, `❌ Erasure coding failed`);
      // Don't throw - deal is still active without erasure coding
      // But log the error for debugging
      (deal as any).erasureCodingError = {
        message: errorMessage,
        timestamp: Date.now(),
      };
    }
  }

  // Apply replication if replicationFactor > 1
  if (replicationFactor > 1) {
    try {
      loggers.server.info(
        { cid, replicationFactor },
        `🔄 Requesting ${replicationFactor}x replication for CID: ${cid}`
      );

      // Use network pin-request to request replication
      const autoReplication = replicationConfig.autoReplication !== false;
      if (autoReplication) {
        // Publish pin request to network via GunDB
        const relayPub = req.app.get("relayUserPub");
        const requestId = crypto.randomBytes(8).toString("hex");

        const pinRequest = {
          id: requestId,
          cid,
          requester: relayPub,
          replicationFactor,
          priority: deal.tier === "enterprise" ? "high" : "normal",
          timestamp: Date.now(),
          status: "pending",
          dealId: deal.id,
        };

        gun.get("shogun-network").get("pin-requests").get(requestId).put(pinRequest);
        loggers.server.info(
          { cid, replicationFactor, requestId },
          `✅ Replication request published: ${cid} (${replicationFactor}x)`
        );

        // Update deal with replication request info
        (deal as any).replicationRequestId = requestId;
        (deal as any).replicationRequestedAt = Date.now();

        // Save updated deal
        const relayUser = getRelayUser();
        if (relayUser && (relayUser as any)._ && (relayUser as any)._?.sea) {
          await StorageDeals.saveDeal(gun, deal, (relayUser as any)._?.sea);
        }
      } else {
        loggers.server.info({ cid }, `⚠️ Auto-replication disabled - replication not requested`);
      }
    } catch (error: unknown) {
      loggers.server.error({ err: error, cid }, `❌ Replication request failed`);
      // Don't throw - deal is still active without replication
    }
  }
}

// Configure multer for deal uploads
const dealUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max for deal uploads
  },
});

/**
 * GET /api/v1/deals/pricing
 *
 * Get pricing information for storage deals.
 */
router.get("/pricing", (req: Request, res: Response) => {
  try {
    const sizeMBRaw = req.query.sizeMB;
    const durationDaysRaw = req.query.durationDays;
    const tierRaw = req.query.tier;

    const sizeMB = Array.isArray(sizeMBRaw) ? sizeMBRaw[0] : sizeMBRaw;
    const durationDays = Array.isArray(durationDaysRaw) ? durationDaysRaw[0] : durationDaysRaw;
    const tier = Array.isArray(tierRaw) ? tierRaw[0] : tierRaw;

    // If parameters provided, calculate specific price
    const size = sizeMB ? parseFloat(String(sizeMB)) : 0;
    const duration = durationDays ? parseInt(String(durationDays), 10) : 0;

    if (size > 0 && duration > 0) {
      const pricing = StorageDeals.calculateDealPrice(
        size,
        duration,
        tier && typeof tier === "string" ? tier : "standard"
      );

      return res.json({
        success: true,
        pricing,
      });
    }

    // Return general pricing info (when params missing or invalid)
    // This exposes the relay's pricing configuration to clients
    res.json({
      success: true,
      tiers: StorageDeals.PRICING,
      note: "These are the pricing tiers configured for this relay. Prices may vary between relays.",
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(400).json({ success: false, error: errorMessage });
  }
});

/**
 * POST /api/v1/deals/upload
 *
 * Upload a file to IPFS for deal creation.
 * This endpoint allows uploads without subscription - payment is via deal.
 * Requires wallet address for tracking.
 */
router.post("/upload", dealUpload.single("file"), async (req, res) => {
  try {
    const walletAddress = req.headers["x-wallet-address"] || req.body.walletAddress;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: "Wallet address required (x-wallet-address header or walletAddress body param)",
      });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file provided" });
    }

    loggers.server.info(
      {
        filename: req.file.originalname,
        sizeMB: (req.file.size / 1024 / 1024).toFixed(2),
        walletAddress,
      },
      `📤 Deal upload: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB) from ${walletAddress}`
    );

    // Upload to IPFS using utility with automatic retry
    const form = new FormData();
    form.append("file", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    const ipfsResult = await ipfsUpload("/api/v0/add?pin=true", form, {
      timeout: 60000,
      maxRetries: 3,
      retryDelay: 1000,
    });

    const cid = ipfsResult.Hash;
    const sizeMB = (req.file.size / (1024 * 1024)).toFixed(2);

    loggers.server.info(
      { cid, sizeMB, walletAddress },
      `✅ Deal upload success: ${cid} (${sizeMB} MB)`
    );

    res.json({
      success: true,
      cid,
      name: req.file.originalname,
      sizeMB: parseFloat(sizeMB),
      sizeBytes: req.file.size,
      walletAddress,
      note: "File uploaded. Create a deal to ensure long-term storage.",
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "❌ Deal upload error");
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/v1/deals/overhead
 *
 * Calculate erasure coding overhead for a file size.
 */
router.get("/overhead", (req: Request, res: Response) => {
  try {
    const sizeMBRaw = req.query.sizeMB;
    const sizeMB = sizeMBRaw
      ? parseFloat(String(Array.isArray(sizeMBRaw) ? sizeMBRaw[0] : sizeMBRaw))
      : 1;
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
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(400).json({ success: false, error: errorMessage });
  }
});

/**
 * POST /api/v1/deals/create
 *
 * Create a new storage deal.
 * Returns payment requirements for x402.
 */
router.post("/create", express.json(), async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    const relayUser = getRelayUser();
    const relayPub = getRelayPub();

    if (!gun || !relayUser || !relayPub) {
      return res.status(503).json({
        success: false,
        error: "Relay not fully initialized",
      });
    }

    // Check if relay user has SEA keys
    const keyPair = (relayUser as any)?._?.sea;
    if (!keyPair) {
      console.error("Relay user SEA keys not available");
      return res.status(503).json({
        success: false,
        error: "Relay authentication not ready",
      });
    }

    const {
      cid,
      clientAddress,
      sizeMB,
      durationDays,
      tier = "standard",
      erasureMetadata = null,
      relayAddress, // Optional: relay address from on-chain registry
    } = req.body;

    // Validate required fields
    if (!cid || !clientAddress || !sizeMB || !durationDays) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: cid, clientAddress, sizeMB, durationDays",
      });
    }

    // Determine which relay to use
    let selectedRelayPub = relayPub;
    let selectedRelayAddress = null;
    let selectedRelayReputation = null;

    // Return payment instructions for USDC transfer
    // Client must transfer USDC to relay address, then relay will register deal on-chain
    const REGISTRY_CHAIN_ID = registryConfig.chainId;
    const RELAY_PRIVATE_KEY = registryConfig.relayPrivateKey;

    // If relayAddress is provided, verify it's registered and get its info
    if (relayAddress) {
      try {
        if (REGISTRY_CHAIN_ID) {
          const registryClient = createRegistryClient(REGISTRY_CHAIN_ID);
          const relayInfo = await registryClient.getRelayInfo(relayAddress);

          if (!relayInfo || relayInfo.status !== "Active") {
            return res.status(400).json({
              success: false,
              error: `Relay ${relayAddress} is not active in the registry`,
            });
          }

          // Use the relay's GunDB pubkey from registry
          selectedRelayPub = relayInfo.gunPubKey;
          selectedRelayAddress = relayAddress;

          // Get reputation for selected relay (if host can be determined)
          // Try to get reputation by host or pubkey
          try {
            const gun = req.app.get("gunInstance");
            if (gun && relayInfo.host) {
              selectedRelayReputation = await Reputation.getReputation(gun, relayInfo.host);
            }
          } catch (repError: unknown) {
            const repErrorMessage = repError instanceof Error ? repError.message : String(repError);
            loggers.server.warn(
              { err: repError, relayAddress },
              "Could not fetch reputation for selected relay"
            );
          }
        } else {
          return res.status(400).json({
            success: false,
            error: "Registry not configured. Cannot verify relay address.",
          });
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("Error verifying relay address:", error);
        return res.status(400).json({
          success: false,
          error: `Failed to verify relay: ${errorMessage}`,
        });
      }
    } else {
      // If no relay specified, get reputation for current relay
      try {
        const gun = req.app.get("gunInstance");
        const host = relayConfig.endpoint || req.headers.host || "localhost";
        if (gun) {
          selectedRelayReputation = await Reputation.getReputation(gun, host);
        }
      } catch (repError: unknown) {
        const repErrorMessage = repError instanceof Error ? repError.message : String(repError);
        loggers.server.warn({ err: repError }, "Could not fetch reputation for current relay");
      }
    }

    // Calculate pricing
    const pricing = StorageDeals.calculateDealPrice(
      parseFloat(sizeMB),
      parseInt(durationDays),
      tier
    );

    // Create deal (pending payment)
    const deal = StorageDeals.createDeal(
      cid,
      clientAddress,
      selectedRelayPub,
      parseFloat(sizeMB),
      parseInt(durationDays, 10),
      tier
    );
    if (erasureMetadata) {
      (deal as any).erasureMetadata = erasureMetadata;
    }

    // Store relay address if provided
    if (selectedRelayAddress) {
      deal.onChainRelay = selectedRelayAddress;
    }

    // Save to GunDB (frozen)
    await StorageDeals.saveDeal(gun, deal, keyPair);

    // Cache deal for quick activation (GunDB sync can be slow)
    cacheDeal(deal);
    loggers.server.info(
      { dealId: deal.id, cid: deal.cid },
      `📝 Deal ${deal.id} created and cached for ${deal.cid}`
    );

    // Get the relay's wallet address for payment
    let relayWalletAddress = null;
    if (RELAY_PRIVATE_KEY && REGISTRY_CHAIN_ID) {
      const registryClient = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
      relayWalletAddress = registryClient.wallet.address;
    }

    // Prepare reputation info for response
    const reputationInfo = selectedRelayReputation
      ? {
          score: selectedRelayReputation.calculatedScore.total,
          tier: selectedRelayReputation.calculatedScore.tier,
          breakdown: selectedRelayReputation.calculatedScore.breakdown,
          hasEnoughData: selectedRelayReputation.calculatedScore.hasEnoughData,
          metrics: {
            uptimePercent: selectedRelayReputation.uptimePercent || 0,
            proofSuccessRate:
              selectedRelayReputation.proofsTotal &&
              selectedRelayReputation.proofsTotal > 0 &&
              selectedRelayReputation.proofsSuccessful !== undefined
                ? (selectedRelayReputation.proofsSuccessful / selectedRelayReputation.proofsTotal) *
                  100
                : null,
            avgResponseTimeMs: selectedRelayReputation.avgResponseTimeMs || null,
          },
        }
      : null;

    // Return 200 OK - deal created successfully, payment needed to activate
    res.json({
      success: true,
      deal: {
        id: deal.id,
        status: deal.status,
        pricing: deal.pricing,
        cid: deal.cid,
      },
      relay: {
        address: selectedRelayAddress || relayWalletAddress || null,
        pub: selectedRelayPub,
        reputation: reputationInfo,
      },
      paymentRequired: {
        type: "usdc_transfer",
        amount: pricing.totalPriceUSDC,
        amountAtomic: Math.ceil(pricing.totalPriceUSDC * 1000000).toString(),
        currency: "USDC",
        to: relayWalletAddress || "Relay address not configured",
        chainId: REGISTRY_CHAIN_ID || 84532,
        usdcAddress: (() => {
          const config = getConfigByChainId(REGISTRY_CHAIN_ID || 84532);
          return config?.usdc || null;
        })(),
        message: relayWalletAddress
          ? `Transfer ${pricing.totalPriceUSDC} USDC to ${relayWalletAddress}. After payment, the relay will register the deal on-chain.`
          : "Relay not configured. Please contact relay operator for payment instructions.",
      },
      message: "Deal created. Transfer USDC to relay address to activate.",
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    loggers.server.error({ err: error }, "Deal creation error");
    res.status(500).json({
      success: false,
      error: errorMessage,
      hint: "Check server logs for details",
    });
  }
});

/**
 * POST /api/v1/deals/:dealId/activate
 *
 * Activate a deal after payment.
 */
router.post("/:dealId/activate", express.json(), async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    const relayUser = getRelayUser();

    if (!gun || !relayUser) {
      return res.status(503).json({
        success: false,
        error: "Relay not fully initialized",
      });
    }

    const { dealId } = req.params;
    const { paymentTxHash, clientStake = "0" } = req.body;

    // Get existing deal (check cache first, then GunDB)
    let deal = getCachedDeal(dealId);

    if (!deal) {
      // Try GunDB if not in cache
      deal = await StorageDeals.getDeal(gun, dealId);
    }

    if (!deal) {
      loggers.server.warn({ dealId }, `❌ Deal not found: ${dealId}`);
      return res.status(404).json({
        success: false,
        error: "Deal not found. It may have expired or was never created.",
      });
    }

    loggers.server.info(
      { dealId, status: deal.status },
      `✅ Deal found: ${dealId} (status: ${deal.status})`
    );

    if (deal.status !== StorageDeals.DEAL_STATUS.PENDING) {
      return res.status(400).json({
        success: false,
        error: `Deal is not pending. Current status: ${deal.status}`,
      });
    }

    // Verify USDC payment was made to relay
    const RELAY_PRIVATE_KEY = registryConfig.relayPrivateKey;
    const REGISTRY_CHAIN_ID = registryConfig.chainId;

    if (!RELAY_PRIVATE_KEY || !REGISTRY_CHAIN_ID) {
      return res.status(503).json({
        success: false,
        error: "Relay not configured for on-chain operations",
      });
    }

    const registryClient = createRegistryClientWithSigner(
      RELAY_PRIVATE_KEY,
      parseInt(String(REGISTRY_CHAIN_ID))
    );
    const relayAddress = registryClient.wallet.address;
    const { ethers } = await import("ethers");

    // Verify client has approved StorageDealRegistry for payment
    // The contract will pull payment via safeTransferFrom when registerDeal is called
    try {
      const storageDealRegistryClient = createStorageDealRegistryClient(
        parseInt(String(REGISTRY_CHAIN_ID))
      );

      // Use the registry address from SDK (same as frontend uses)
      const registryAddressFromSDK = storageDealRegistryClient.sdk
        .getStorageDealRegistry()
        .getAddress();

      // Use the same provider as storageDealRegistryClient (not registryClient.provider)
      // This ensures we're using the same RPC endpoint and will see the same state
      const usdcContract = new ethers.Contract(
        storageDealRegistryClient.usdcAddress,
        ["function allowance(address owner, address spender) view returns (uint256)"],
        storageDealRegistryClient.provider // Use same provider as storageDealRegistryClient
      );

      const priceUSDCAtomic = Math.ceil(deal.pricing.totalPriceUSDC * 1000000);

      // storageDealRegistryClient.registryAddress is now always from SDK (same as frontend uses)
      const registryAddress = storageDealRegistryClient.registryAddress;

      // Log detailed information for debugging
      loggers.server.info(
        {
          dealId,
          clientAddress: deal.clientAddress,
          registryAddress: registryAddress, // Always from SDK now
          usdcAddress: storageDealRegistryClient.usdcAddress,
          priceUSDC: deal.pricing.totalPriceUSDC,
          priceUSDCAtomic: priceUSDCAtomic.toString(),
          rpcUrl:
            storageDealRegistryClient.provider.connection?.url ||
            storageDealRegistryClient.provider._getConnection?.()?.url ||
            "unknown",
        },
        `🔍 Checking allowance - Registry: ${registryAddress}, Client: ${deal.clientAddress}`
      );

      // Retry allowance check with exponential backoff (RPC nodes may lag behind)
      let allowance = 0n;
      let retries = 3;
      let lastError = null;

      while (retries > 0) {
        try {
          // Use SDK address (same as frontend)
          allowance = await usdcContract.allowance(
            deal.clientAddress,
            registryAddressFromSDK // Use SDK address instead of config address
          );

          loggers.server.info(
            {
              dealId,
              clientAddress: deal.clientAddress,
              registryAddress: registryAddressFromSDK, // Use SDK address
              allowance: allowance.toString(),
              allowanceUSDC: (Number(allowance) / 1000000).toFixed(6),
              required: priceUSDCAtomic.toString(),
              requiredUSDC: (priceUSDCAtomic / 1000000).toFixed(6),
              attempt: 4 - retries,
            },
            `Allowance check: ${allowance.toString()} (${(Number(allowance) / 1000000).toFixed(6)} USDC) - need ${priceUSDCAtomic} (${(priceUSDCAtomic / 1000000).toFixed(6)} USDC)`
          );

          if (allowance >= BigInt(priceUSDCAtomic)) {
            break; // Sufficient allowance found
          }

          // If insufficient and we have retries left, wait and retry
          if (retries > 1) {
            const waitTime = (4 - retries) * 2000; // 2s, 4s, 6s
            loggers.server.warn(
              {
                dealId,
                allowance: allowance.toString(),
                required: priceUSDCAtomic.toString(),
                waitTime,
              },
              `Insufficient allowance, waiting ${waitTime}ms before retry...`
            );
            await new Promise((resolve) => setTimeout(resolve, waitTime));
          }
        } catch (error) {
          lastError = error;
          loggers.server.warn(
            { dealId, error: String(error) },
            "Error checking allowance, retrying..."
          );
          if (retries > 1) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
        retries--;
      }

      if (allowance < BigInt(priceUSDCAtomic)) {
        loggers.server.error(
          {
            dealId,
            clientAddress: deal.clientAddress,
            registryAddress: registryAddress,
            allowance: allowance.toString(),
            allowanceUSDC: (Number(allowance) / 1000000).toFixed(6),
            required: priceUSDCAtomic.toString(),
            requiredUSDC: (priceUSDCAtomic / 1000000).toFixed(6),
            lastError: lastError ? String(lastError) : null,
            rpcUrl:
              storageDealRegistryClient.provider.connection?.url ||
              storageDealRegistryClient.provider._getConnection?.()?.url ||
              "unknown",
          },
          "Client approval insufficient after retries"
        );

        return res.status(400).json({
          success: false,
          error: `Client has not approved enough USDC. Need: ${(priceUSDCAtomic / 1000000).toFixed(6)} USDC (${priceUSDCAtomic} atomic), Approved: ${(Number(allowance) / 1000000).toFixed(6)} USDC (${allowance.toString()} atomic). Registry: ${registryAddress}. Please ensure the approval transaction has been confirmed and try again.`,
        });
      }

      loggers.server.info(
        { dealId, allowance: allowance.toString() },
        `✅ Client approval verified: ${allowance.toString()} USDC approved`
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ Could not verify approval: ${errorMessage}`);
      // Continue anyway - contract will fail if approval insufficient
    }

    // Activate deal
    loggers.server.info(
      { dealId },
      `Activating deal ${dealId} - payment will be handled by StorageDealRegistry contract`
    );

    // Register deal on-chain using StorageDealRegistry first
    // This will pull payment from client via safeTransferFrom
    let onChainRegistered = false;
    let onChainWarning = null;
    let onChainTxHash = null;
    let activatedDeal = null;

    try {
      loggers.server.info(
        { dealId },
        `📝 Registering deal ${dealId} on-chain via StorageDealRegistry...`
      );
      const storageDealRegistryClient = createStorageDealRegistryClientWithSigner(
        RELAY_PRIVATE_KEY,
        parseInt(String(REGISTRY_CHAIN_ID))
      );

      // Convert price from USDC (6 decimals) to atomic units
      const priceUSDCAtomic = Math.ceil(deal.pricing.totalPriceUSDC * 1000000);
      const priceUSDCString = (priceUSDCAtomic / 1000000).toString();

      // Convert sizeMB to integer (contract expects uint256)
      const sizeMBInt = Math.max(1, Math.ceil(deal.sizeMB));

      const onChainResult = await storageDealRegistryClient.registerDeal(
        deal.id,
        deal.clientAddress,
        deal.cid,
        sizeMBInt,
        priceUSDCString,
        deal.durationDays,
        clientStake
      );

      onChainRegistered = true;
      onChainTxHash = onChainResult.txHash;

      loggers.server.info(
        {
          dealId: deal.id,
          txHash: onChainResult.txHash,
          onChainDealId: onChainResult.dealIdBytes32,
        },
        `✅ Deal registered on-chain via StorageDealRegistry. TX: ${onChainResult.txHash}`
      );
      loggers.server.debug(`   Original Deal ID: ${deal.id}`);
      loggers.server.debug(`   On-Chain Deal ID (bytes32): ${onChainResult.dealIdBytes32}`);

      // Activate deal with on-chain transaction hash as payment proof
      activatedDeal = StorageDeals.activateDeal(deal);
      (activatedDeal as any).paymentTx = onChainTxHash;
      loggers.server.info(
        { dealId, status: activatedDeal.status },
        `Deal activated object created, status: ${activatedDeal.status}`
      );

      // Save on-chain deal ID to the deal object
      activatedDeal.onChainDealId = onChainResult.dealIdBytes32;
      (activatedDeal as any).onChainTx = onChainResult.txHash;

      // Re-save deal with on-chain info
      try {
        const seaKey = (relayUser as any)?._?.sea;
        if (seaKey) {
          await StorageDeals.saveDeal(gun, activatedDeal, seaKey);
          loggers.server.info({ dealId }, `✅ Deal updated with on-chain info`);
        }
      } catch (updateError: unknown) {
        const updateErrorMessage =
          updateError instanceof Error ? updateError.message : String(updateError);
        console.warn(`⚠️ Failed to update deal with on-chain info: ${updateErrorMessage}`);
      }
    } catch (onChainError: unknown) {
      const onChainErrorMessage =
        onChainError instanceof Error ? onChainError.message : String(onChainError);
      console.error(`❌ Failed to register deal on-chain: ${onChainErrorMessage}`);
      // If on-chain registration fails, we can't activate the deal
      return res.status(500).json({
        success: false,
        error: "Failed to register deal on-chain",
        details: onChainErrorMessage,
      });
    }

    // At this point, on-chain registration succeeded and activatedDeal is defined
    if (!activatedDeal) {
      return res.status(500).json({
        success: false,
        error: "Deal activation failed - activatedDeal not created",
      });
    }

    // Save updated deal to GunDB (if not already saved with on-chain info)
    let saveWarning = null;
    if (!onChainRegistered) {
      try {
        const seaKey = (relayUser as any)?._?.sea;
        if (seaKey) {
          await StorageDeals.saveDeal(gun, activatedDeal, seaKey);
          loggers.server.info({ dealId }, `✅ Deal saved to GunDB successfully`);
        }
      } catch (saveError: unknown) {
        const errorMessage = saveError instanceof Error ? saveError.message : String(saveError);
        loggers.server.error({ err: saveError, dealId }, `⚠️ Error saving activated deal to GunDB`);
        saveWarning =
          "Payment processed successfully, but there was a temporary issue saving the deal. It will be retried automatically.";
        // Still continue - payment was successful
      }
    }

    // Pin the CID to IPFS to ensure it's stored on this relay
    // Note: This is done asynchronously and doesn't block activation
    // The pin might take time if the CID needs to be fetched from the network
    (async () => {
      try {
        loggers.server.info(
          { dealId, cid: deal.cid },
          `📌 Pinning CID ${deal.cid} for deal ${dealId}...`
        );
        const IPFS_API_URL = ipfsConfig.apiUrl || "http://127.0.0.1:5001";
        const url = new URL(IPFS_API_URL);
        const isHttps = url.protocol === "https:";
        const protocolModule = isHttps ? https : http;
        const pinOptions = {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 5001),
          path: `/api/v0/pin/add?arg=${encodeURIComponent(deal.cid)}`,
          method: "POST",
          headers: { "Content-Length": "0" } as Record<string, string>,
        };

        if (ipfsConfig.apiToken) {
          pinOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
        }

        await new Promise((resolve, reject) => {
          const req = protocolModule.request(pinOptions, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
              if (res.statusCode === 200) {
                try {
                  const result = JSON.parse(data);
                  loggers.server.info(
                    { dealId, cid: deal.cid, result },
                    `✅ CID ${deal.cid} pinned successfully`
                  );
                  // Note: Pin might still be processing in background
                  // IPFS will fetch the content from network if not available locally
                  resolve(result);
                } catch (e) {
                  loggers.server.info({ dealId, cid: deal.cid, data }, `✅ CID ${deal.cid} pinned`);
                  resolve(data);
                }
              } else {
                // Check if error is "already pinned"
                if (data.includes("already pinned") || data.includes("is already pinned")) {
                  loggers.server.info(
                    { dealId, cid: deal.cid },
                    `ℹ️ CID ${deal.cid} was already pinned`
                  );
                  resolve(null);
                } else {
                  loggers.server.warn(
                    { dealId, cid: deal.cid, statusCode: res.statusCode, data },
                    `⚠️ Failed to pin CID ${deal.cid}`
                  );
                  resolve(null); // Don't reject - pin might already exist
                }
              }
            });
          });
          req.on("error", (err) => {
            loggers.server.warn(
              { dealId, cid: deal.cid, err: err.message },
              `⚠️ Error pinning CID ${deal.cid}`
            );
            resolve(null); // Don't fail activation if pin fails
          });
          req.setTimeout(60000, () => {
            req.destroy();
            loggers.server.warn(
              { dealId, cid: deal.cid },
              `⚠️ Pin timeout for CID ${deal.cid} (this is normal if CID needs to be fetched from network)`
            );
            resolve(null);
          });
          req.end();
        });
      } catch (pinError: unknown) {
        const pinErrorMessage = pinError instanceof Error ? pinError.message : String(pinError);
        loggers.server.warn(
          { dealId, cid: deal.cid, err: pinErrorMessage },
          `⚠️ Error pinning CID ${deal.cid}`
        );
        // Don't fail the activation if pin fails - CID might already be pinned or IPFS might be slow
      }
    })(); // Execute asynchronously without blocking

    // Remove from pending cache since it's now activated
    removeCachedDeal(dealId);

    // Update cache with activated deal for immediate access
    cacheDeal(activatedDeal);

    loggers.server.info(
      {
        dealId,
        cid: deal.cid,
        txHash: onChainTxHash || (activatedDeal as any).onChainTx || "N/A",
      },
      `✅ Deal ${dealId} activated. CID: ${deal.cid}, On-chain TX: ${onChainTxHash || (activatedDeal as any).onChainTx || "N/A"}`
    );

    // Collect warnings
    const warnings = [];
    if (saveWarning) warnings.push(saveWarning);
    if (onChainWarning) warnings.push(onChainWarning);

    res.json({
      success: true,
      deal: {
        id: activatedDeal.id,
        status: activatedDeal.status,
        cid: activatedDeal.cid,
        activatedAt: activatedDeal.activatedAt,
        expiresAt: activatedDeal.expiresAt,
        paymentTx: activatedDeal.paymentTx,
        onChainRegistered: onChainRegistered,
      },
      message: warnings.length > 0 ? warnings.join(" ") : "Deal activated successfully",
      warning: warnings.length > 0 ? warnings.join(" ") : undefined,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Deal activation error:", error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/v1/deals/by-cid/:cid
 *
 * Get all deals for a CID.
 * NOTE: Must be defined before /:dealId to avoid route conflict
 */
router.get("/by-cid/:cid", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({ success: false, error: "Gun not available" });
    }

    const { cid } = req.params;
    const deals = await StorageDeals.getDealsByCid(gun, cid);

    res.json({
      success: true,
      cid,
      count: deals.length,
      deals,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/v1/deals/by-client/:address
 *
 * Get all deals for a client address.
 * Uses on-chain registry as source of truth, enriches with GunDB details.
 * NOTE: Must be defined before /:dealId to avoid route conflict
 */
router.get("/by-client/:address", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({ success: false, error: "Gun not available" });
    }

    const { address } = req.params;
    const normalizedAddress = address.toLowerCase();
    const chainIdRaw = req.query.chainId;
    const chainIdStr = Array.isArray(chainIdRaw) ? chainIdRaw[0] : chainIdRaw;
    const chainId = chainIdStr
      ? parseInt(String(chainIdStr), 10)
      : parseInt(String(registryConfig.chainId), 10);

    const dealMap = new Map(); // Use map to deduplicate by deal ID

    // Import ethers for deal ID matching (needed for hashing)
    const { ethers } = await import("ethers");

    // STEP 1: Fetch from on-chain StorageDealRegistry (source of truth)
    let onChainDeals = [];
    try {
      const storageDealRegistryClient = createStorageDealRegistryClient(chainId);
      // Normalize address to checksum format for consistency with on-chain storage
      const normalizedAddressForQuery = ethers.getAddress(address);
      onChainDeals = await storageDealRegistryClient.getClientDeals(normalizedAddressForQuery);

      loggers.server.info(
        {
          clientAddress: normalizedAddressForQuery,
          count: onChainDeals.length,
        },
        `📋 Found ${onChainDeals.length} deals on-chain for client ${normalizedAddressForQuery}`
      );
    } catch (onChainError: unknown) {
      const onChainErrorMessage =
        onChainError instanceof Error ? onChainError.message : String(onChainError);
      console.warn(`⚠️ Failed to fetch on-chain deals: ${onChainErrorMessage}`);
      // Continue with GunDB fallback
    }

    // STEP 2: For each on-chain deal, get full details from GunDB

    for (const onChainDeal of onChainDeals) {
      // Try multiple strategies to find the deal in GunDB:
      // 1. Match by on-chain deal ID (if saved in GunDB)
      // 2. Match by CID + client address
      // 3. Try to match by hashing known deal IDs

      let gunDeal = null;

      // Strategy 1: Search all GunDB deals for this client and match by onChainDealId
      const gunDealsByClient = await StorageDeals.getDealsByClient(gun, address);
      gunDeal = gunDealsByClient.find((d) => d.onChainDealId === onChainDeal.dealId);

      // Strategy 2: If not found, try matching by CID + client address
      if (!gunDeal) {
        gunDeal = gunDealsByClient.find(
          (d) => d.clientAddress?.toLowerCase() === normalizedAddress && d.cid === onChainDeal.cid
        );
      }

      // Strategy 3: Try matching by hashing deal ID (on-chain stores hash of original ID)
      if (!gunDeal) {
        for (const deal of gunDealsByClient) {
          const dealIdHash = ethers.id(deal.id); // keccak256 hash
          // Normalize both to lowercase for comparison (bytes32 hex strings)
          const normalizedOnChainId = onChainDeal.dealId?.toLowerCase();
          const normalizedHash = dealIdHash?.toLowerCase();
          if (normalizedHash === normalizedOnChainId) {
            loggers.server.info(
              { dealId: deal.id, onChainDealId: onChainDeal.dealId },
              `✅ Matched deal ${deal.id} to on-chain deal ${onChainDeal.dealId.substring(0, 16)}... via hash`
            );
            gunDeal = deal;
            break;
          }
        }
      }

      // Strategy 4: Check cache
      if (!gunDeal) {
        for (const [dealId, entry] of pendingDealsCache) {
          const cachedDeal = entry.deal;

          // Match by onChainDealId
          if (cachedDeal.onChainDealId === onChainDeal.dealId) {
            gunDeal = cachedDeal;
            break;
          }

          // Match by hash
          const dealIdHash = ethers.id(dealId);
          const normalizedOnChainId = onChainDeal.dealId?.toLowerCase();
          const normalizedHash = dealIdHash?.toLowerCase();
          if (normalizedHash === normalizedOnChainId) {
            loggers.server.info(
              { dealId, onChainDealId: onChainDeal.dealId },
              `✅ Matched cached deal ${dealId} to on-chain deal ${onChainDeal.dealId.substring(0, 16)}... via hash`
            );
            gunDeal = cachedDeal;
            break;
          }

          // Match by CID + client
          if (
            cachedDeal.cid === onChainDeal.cid &&
            cachedDeal.clientAddress?.toLowerCase() === normalizedAddress
          ) {
            gunDeal = cachedDeal;
            break;
          }
        }
      }

      // If found in GunDB, use it (has full details)
      if (gunDeal) {
        // Enrich with on-chain data
        gunDeal.onChainRegistered = true;
        gunDeal.onChainDealId = onChainDeal.dealId;
        gunDeal.onChainRelay = onChainDeal.relay;
        dealMap.set(gunDeal.id, gunDeal);
      } else {
        // Create stub from on-chain data (deal exists on-chain but not in GunDB yet)
        // This can happen if GunDB sync is slow or if deal was created elsewhere
        const stubDeal = {
          id: `onchain_${onChainDeal.dealId.substring(0, 16)}`, // Use partial hash as ID
          cid: onChainDeal.cid,
          clientAddress: onChainDeal.client,
          providerPub: null, // Not available from on-chain
          sizeMB: onChainDeal.sizeMB,
          durationDays: Math.ceil(
            (Number(onChainDeal.expiresAt) - Number(onChainDeal.createdAt)) / (1000 * 60 * 60 * 24)
          ),
          tier: "unknown", // Not stored on-chain
          pricing: {
            tier: "unknown",
            sizeMB: onChainDeal.sizeMB,
            durationDays: Math.ceil(
              (Number(onChainDeal.expiresAt) - Number(onChainDeal.createdAt)) /
                (1000 * 60 * 60 * 24)
            ),
            totalPriceUSDC: parseFloat(String(onChainDeal.priceUSDC)),
            features: { erasureCoding: false },
            replicationFactor: 1,
          },
          status: (onChainDeal as any).active
            ? StorageDeals.DEAL_STATUS.ACTIVE
            : StorageDeals.DEAL_STATUS.TERMINATED,
          createdAt: new Date(onChainDeal.createdAt).getTime(),
          expiresAt: new Date(onChainDeal.expiresAt).getTime(),
          activatedAt: new Date(onChainDeal.createdAt).getTime(),
          onChainRegistered: true,
          onChainDealId: onChainDeal.dealId,
          onChainRelay: onChainDeal.relay,
          fromOnChainOnly: true, // Flag to indicate this is a stub
        };
        dealMap.set(stubDeal.id, stubDeal);

        loggers.server.warn(
          { onChainDealId: onChainDeal.dealId },
          `⚠️ Deal ${onChainDeal.dealId.substring(0, 16)}... found on-chain but not in GunDB - using stub`
        );
      }
    }

    // STEP 3: Also check GunDB and cache for deals not yet on-chain
    const gunDeals = await StorageDeals.getDealsByClient(gun, address);
    const cachedDeals = [];
    for (const [dealId, entry] of pendingDealsCache) {
      const deal = entry.deal;
      if (deal.clientAddress && deal.clientAddress.toLowerCase() === normalizedAddress) {
        cachedDeals.push(deal);
      }
    }

    // Add GunDB deals (may include deals not yet registered on-chain)
    for (const deal of gunDeals) {
      if (!dealMap.has(deal.id)) {
        (deal as any).onChainRegistered = false;
        dealMap.set(deal.id, deal);
      }
    }

    // Add cached deals (override if exists, they're more recent)
    for (const deal of cachedDeals) {
      deal.onChainRegistered = deal.onChainRegistered || false;
      dealMap.set(deal.id, deal);
    }

    const deals = Array.from(dealMap.values());
    const stats = StorageDeals.getDealStats(deals);

    loggers.server.info(
      {
        clientAddress: address,
        total: deals.length,
        onChain: onChainDeals.length,
        gunDB: gunDeals.length,
        cached: cachedDeals.length,
      },
      `✅ Found ${deals.length} total deals for client ${address} (${onChainDeals.length} on-chain, ${gunDeals.length} from GunDB, ${cachedDeals.length} from cache)`
    );

    res.json({
      success: true,
      clientAddress: address,
      stats,
      deals,
      sources: {
        onChain: onChainDeals.length,
        gunDB: gunDeals.length,
        cache: cachedDeals.length,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "Error fetching deals by client");
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/v1/deals/relay/active
 *
 * Get active deals for this relay.
 * Admin only.
 * NOTE: Must be defined before /:dealId to avoid route conflict
 */
router.get("/relay/active", async (req, res) => {
  try {
    // Check admin auth
    const authHeader = req.headers["authorization"];
    const token = authHeader?.split(" ")[1] || req.headers["token"];
    if (token !== authConfig.adminPassword) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const gun = req.app.get("gunInstance");
    const relayPub = getRelayPub();

    if (!gun || !relayPub) {
      return res.status(503).json({ success: false, error: "Relay not initialized" });
    }

    const deals = await StorageDeals.getActiveDealsForRelay(gun, relayPub);
    const stats = StorageDeals.getDealStats(deals);

    res.json({
      success: true,
      relayPub,
      stats,
      activeDeals: deals,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/v1/deals/stats
 *
 * Get aggregate statistics for all deals (network-wide).
 * Aggregates stats from all relays in the network.
 */
router.get("/stats", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({ success: false, error: "Gun not available" });
    }

    // Get all deals from GunDB (across all relays)
    const allDeals: any[] = [];
    const timeoutRaw = req.query.timeout;
    const timeout = timeoutRaw
      ? parseInt(String(Array.isArray(timeoutRaw) ? timeoutRaw[0] : timeoutRaw), 10)
      : 5000;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeout);

      // Get deals from frozen space (deals are saved via FrozenData.createFrozenEntry)
      // Note: deals are stored in 'frozen-storage-deals' node by createFrozenEntry()
      gun
        .get("frozen-storage-deals")
        .map()
        .once((entry: any, hash: string) => {
          if (entry && entry.data && typeof entry.data === "object" && entry.data.cid) {
            // Extract deal data from frozen entry
            const deal = entry.data;
            allDeals.push({ id: deal.id || hash, ...deal });
          }
        });

      // Also check legacy 'shogun-deals' node for backwards compatibility
      gun
        .get("shogun-deals")
        .map()
        .once((deal: any, dealId: string) => {
          if (deal && typeof deal === "object" && deal.cid) {
            // Avoid duplicates by checking if already added
            if (!allDeals.find((d: any) => d.id === dealId)) {
              allDeals.push({ id: dealId, ...deal });
            }
          }
        });

      setTimeout(
        () => {
          clearTimeout(timer);
          resolve(undefined);
        },
        Math.min(timeout, 3000)
      );
    });

    // Calculate aggregate stats
    const stats = StorageDeals.getDealStats(allDeals);

    res.json({
      success: true,
      stats: {
        ...stats,
        totalDeals: stats.total,
        activeDeals: stats.active,
        expiredDeals: stats.expired,
        pendingDeals: stats.pending,
        totalSizeMB: stats.totalSizeMB,
        totalRevenueUSDC: stats.totalRevenue,
        byTier: stats.byTier,
      },
      timestamp: Date.now(),
      note: "Statistics aggregated from all relays in the network",
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error fetching deal stats:", error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/v1/deals/leaderboard
 *
 * Get leaderboard of relays sorted by deal statistics.
 * Shows which relays have the most active deals, storage, revenue, etc.
 */
router.get("/leaderboard", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({ success: false, error: "Gun not available" });
    }

    const limitRaw = req.query.limit;
    const timeoutRaw = req.query.timeout;
    const limitStr = Array.isArray(limitRaw)
      ? limitRaw[0]
      : typeof limitRaw === "string"
        ? limitRaw
        : "50";
    const timeoutStr = Array.isArray(timeoutRaw)
      ? timeoutRaw[0]
      : typeof timeoutRaw === "string"
        ? timeoutRaw
        : "5000";
    const limit = parseInt(String(limitStr)) || 50;
    const timeout = parseInt(String(timeoutStr)) || 5000;

    // Get all relays and their deal stats
    const relayStats = new Map<string, { relayPub: string; host: string; deals: any[] }>(); // host -> { deals, stats }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(undefined), timeout);

      // Get deals grouped by relay
      gun
        .get("shogun-deals")
        .map()
        .once((deal: any, dealId: string) => {
          if (deal && typeof deal === "object" && deal.relayPub) {
            // Try to get relay host from reputation or pulse data
            gun
              .get("relays")
              .map()
              .once((relayData: any, host: string) => {
                if (relayData && relayData.pulse) {
                  // Check if this relay matches the deal's relayPub
                  // For now, we'll aggregate by relayPub directly
                  if (!relayStats.has(deal.relayPub)) {
                    relayStats.set(deal.relayPub, {
                      relayPub: deal.relayPub,
                      host: host || "unknown",
                      deals: [],
                    });
                  }
                  const entry = relayStats.get(deal.relayPub);
                  if (entry) {
                    entry.deals.push({ id: dealId, ...deal });
                  }
                }
              });
          }
        });

      setTimeout(
        () => {
          clearTimeout(timer);
          resolve(undefined);
        },
        Math.min(timeout, 3000)
      );
    });

    // Calculate stats for each relay
    const leaderboard = Array.from(relayStats.values()).map((entry) => {
      const stats = StorageDeals.getDealStats(entry.deals);
      return {
        relayPub: entry.relayPub,
        host: entry.host,
        ...stats,
        dealCount: stats.total,
        activeDealCount: stats.active,
      };
    });

    // Sort by active deals, then by total storage
    leaderboard.sort((a, b) => {
      if (b.activeDealCount !== a.activeDealCount) {
        return b.activeDealCount - a.activeDealCount;
      }
      return b.totalSizeMB - a.totalSizeMB;
    });

    res.json({
      success: true,
      count: leaderboard.length,
      leaderboard: leaderboard.slice(0, limit),
      timestamp: Date.now(),
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "Error fetching deal leaderboard");
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/v1/deals/:dealId
 *
 * Get deal information.
 * NOTE: This must be AFTER all specific routes to avoid conflicts
 */
router.get("/:dealId", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({ success: false, error: "Gun not available" });
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
        error: "Deal not found",
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
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * POST /api/v1/deals/:dealId/renew
 *
 * Renew an existing deal.
 */
router.post("/:dealId/renew", express.json(), async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    const relayUser = getRelayUser();

    if (!gun || !relayUser) {
      return res.status(503).json({ success: false, error: "Relay not initialized" });
    }

    const { dealId } = req.params;
    const { additionalDays, payment } = req.body;

    if (!additionalDays) {
      return res.status(400).json({
        success: false,
        error: "additionalDays required",
      });
    }

    const deal = await StorageDeals.getDeal(gun, dealId);

    if (!deal) {
      return res.status(404).json({ success: false, error: "Deal not found" });
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
          scheme: "exact",
          network: x402Config.network || "base-sepolia",
          maxAmountRequired: Math.ceil((renewalPricing as any).totalPriceUSDC * 1000000).toString(),
          resource: `deal-renewal-${dealId}`,
          description: `Renewal: ${additionalDays} additional days`,
          payTo: x402Config.payToAddress,
        },
      });
    }

    // Verify and settle payment (similar to activate)
    const payToAddress = x402Config.payToAddress;
    if (!payToAddress) {
      return res.status(500).json({ success: false, error: "X402_PAY_TO_ADDRESS not configured" });
    }
    const merchant = new X402Merchant({
      payToAddress,
      network: x402Config.network as any,
      settlementMode: x402Config.settlementMode as "facilitator" | "direct",
      facilitatorUrl: x402Config.facilitatorUrl as string,
      privateKey: x402Config.privateKey,
      facilitatorApiKey: x402Config.facilitatorApiKey,
    });

    const settlement = await merchant.settlePayment(payment);

    if (!settlement.success) {
      return res.status(402).json({
        success: false,
        error: `Payment failed: ${settlement.errorReason}`,
      });
    }

    // Renew deal
    const renewedDeal = StorageDeals.renewDeal(
      deal,
      parseInt(additionalDays),
      settlement.transaction
    );
    const seaKey = (relayUser as any)?._?.sea;
    if (seaKey) {
      await StorageDeals.saveDeal(gun, renewedDeal, seaKey);
    }

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
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/v1/deals/:dealId/verify
 *
 * Verify that a deal's file is actually stored on the relay.
 * Checks storage proof for the CID.
 */
router.get("/:dealId/verify", async (req, res) => {
  try {
    let { dealId } = req.params;
    const gun = req.app.get("gunInstance");
    const IPFS_API_URL =
      req.app.get("IPFS_API_URL") || ipfsConfig.apiUrl || "http://127.0.0.1:5001";
    const IPFS_API_TOKEN = req.app.get("IPFS_API_TOKEN") || ipfsConfig.apiToken;

    // Handle on-chain deal IDs (remove "onchain_" prefix if present)
    const originalDealId = dealId;
    if (dealId.startsWith("onchain_")) {
      dealId = dealId.replace(/^onchain_/, "");
    }

    // Get deal from cache or GunDB
    let deal = getCachedDeal(dealId);
    if (!deal) {
      deal = await StorageDeals.getDeal(gun, dealId);
    }

    // If still not found, try to get from StorageDealRegistry (for any dealId, not just onchain_ prefixed)
    if (!deal) {
      try {
        const REGISTRY_CHAIN_ID = registryConfig.chainId;
        if (REGISTRY_CHAIN_ID) {
          const { createStorageDealRegistryClient } = await import("../utils/registry-client.js");
          const { ethers } = await import("ethers");
          const storageDealRegistryClient = createStorageDealRegistryClient(
            parseInt(String(REGISTRY_CHAIN_ID))
          );

          loggers.server.info({ dealId }, `🔍 Searching for on-chain deal with ID: ${dealId}`);

          // Try multiple strategies to find the deal
          let onChainDeal = null;

          // Strategy 1: Try with dealId as-is (if it's already a bytes32)
          try {
            onChainDeal = await storageDealRegistryClient.getDeal(dealId);
            loggers.server.info(
              { dealId, onChainDeal },
              `🔍 getDeal returned: ${!!onChainDeal}, createdAt: ${onChainDeal?.createdAt}, type: ${typeof onChainDeal?.createdAt}`
            );
            if (onChainDeal && onChainDeal.createdAt) {
              loggers.server.info(
                { dealId, onChainDeal },
                `✅ Found deal using direct dealId, createdAt: ${onChainDeal.createdAt}`
              );
            } else {
              loggers.server.warn(
                { dealId, onChainDeal },
                `⚠️ Deal found but createdAt invalid or missing: ${onChainDeal?.createdAt}`
              );
              onChainDeal = null; // Reset if invalid
            }
          } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            loggers.server.debug(
              { err: e, dealId },
              `⚠️ Direct dealId lookup failed: ${errorMessage.substring(0, 100)}`
            );
            onChainDeal = null;
          }

          // Strategy 2: If not found and dealId looks incomplete, try hashing it
          if (!onChainDeal && dealId.startsWith("0x") && dealId.length < 66) {
            try {
              // Try padding to bytes32
              const paddedId = dealId.padEnd(66, "0");
              onChainDeal = await storageDealRegistryClient.getDeal(paddedId);
              if (onChainDeal && onChainDeal.createdAt) {
                loggers.server.info({ dealId, paddedId }, `✅ Found deal using padded dealId`);
                dealId = paddedId; // Update dealId for consistency
              }
            } catch (e: unknown) {
              const errorMessage = e instanceof Error ? e.message : String(e);
              loggers.server.debug(
                { err: e, dealId },
                `⚠️ Padded dealId lookup failed: ${errorMessage.substring(0, 100)}`
              );
            }
          }

          // Strategy 3: If still not found, try hashing the dealId string
          if (!onChainDeal) {
            try {
              const hashedId = ethers.id(dealId);
              onChainDeal = await storageDealRegistryClient.getDeal(hashedId);
              if (onChainDeal && onChainDeal.createdAt) {
                loggers.server.info({ dealId, hashedId }, `✅ Found deal using hashed dealId`);
                dealId = hashedId; // Update dealId for consistency
              }
            } catch (e: unknown) {
              const errorMessage = e instanceof Error ? e.message : String(e);
              loggers.server.debug(
                { err: e, dealId },
                `⚠️ Hashed dealId lookup failed: ${errorMessage.substring(0, 100)}`
              );
            }
          }

          // Strategy 4: If we have a client address from query, try searching all their deals
          if (!onChainDeal && req.query.clientAddress) {
            try {
              const clientAddressRaw = req.query.clientAddress;
              const clientAddress = Array.isArray(clientAddressRaw)
                ? String(clientAddressRaw[0])
                : typeof clientAddressRaw === "string"
                  ? clientAddressRaw
                  : "";
              if (clientAddress) {
                const clientDeals = await storageDealRegistryClient.getClientDeals(clientAddress);
                loggers.server.debug(
                  { dealId, clientAddress, count: clientDeals.length },
                  `🔍 Found ${clientDeals.length} deals for client, searching for match...`
                );
                for (const clientDeal of clientDeals) {
                  // Try to match by partial dealId or other criteria
                  const clientDealIdStr = clientDeal.dealId || "";
                  if (
                    clientDealIdStr.includes(dealId.replace("0x", "")) ||
                    dealId.includes(clientDealIdStr.replace("0x", ""))
                  ) {
                    onChainDeal = clientDeal;
                    dealId = clientDeal.dealId;
                    loggers.server.info(
                      { dealId, clientAddress },
                      `✅ Found deal by searching client deals`
                    );
                    break;
                  }
                }
              }
            } catch (e: unknown) {
              const errorMessage = e instanceof Error ? e.message : String(e);
              loggers.server.debug(
                { err: e, dealId },
                `⚠️ Client deals search failed: ${errorMessage.substring(0, 100)}`
              );
            }
          }

          // Check if deal exists (createdAt should be a valid date string or number)
          const createdAtValue = onChainDeal?.createdAt;
          const hasCreatedAt =
            createdAtValue &&
            ((typeof createdAtValue === "bigint" && createdAtValue > 0n) ||
              (typeof createdAtValue === "number" && createdAtValue > 0) ||
              (typeof createdAtValue === "string" &&
                createdAtValue !== "1970-01-01T00:00:00.000Z" &&
                createdAtValue.length > 0));

          if (onChainDeal && hasCreatedAt) {
            // Convert on-chain deal to format expected by verification
            // expiresAt might be ISO string or timestamp
            let expiresAtDate;
            if (typeof onChainDeal.expiresAt === "string") {
              expiresAtDate = new Date(onChainDeal.expiresAt);
            } else if (
              typeof onChainDeal.expiresAt === "number" ||
              typeof onChainDeal.expiresAt === "bigint"
            ) {
              // If it's a timestamp, convert to Date
              const timestamp = Number(onChainDeal.expiresAt);
              expiresAtDate = new Date(timestamp * 1000); // Assuming seconds, convert to milliseconds
            } else {
              expiresAtDate = new Date(onChainDeal.expiresAt);
            }

            const isActive =
              (onChainDeal as any).active &&
              !isNaN(expiresAtDate.getTime()) &&
              expiresAtDate > new Date();

            deal = {
              id: originalDealId,
              cid: onChainDeal.cid,
              status: isActive ? StorageDeals.DEAL_STATUS.ACTIVE : StorageDeals.DEAL_STATUS.EXPIRED,
              onChainDealId: dealId,
            } as any;
            (deal as any).active = isActive;
            if (deal) {
              loggers.server.info(
                { dealId, deal },
                `✅ Successfully loaded on-chain deal: ${deal.cid}, active: ${(deal as any).active}, expiresAt: ${onChainDeal.expiresAt}, expiresAtDate: ${expiresAtDate.toISOString()}`
              );
            }
          } else {
            loggers.server.warn(
              {
                dealId,
                createdAt: createdAtValue,
                hasCreatedAt,
                onChainDeal: !!onChainDeal,
              },
              `⚠️ On-chain deal ${dealId} not found after all strategies. createdAt: ${createdAtValue}, hasCreatedAt: ${hasCreatedAt}, onChainDeal: ${!!onChainDeal}`
            );
          }
        }
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        const errorStack = e instanceof Error ? e.stack : undefined;
        loggers.server.error(
          { dealId, err: errorMessage, stack: errorStack },
          `❌ Error fetching on-chain deal ${dealId}`
        );
        if (errorStack) {
          loggers.server.error({ dealId, stack: errorStack }, errorStack);
        }
      }
    }

    // If still not found, try searching by CID if provided as query parameter
    if (!deal && req.query.cid) {
      try {
        const cidQuery = Array.isArray(req.query.cid) ? req.query.cid[0] : req.query.cid;
        if (!cidQuery || typeof cidQuery !== "string") {
          throw new Error("Invalid CID query parameter");
        }
        const dealsByCid = await StorageDeals.getDealsByCid(gun, cidQuery);
        if (dealsByCid && dealsByCid.length > 0) {
          // Use the first matching deal
          deal = dealsByCid[0];
          loggers.server.info(
            { dealId, cid: req.query.cid },
            `✅ Found deal by CID: ${req.query.cid}`
          );
        }
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        loggers.server.warn(
          { dealId, err: errorMessage },
          `Could not search deals by CID: ${errorMessage}`
        );
      }
    }

    if (!deal) {
      loggers.server.error(
        { dealId, originalDealId },
        `❌ Deal not found: ${dealId} (original: ${originalDealId})`
      );
      return res.status(404).json({ success: false, error: "Deal not found" });
    }

    // Only verify active deals (check both status field and active flag for on-chain deals)
    const isActive =
      deal.status === StorageDeals.DEAL_STATUS.ACTIVE ||
      (deal.onChainDealId && (deal as any).active !== false);
    if (!isActive) {
      return res.status(400).json({
        success: false,
        error: `Deal is ${deal.status || "inactive"}, cannot verify`,
      });
    }

    const cid = deal.cid;

    // Helper function to make IPFS API HTTP requests
    const makeIpfsRequest = (path: string, method: string = "POST") => {
      return new Promise((resolve, reject) => {
        const url = new URL(IPFS_API_URL);
        const isHttps = url.protocol === "https:";
        const protocolModule = isHttps ? https : http;
        const options = {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 5001),
          path: `/api/v0${path}`,
          method,
          headers: { "Content-Length": "0" } as Record<string, string>,
        };

        if (IPFS_API_TOKEN) {
          options.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
        }

        const req = protocolModule.request(options, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode === 200) {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                resolve({ raw: data });
              }
            } else {
              reject(new Error(`IPFS API returned ${res.statusCode}: ${data.substring(0, 200)}`));
            }
          });
        });

        req.on("error", reject);
        req.setTimeout(15000, () => {
          req.destroy();
          reject(new Error("IPFS request timeout"));
        });
        req.end();
      });
    };

    // 1. Verify CID exists in IPFS (try block/stat first)
    let ipfsStat = null;
    let ipfsExists = false;
    let blockSize = null;

    try {
      const blockStat = (await makeIpfsRequest(
        `/block/stat?arg=${encodeURIComponent(cid)}`
      )) as any;
      ipfsStat = blockStat;
      blockSize = blockStat?.Size || blockStat?.size;
      ipfsExists = true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggers.server.debug(
        { err: error, cid },
        `⚠️ CID ${cid} block.stat failed: ${errorMessage}, trying dag.stat`
      );

      // Try dag/stat as fallback (object.stat is deprecated)
      try {
        const dagStat = (await makeIpfsRequest(`/dag/stat?arg=${encodeURIComponent(cid)}`)) as any;
        ipfsStat = dagStat;
        blockSize = dagStat?.Size || dagStat?.size;
        ipfsExists = true;
      } catch (dagError: unknown) {
        const dagErrorMessage = dagError instanceof Error ? dagError.message : String(dagError);
        loggers.server.warn(
          { err: dagError, cid },
          `❌ CID ${cid} not found in IPFS: ${dagErrorMessage}`
        );
        ipfsExists = false;
      }
    }

    // 2. Check if pinned
    // Note: Pin check might fail if IPFS is still processing the pin (e.g., downloading from network)
    let isPinned = false;
    let pinCheckError = null;
    try {
      // Try to get pin info for specific CID
      const pinResult = await makeIpfsRequest(`/pin/ls?arg=${encodeURIComponent(cid)}&type=all`);
      // If pin/ls returns successfully with Keys, the CID is pinned
      const pinResultObj = pinResult as any;
      if (pinResultObj && pinResultObj.Keys && Object.keys(pinResultObj.Keys).length > 0) {
        isPinned = true;
      } else if (
        pinResultObj &&
        (pinResultObj.Type === "recursive" || pinResultObj.Type === "direct")
      ) {
        isPinned = true;
      }
    } catch (error: unknown) {
      pinCheckError = error;
      // If pin/ls with arg fails, try listing all pins and check if CID is in the list
      try {
        const allPins = (await makeIpfsRequest(`/pin/ls?type=all`)) as any;
        if (allPins && allPins.Keys) {
          isPinned = cid in allPins.Keys;
        }
        if (!isPinned) {
          // Don't log as error - pin might still be processing
          const errorMessage = error instanceof Error ? error.message : String(error);
          loggers.server.debug(
            { err: error, cid },
            `ℹ️ CID ${cid} pin status unclear (may still be processing)`
          );
        }
      } catch (listError: unknown) {
        // If both fail, assume not pinned (but don't treat as error - pin might be processing)
        isPinned = false;
        const errorMessage = error instanceof Error ? error.message : String(error);
        loggers.server.debug(
          { err: error, cid },
          `ℹ️ CID ${cid} pin check failed (may still be processing)`
        );
      }
    }

    // 3. Try to fetch a small sample of data (first 256 bytes)
    let canRead = false;
    let readError = null;
    let contentSample = null;

    try {
      const url = new URL(IPFS_API_URL);
      const isHttps = url.protocol === "https:";
      const protocolModule = isHttps ? https : http;
      const catOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 5001),
        path: `/api/v0/cat?arg=${encodeURIComponent(cid)}&length=256`,
        method: "POST",
        headers: { "Content-Length": "0" } as Record<string, string>,
      };

      if (IPFS_API_TOKEN) {
        catOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const catData = await new Promise<Buffer>((resolve, reject) => {
        const req = protocolModule.request(catOptions, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            if (res.statusCode === 200) {
              resolve(Buffer.concat(chunks));
            } else {
              reject(new Error(`cat returned ${res.statusCode || "unknown"}`));
            }
          });
        });
        req.on("error", reject);
        req.setTimeout(10000, () => {
          req.destroy();
          reject(new Error("cat timeout"));
        });
        req.end();
      });

      if (catData && Buffer.isBuffer(catData) && catData.length > 0) {
        canRead = true;
        contentSample = catData.toString("base64").substring(0, 100); // First 100 chars as base64
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      readError = errorMessage;
      canRead = false;
      loggers.server.warn({ err: error, cid }, `⚠️ Could not read content sample for CID ${cid}`);
    }

    const isVerified = ipfsExists && isPinned && canRead;
    const verification = {
      dealId,
      cid,
      verified: isVerified,
      timestamp: Date.now(),
      checks: {
        existsInIPFS: ipfsExists,
        isPinned: isPinned,
        canRead: canRead,
        blockSize: blockSize,
      },
      issues: [],
    };

    if (!ipfsExists) {
      (verification.issues as string[]).push("CID not found in IPFS");
    }
    if (!isPinned) {
      (verification.issues as string[]).push("CID is not pinned");
    }
    if (!canRead) {
      (verification.issues as string[]).push(
        `Cannot read content: ${readError || "unknown error"}`
      );
    }

    // Record proof success/failure for reputation tracking
    if (gun) {
      try {
        const host =
          (typeof relayConfig === "object" &&
          "host" in relayConfig &&
          typeof relayConfig.host === "string"
            ? relayConfig.host
            : undefined) ||
          (typeof relayConfig === "object" &&
          "endpoint" in relayConfig &&
          typeof relayConfig.endpoint === "string"
            ? relayConfig.endpoint
            : undefined) ||
          req.headers.host ||
          "localhost";
        // Normalize host - remove protocol if present
        let normalizedHost = host;
        try {
          if (host.includes("://")) {
            const url = new URL(host);
            normalizedHost = url.hostname;
          }
        } catch (e) {
          // If URL parsing fails, use as-is
        }

        if (isVerified) {
          // Calculate response time (approximate, since we don't track start time)
          const responseTime = 0; // Could be improved by tracking start time
          const relayUser = getRelayUser();
          const keyPair = (relayUser as any)?._?.sea || null;
          await Reputation.recordProofSuccess(gun, normalizedHost, responseTime, keyPair);
          loggers.server.info(
            { dealId, host: normalizedHost },
            `✅ Recorded proof success for deal ${dealId} (host: ${normalizedHost})`
          );
        } else {
          const relayUser = getRelayUser();
          const keyPair = (relayUser as any)?._?.sea || null;
          await Reputation.recordProofFailure(gun, normalizedHost, keyPair);
          loggers.server.info(
            { dealId, host: normalizedHost },
            `❌ Recorded proof failure for deal ${dealId} (host: ${normalizedHost})`
          );
        }
      } catch (e: unknown) {
        // Non-critical, don't block verification response
        const errorMessage = e instanceof Error ? e.message : String(e);
        loggers.server.warn({ err: e }, "Failed to record proof result for reputation");
      }
    }

    res.json({
      success: true,
      verification,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "Deal verification error");
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * POST /api/v1/deals/:dealId/verify-proof
 *
 * Challenge the relay to provide a storage proof for a deal.
 * Similar to network/proof but deal-specific.
 */
router.get("/:dealId/verify-proof", async (req: Request, res: Response) => {
  try {
    const { dealId } = req.params;
    const challenge = req.query.challenge || crypto.randomBytes(16).toString("hex");

    const gun = req.app.get("gunInstance");
    const IPFS_API_URL =
      req.app.get("IPFS_API_URL") || ipfsConfig.apiUrl || "http://127.0.0.1:5001";
    const IPFS_API_TOKEN = req.app.get("IPFS_API_TOKEN") || ipfsConfig.apiToken;

    if (!gun) {
      return res.status(503).json({ success: false, error: "Gun not available" });
    }

    // Get deal
    let deal = getCachedDeal(dealId);
    if (!deal) {
      deal = await StorageDeals.getDeal(gun, dealId);
    }

    if (!deal) {
      return res.status(404).json({ success: false, error: "Deal not found" });
    }

    const cid = deal.cid;

    // Helper function to make IPFS API HTTP requests
    const makeIpfsRequest = (path: string, method = "POST") => {
      return new Promise((resolve, reject) => {
        const url = new URL(IPFS_API_URL);
        const options = {
          hostname: url.hostname,
          port: url.port || 5001,
          path: `/api/v0${path}`,
          method,
          headers: { "Content-Length": "0" } as Record<string, string>,
        };

        if (IPFS_API_TOKEN) {
          options.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
        }

        const req = http.request(options, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode === 200) {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                resolve({ raw: data });
              }
            } else {
              reject(new Error(`IPFS API returned ${res.statusCode}`));
            }
          });
        });

        req.on("error", reject);
        req.setTimeout(15000, () => {
          req.destroy();
          reject(new Error("IPFS request timeout"));
        });
        req.end();
      });
    };

    // 1. Verify CID exists via IPFS block/stat
    let blockStat: any;
    try {
      blockStat = (await makeIpfsRequest(`/block/stat?arg=${encodeURIComponent(cid)}`)) as any;
      if (blockStat?.Message || blockStat?.Type === "error") {
        return res.status(404).json({
          success: false,
          error: "CID not found on this relay for proof generation",
          cid,
          dealId,
        });
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return res.status(404).json({
        success: false,
        error: "CID not found on this relay",
        cid,
        dealId,
        details: errorMessage,
      });
    }

    // 2. Get content sample (first 256 bytes)
    let contentSample = null;
    try {
      const url = new URL(IPFS_API_URL);
      const isHttps = url.protocol === "https:";
      const protocolModule = isHttps ? https : http;
      const catOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 5001),
        path: `/api/v0/cat?arg=${encodeURIComponent(cid)}&length=256`,
        method: "POST",
        headers: { "Content-Length": "0" } as Record<string, string>,
      };

      if (IPFS_API_TOKEN) {
        catOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const catData = await new Promise<Buffer>((resolve, reject) => {
        const req = protocolModule.request(catOptions, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            if (res.statusCode === 200) {
              resolve(Buffer.concat(chunks));
            } else {
              reject(new Error(`cat returned ${res.statusCode || "unknown"}`));
            }
          });
        });
        req.on("error", reject);
        req.setTimeout(10000, () => {
          req.destroy();
          reject(new Error("cat timeout"));
        });
        req.end();
      });

      if (catData && Buffer.isBuffer(catData) && catData.length > 0) {
        contentSample = catData.toString("base64");
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`Could not get content sample for CID ${cid}:`, errorMessage);
      contentSample = "";
    }

    // 3. Check if pinned
    let isPinned = false;
    try {
      const pinLs = (await makeIpfsRequest(
        `/pin/ls?arg=${encodeURIComponent(cid)}&type=all`
      )) as any;
      isPinned = pinLs?.Keys && Object.keys(pinLs.Keys).length > 0;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Not pinned or error
      isPinned = false;
    }

    // 4. Generate proof hash
    const timestamp = Date.now();
    const blockSize = blockStat.Size || blockStat.size;
    const proofData = `${cid}:${challenge}:${timestamp}:${blockSize}:${contentSample}`;
    const proofHash = crypto.createHash("sha256").update(proofData).digest("hex");

    const relayPub = req.app.get("relayUserPub");

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
          size: blockSize,
        },
        contentSampleBase64: contentSample,
        isPinned,
        verification: {
          method: "sha256(cid:challenge:timestamp:size:contentSampleBase64)",
          validFor: 300000, // 5 minutes
          expiresAt: timestamp + 300000,
        },
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "Deal proof verification error");
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * POST /api/v1/deals/:dealId/report
 *
 * Report an issue with a deal (missed proof or data loss) for slashing.
 * Prepares transaction data for on-chain reporting.
 * Client must sign and send the transaction (pays gas).
 */
router.post("/:dealId/report", express.json(), async (req, res) => {
  try {
    console.log(`📋 Deal report request: ${req.params.dealId}`);
    const gun = req.app.get("gunInstance");
    const { dealId } = req.params;
    const { clientAddress, reportType, reason, evidence = "" } = req.body;

    if (!gun) {
      return res.status(503).json({ success: false, error: "Gun not available" });
    }

    if (!clientAddress) {
      return res.status(400).json({ success: false, error: "clientAddress is required" });
    }

    if (!reportType || (reportType !== "missedProof" && reportType !== "dataLoss")) {
      return res.status(400).json({
        success: false,
        error: 'reportType must be "missedProof" or "dataLoss"',
      });
    }

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ success: false, error: "reason is required" });
    }

    // Get deal (check cache first, then GunDB, then on-chain)
    let deal = getCachedDeal(dealId);
    if (!deal) {
      deal = await StorageDeals.getDeal(gun, dealId);
    }

    // If not found in GunDB, try on-chain StorageDealRegistry
    if (!deal && registryConfig.chainId) {
      try {
        const chainId = parseInt(String(registryConfig.chainId));
        const storageDealRegistryClient = createStorageDealRegistryClient(chainId);

        // Try to get deal from on-chain (using hash of deal ID)
        const dealIdHash = ethers.id(dealId);
        const onChainDeal = await storageDealRegistryClient.getDeal(dealIdHash);

        if (onChainDeal) {
          deal = {
            id: dealId,
            clientAddress: onChainDeal.client,
            providerPub: onChainDeal.relay,
            cid: onChainDeal.cid,
            onChainDealId: onChainDeal.dealId,
          } as any;
          (deal as any).onChainRegistered = true;
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        loggers.server.warn(
          { err: error, dealId },
          `Failed to fetch deal from on-chain StorageDealRegistry`
        );
      }
    }

    if (!deal) {
      return res.status(404).json({ success: false, error: "Deal not found" });
    }

    // Verify ownership - client can only report their own deals
    const normalizedClient = clientAddress.toLowerCase();
    const dealClient = deal.clientAddress?.toLowerCase() || (deal as any).client?.toLowerCase();

    if (!dealClient || dealClient !== normalizedClient) {
      return res.status(403).json({
        success: false,
        error: "You can only report issues for your own deals",
      });
    }

    // Get relay address (prefer on-chain relay, fallback to providerPub)
    let relayAddress = null;
    if (deal.onChainRelay) {
      relayAddress = deal.onChainRelay;
    } else if (deal.providerPub && deal.providerPub.startsWith("0x")) {
      relayAddress = deal.providerPub;
    } else if (registryConfig.chainId && deal.onChainDealId) {
      // Try to get relay from on-chain deal
      try {
        const chainId = parseInt(String(registryConfig.chainId));
        const storageDealRegistryClient = createStorageDealRegistryClient(chainId);
        const onChainDeal = await storageDealRegistryClient.getDeal(deal.onChainDealId);
        if (onChainDeal) {
          relayAddress = onChainDeal.relay;
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to get relay address from on-chain deal: ${errorMessage}`);
      }
    }

    if (!relayAddress) {
      return res.status(400).json({
        success: false,
        error:
          "Could not determine relay address for this deal. Deal may not be registered on-chain.",
      });
    }

    // Get on-chain deal ID (use hash of deal ID if not available)
    let onChainDealId = deal.onChainDealId;
    if (!onChainDealId) {
      onChainDealId = ethers.id(dealId);
    }

    // Prepare transaction data
    const chainId =
      parseInt(String(registryConfig.chainId)) || registryConfig.chainId;
    const storageDealRegistryClient = createStorageDealRegistryClient(chainId);
    const storageDealRegistryAddress = storageDealRegistryClient.registryAddress;

    // Prepare function call data (using StorageDealRegistry.grief)
    // StorageDealRegistry.grief calculates griefing cost and delegates to RelayRegistry
    const storageDealRegistryInterface = new ethers.Interface([
      "function grief(bytes32 dealId, uint256 slashAmount, string reason)",
    ]);

    // Calculate slash amount based on report type
    const slashBps = reportType === "missedProof" ? 100 : 1000; // 1% or 10%
    if (!relayAddress) {
      return res.status(400).json({
        success: false,
        error: "Could not determine relay address for this deal",
      });
    }
    const relayInfo = await createRegistryClient(chainId).getRelayInfo(relayAddress);
    const stakedAmount = BigInt(relayInfo.stakedAmountRaw);
    const slashAmount = (stakedAmount * BigInt(slashBps)) / 10000n;

    const evidenceText = evidence || reason;

    const callData = storageDealRegistryInterface.encodeFunctionData("grief", [
      onChainDealId,
      slashAmount,
      evidenceText,
    ]);

    // Prepare transaction request
    const transaction = {
      to: storageDealRegistryAddress,
      data: callData,
      value: "0x0", // No ETH value needed (but USDC approval needed for griefing cost)
    };

    res.json({
      success: true,
      report: {
        dealId,
        onChainDealId,
        relayAddress,
        reportType,
        reason,
        evidence: evidenceText,
        transaction,
        chainId,
        storageDealRegistryAddress,
        functionName: "grief",
        griefingCost: null, // Griefing cost is calculated by the contract
        slashAmount: slashAmount
          ? {
              amount: slashAmount,
              currency: "USDC",
              note: "Amount that will be slashed from relay stake",
            }
          : null,
        message:
          "Transaction data prepared. Sign and send this transaction from your wallet to execute the griefing report.",
        warning:
          "NOTE: You must be the client of this deal to execute this transaction. You will need to approve USDC spending for the griefing cost before sending the transaction.",
        instructions: [
          "1. Approve USDC spending for the griefing cost amount",
          "2. Send this transaction from your wallet (the deal client)",
          "3. The griefing cost will be deducted from your USDC balance",
          "4. The relay stake will be slashed by the calculated amount",
        ],
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "Deal report error");
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * POST /api/v1/deals/:dealId/cancel
 *
 * Cancel/terminate your own deal.
 * Client can only cancel their own deals.
 */
router.post("/:dealId/cancel", express.json(), async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    const relayUser = getRelayUser();

    if (!gun || !relayUser) {
      return res.status(503).json({ success: false, error: "Relay not initialized" });
    }

    const { dealId } = req.params;
    const { clientAddress, reason = "User requested cancellation" } = req.body;

    if (!clientAddress) {
      return res.status(400).json({ success: false, error: "clientAddress is required" });
    }

    // Get deal (check cache first)
    let deal = getCachedDeal(dealId);
    if (!deal) {
      deal = await StorageDeals.getDeal(gun, dealId);
    }

    if (!deal) {
      return res.status(404).json({ success: false, error: "Deal not found" });
    }

    // Verify ownership
    if (deal.clientAddress.toLowerCase() !== clientAddress.toLowerCase()) {
      return res.status(403).json({
        success: false,
        error: "You can only cancel your own deals",
      });
    }

    // Only allow cancellation if deal is pending or active
    if (deal.status === StorageDeals.DEAL_STATUS.TERMINATED) {
      return res.status(400).json({
        success: false,
        error: "Deal is already terminated",
      });
    }

    const terminatedDeal = StorageDeals.terminateDeal(deal);
    (terminatedDeal as any).terminatedAt = Date.now();
    (terminatedDeal as any).terminationReason = reason;
    const seaKey = (relayUser as any)?._?.sea;
    if (seaKey) {
      await StorageDeals.saveDeal(gun, terminatedDeal, seaKey);
    }

    // Update cache
    cacheDeal(terminatedDeal);

    console.log(`✅ Deal ${dealId} cancelled by client ${clientAddress}`);

    res.json({
      success: true,
      deal: {
        id: terminatedDeal.id,
        status: terminatedDeal.status,
        terminatedAt: (terminatedDeal as any).terminatedAt,
      },
      message: "Deal cancelled successfully",
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Deal cancellation error:", error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * POST /api/v1/deals/:dealId/terminate
 *
 * Terminate a deal early.
 * Admin only.
 */
router.post("/:dealId/terminate", express.json(), async (req, res) => {
  try {
    // Check admin auth
    const authHeader = req.headers["authorization"];
    const token = authHeader?.split(" ")[1] || req.headers["token"];
    if (token !== authConfig.adminPassword) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const gun = req.app.get("gunInstance");
    const relayUser = getRelayUser();

    if (!gun || !relayUser) {
      return res.status(503).json({ success: false, error: "Relay not initialized" });
    }

    const { dealId } = req.params;
    const { reason = "Admin termination" } = req.body;

    // Check cache first
    let deal = getCachedDeal(dealId);
    if (!deal) {
      deal = await StorageDeals.getDeal(gun, dealId);
    }

    if (!deal) {
      return res.status(404).json({ success: false, error: "Deal not found" });
    }

    const terminatedDeal = StorageDeals.terminateDeal(deal);
    // Add termination reason manually since TypeScript version doesn't accept it
    (terminatedDeal as any).terminationReason = reason;
    (terminatedDeal as any).terminatedAt = Date.now();
    const keyPair = (relayUser as any)?._?.sea || null;
    if (!keyPair) {
      return res.status(500).json({ success: false, error: "Key pair not available" });
    }
    await StorageDeals.saveDeal(gun, terminatedDeal, keyPair);

    // Update cache
    cacheDeal(terminatedDeal);

    res.json({
      success: true,
      deal: {
        id: terminatedDeal.id,
        status: terminatedDeal.status,
        terminatedAt: (terminatedDeal as any).terminatedAt,
      },
      message: "Deal terminated",
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * POST /api/v1/deals/sync
 *
 * Manually trigger synchronization of on-chain deals with IPFS pins.
 * Fetches all active deals for this relay and ensures their CIDs are pinned.
 */
router.post("/sync", async (req: Request, res: Response) => {
  try {
    const RELAY_PRIVATE_KEY = registryConfig.relayPrivateKey;
    const REGISTRY_CHAIN_ID = registryConfig.chainId;

    if (!RELAY_PRIVATE_KEY) {
      return res.status(400).json({
        success: false,
        error: "RELAY_PRIVATE_KEY not configured",
      });
    }

    if (!REGISTRY_CHAIN_ID) {
      return res.status(400).json({
        success: false,
        error: "REGISTRY_CHAIN_ID not configured",
      });
    }

    // Get relay address from private key
    const registryClient = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
    const relayAddress = registryClient.wallet.address;

    // Get GunDB instance and relay user for GunDB sync
    const gun = req.app.get("gunInstance");
    const relayUser = getRelayUser();
    const relayKeyPair = (relayUser as any)?._?.sea || null;

    // Parse options from request body
    const { onlyActive = true, dryRun = false } = req.body || {};

    loggers.server.info(
      { relayAddress, chainId: REGISTRY_CHAIN_ID },
      `🔄 Manual deal sync triggered for relay ${relayAddress}`
    );

    // Perform sync
    const results = await DealSync.syncDealsWithIPFS(relayAddress, REGISTRY_CHAIN_ID, {
      onlyActive,
      dryRun,
      gun: gun,
      relayKeyPair: relayKeyPair,
    });

    res.json({
      success: true,
      relayAddress,
      chainId: REGISTRY_CHAIN_ID,
      results,
      message: `Sync completed: ${results.synced} pinned, ${results.alreadyPinned} already pinned, ${results.failed} failed`,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("❌ Deal sync error:", error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * GET /api/v1/deals/sync/status
 *
 * Get synchronization status for all active deals.
 * Shows which deals are pinned and which need syncing.
 */
router.get("/sync/status", async (req: Request, res: Response) => {
  try {
    const RELAY_PRIVATE_KEY = registryConfig.relayPrivateKey;
    const REGISTRY_CHAIN_ID = registryConfig.chainId;

    if (!RELAY_PRIVATE_KEY) {
      return res.status(400).json({
        success: false,
        error: "RELAY_PRIVATE_KEY not configured",
      });
    }

    if (!REGISTRY_CHAIN_ID) {
      return res.status(400).json({
        success: false,
        error: "REGISTRY_CHAIN_ID not configured",
      });
    }

    // Get relay address from private key
    const registryClient = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
    const relayAddress = registryClient.wallet.address;

    // Get sync status
    const status = await DealSync.getDealSyncStatus(relayAddress, REGISTRY_CHAIN_ID);

    const summary = {
      total: status.length,
      pinned: status.filter((s) => s.pinned).length,
      needsSync: status.filter((s) => s.needsSync).length,
    };

    res.json({
      success: true,
      relayAddress,
      chainId: REGISTRY_CHAIN_ID,
      summary,
      deals: status,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "❌ Deal sync status error");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

export default router;
