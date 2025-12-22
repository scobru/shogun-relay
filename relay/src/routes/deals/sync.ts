import { Router, Request, Response } from "express";
import { registryConfig } from "../../config";
import { createRegistryClientWithSigner } from "../../utils/registry-client";
import { loggers } from "../../utils/logger";
import { getRelayUser } from "../../utils/relay-user";
import * as DealSync from "../../utils/deal-sync";

const router: Router = Router();

/**
 * POST /api/v1/deals/sync
 *
 * Manually trigger synchronization of on-chain deals with IPFS pins.
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

    const registryClient = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
    const relayAddress = registryClient.wallet.address;

    const gun = req.app.get("gunInstance");
    const relayUser = getRelayUser();
    const relayKeyPair = (relayUser as any)?._?.sea || null;

    const { onlyActive = true, dryRun = false } = req.body || {};

    loggers.server.info(
      { relayAddress, chainId: REGISTRY_CHAIN_ID },
      `🔄 Manual deal sync triggered for relay ${relayAddress}`
    );

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
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/v1/deals/sync/status
 *
 * Get synchronization status for all active deals.
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

    const registryClient = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, REGISTRY_CHAIN_ID);
    const relayAddress = registryClient.wallet.address;

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
    res.status(500).json({ success: false, error: errorMessage });
  }
});

export default router;
