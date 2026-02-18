import { Router, Request, Response } from "express";
import * as StorageDeals from "../../utils/storage-deals";
import { registryConfig } from "../../config";
import { GUN_PATHS } from "../../utils/gun-paths";

const router: Router = Router();

/**
 * GET /api/v1/deals/stats
 *
 * Get aggregate statistics for all deals (network-wide).
 * Aggregates stats from all relays in the network.
 */
router.get("/stats", async (req: Request, res: Response) => {
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
        .get(GUN_PATHS.FROZEN_STORAGE_DEALS_LEGACY)
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
        .get(GUN_PATHS.SHOGUN_DEALS)
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

    // Optional: Also check on-chain deals if relay is configured and no deals found in GunDB
    const RELAY_PRIVATE_KEY = registryConfig.getRelayPrivateKey();
    const REGISTRY_CHAIN_ID = registryConfig.chainId;
    const dealMap = new Map<string, any>(); // Use map to deduplicate by deal ID

    // Add existing deals to map
    for (const deal of allDeals) {
      if (deal.id) {
        dealMap.set(deal.id, deal);
      }
    }

    if (RELAY_PRIVATE_KEY && REGISTRY_CHAIN_ID && allDeals.length === 0) {
      try {
        const { createStorageDealRegistryClient, createRegistryClientWithSigner } =
          await import("../../utils/registry-client.js");
        const registryClient = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
        const relayAddress = registryClient.wallet.address;
        const storageDealRegistryClient = createStorageDealRegistryClient(REGISTRY_CHAIN_ID);

        const onChainDeals = await storageDealRegistryClient.getRelayDeals(relayAddress);

        // Convert on-chain deals to GunDB format for stats calculation
        for (const onChainDeal of onChainDeals) {
          if (onChainDeal.active && new Date(onChainDeal.expiresAt) > new Date()) {
            const deal: StorageDeals.Deal = {
              id: onChainDeal.dealId,
              version: 1,
              cid: onChainDeal.cid,
              clientAddress: onChainDeal.client,
              providerPub: relayAddress,
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
                totalPriceUSDC: 0,
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

            if (!dealMap.has(deal.id)) {
              dealMap.set(deal.id, deal);
              allDeals.push(deal);
            }
          }
        }
      } catch (onChainError) {
        // Ignore on-chain errors - non-critical
        console.error("Error fetching on-chain deals:", onChainError);
      }
    }

    // Calculate aggregate stats
    const stats = StorageDeals.getDealStats(allDeals);

    res.json({
      success: true,
      stats: {
        ...stats,
        total: stats.total,
        active: stats.active,
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
router.get("/leaderboard", async (req: Request, res: Response) => {
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
        .get(GUN_PATHS.SHOGUN_DEALS)
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
    console.error("Error fetching deal leaderboard:", error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

export default router;
