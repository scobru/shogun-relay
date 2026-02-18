import { Router, Request, Response } from "express";
import { ethers } from "ethers";
import * as StorageDeals from "../../utils/storage-deals";
import { getRelayPub, getRelayUser } from "../../utils/relay-user";
import { loggers } from "../../utils/logger";
import { registryConfig, authConfig } from "../../config";
import { createStorageDealRegistryClient } from "../../utils/registry-client";
import { pendingDealsCache } from "./utils";

const router: Router = Router();

/**
 * GET /api/v1/deals/by-cid/:cid
 *
 * Get all deals for a CID.
 */
router.get("/by-cid/:cid", async (req: Request, res: Response) => {
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
 */
router.get("/by-client/:address", async (req: Request, res: Response) => {
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
        (gunDeal as any).onChainRegistered = true;
        (gunDeal as any).onChainDealId = onChainDeal.dealId;
        (gunDeal as any).onChainRelay = onChainDeal.relay;
        dealMap.set(gunDeal.id, gunDeal);
      } else {
        // Create stub from on-chain data (deal exists on-chain but not in GunDB yet)
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
      (deal as any).onChainRegistered = (deal as any).onChainRegistered || false;
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
 * Includes deals from both GunDB and on-chain registry.
 * Admin only.
 */
router.get("/relay/active", async (req: Request, res: Response) => {
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

    // Get deals from GunDB
    const gunDeals = await StorageDeals.getActiveDealsForRelay(gun, relayPub);
    const dealMap = new Map<string, StorageDeals.Deal>();

    // Add GunDB deals to map
    for (const deal of gunDeals) {
      if (deal.id) {
        dealMap.set(deal.id, deal);
      }
    }

    // Also fetch deals from on-chain registry if configured
    const RELAY_PRIVATE_KEY = registryConfig.getRelayPrivateKey();
    const REGISTRY_CHAIN_ID = registryConfig.chainId;

    if (RELAY_PRIVATE_KEY && REGISTRY_CHAIN_ID) {
      try {
        const { createStorageDealRegistryClient, createRegistryClientWithSigner } =
          await import("../../utils/registry-client.js");
        const registryClient = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
        const relayAddress = registryClient.wallet.address;
        const storageDealRegistryClient = createStorageDealRegistryClient(REGISTRY_CHAIN_ID);

        const onChainDeals = await storageDealRegistryClient.getRelayDeals(relayAddress);

        // Convert on-chain deals to GunDB format and add to map
        for (const onChainDeal of onChainDeals) {
          if (onChainDeal.active && new Date(onChainDeal.expiresAt) > new Date()) {
            const deal: StorageDeals.Deal = {
              id: onChainDeal.dealId,
              version: 1,
              cid: onChainDeal.cid,
              clientAddress: onChainDeal.client,
              providerPub: relayAddress, // Use relay address as providerPub for on-chain deals
              tier: "standard",
              sizeMB: onChainDeal.sizeMB,
              durationDays: 0,
              pricing: {
                tier: "standard",
                sizeMB: onChainDeal.sizeMB,
                durationDays: 0,
                months: 0,
                pricePerMBMonth: 0,
                basePrice: 0,
                storageOverheadPercent: 0,
                replicationFactor: 1,
                totalPriceUSDC: parseFloat(String(onChainDeal.priceUSDC || 0)),
                features: {
                  erasureCoding: false,
                  slaGuarantee: false,
                },
              },
              createdAt: new Date(onChainDeal.createdAt).getTime(),
              activatedAt: new Date(onChainDeal.createdAt).getTime(),
              expiresAt: new Date(onChainDeal.expiresAt).getTime(),
              paymentRequired: 0,
              paymentVerified: true,
              erasureCoding: false,
              replicationFactor: 1,
              replicas: {},
              replicaCount: 0,
              status: StorageDeals.DEAL_STATUS.ACTIVE,
            };

            // Only add if not already in map (GunDB deals take precedence)
            if (!dealMap.has(deal.id)) {
              dealMap.set(deal.id, deal);
            }
          }
        }
      } catch (onChainError) {
        // Log error but continue - on-chain is optional
        loggers.server.warn(
          { err: onChainError },
          "Failed to fetch on-chain deals for relay/active endpoint"
        );
      }
    }

    // Convert map to array and calculate stats
    const allDeals = Array.from(dealMap.values());
    const stats = StorageDeals.getDealStats(allDeals);

    res.json({
      success: true,
      relayPub,
      stats,
      activeDeals: allDeals,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

export default router;
