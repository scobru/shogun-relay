import { Router, Request, Response } from "express";
import * as StorageDeals from "../../utils/storage-deals";
import * as ErasureCoding from "../../utils/erasure-coding";

const router: Router = Router();

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

export default router;
