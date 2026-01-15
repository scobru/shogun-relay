import { Router, Request, Response } from "express";
import express from "express";
import http from "http";
import https from "https";
import crypto from "crypto";
import { ethers } from "ethers";
import * as StorageDeals from "../../utils/storage-deals";
import * as Reputation from "../../utils/relay-reputation";
import {
  createRegistryClient,
  createRegistryClientWithSigner,
  createStorageDealRegistryClient,
  createStorageDealRegistryClientWithSigner,
} from "../../utils/registry-client";
import { loggers } from "../../utils/logger";
import { registryConfig, ipfsConfig, relayConfig, authConfig } from "../../config";
import { getConfigByChainId } from "shogun-contracts-sdk";
import { getRelayUser, getRelayPub } from "../../utils/relay-user";
import { cacheDeal, getCachedDeal, removeCachedDeal } from "./utils";

const router: Router = Router();
const IPFS_API_TOKEN: string | undefined = ipfsConfig.apiToken;

/**
 * POST /api/v1/deals/create
 *
 * Create a new storage deal.
 * Returns payment requirements for x402.
 */
router.post("/create", express.json(), async (req: Request, res: Response) => {
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
    const RELAY_PRIVATE_KEY = registryConfig.getRelayPrivateKey();

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
router.post("/:dealId/activate", express.json(), async (req: Request, res: Response) => {
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
    const RELAY_PRIVATE_KEY = registryConfig.getRelayPrivateKey();
    const REGISTRY_CHAIN_ID = registryConfig.chainId;

    if (!RELAY_PRIVATE_KEY || !REGISTRY_CHAIN_ID) {
      return res.status(503).json({
        success: false,
        error: "Relay not configured for on-chain operations",
      });
    }

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
            (storageDealRegistryClient.provider as any)._getConnection?.()?.url ||
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
              (storageDealRegistryClient.provider as any)._getConnection?.()?.url ||
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

export default router;
