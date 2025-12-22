import { Router, Request, Response } from "express";
import * as StorageDeals from "../../utils/storage-deals";

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
    console.error("Error fetching deal leaderboard:", error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

export default router;
