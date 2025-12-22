import express, { Router } from "express";
import { ethers } from "ethers";
import { log, getBridgeClient } from "./utils";
import {
  getUserBalance,
  getLatestBatch,
  getProcessedDepositsForUser,
  getBatch,
  refreshTrustedRelaysCache,
} from "../../utils/bridge-state";
import { PendingWithdrawal, Batch } from "../../utils/bridge-state";
import { WithdrawalLeaf, generateProof } from "../../utils/merkle-tree";

const router: Router = Router();

/**
 * GET /api/v1/bridge/balance/:user
 *
 * Get user's L2 balance
 */
router.get("/balance/:user", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({
        success: false,
        error: "GunDB not initialized",
      });
    }

    const { user } = req.params;

    let userAddress: string;
    try {
      userAddress = ethers.getAddress(user);
    } catch {
      return res.status(400).json({
        success: false,
        error: "Invalid user address",
      });
    }

    log.debug(
      { user: userAddress, normalizedUser: userAddress.toLowerCase() },
      "Getting user balance"
    );

    // Get balance from any trusted relay (registry-based trust)
    // This allows users to use any relay for operations
    const balance = await getUserBalance(gun, userAddress);

    log.debug(
      {
        user: userAddress,
        balance: balance.toString(),
        balanceEth: ethers.formatEther(balance),
      },
      "Balance retrieved"
    );

    res.json({
      success: true,
      user: userAddress,
      balance: balance.toString(),
      balanceEth: ethers.formatEther(balance),
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error }, "Error getting balance");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * GET /api/v1/bridge/balance-info/:user
 *
 * Get user's L2 balance with verification data for client-side proof checking.
 * Returns the balance along with the last batch where user operations were included,
 * enabling independent verification against on-chain Merkle roots.
 */
router.get("/balance-info/:user", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({
        success: false,
        error: "GunDB not initialized",
      });
    }

    const { user } = req.params;

    let userAddress: string;
    try {
      userAddress = ethers.getAddress(user);
    } catch {
      return res.status(400).json({
        success: false,
        error: "Invalid user address",
      });
    }

    const normalizedUser = userAddress.toLowerCase();

    // Get balance
    const balance = await getUserBalance(gun, userAddress);

    // Get the latest batch where this user has a withdrawal
    const latestBatch = await getLatestBatch(gun);
    let lastUserBatch: Batch | null = null;
    let lastUserWithdrawal: PendingWithdrawal | null = null;

    if (latestBatch) {
      // Search for user's withdrawal in latest batch
      const userWithdrawal = latestBatch.withdrawals.find((w: PendingWithdrawal) => {
        const wUser = (typeof w.user === "string" ? w.user : String(w.user || "")).toLowerCase();
        return wUser === normalizedUser;
      });

      if (userWithdrawal) {
        lastUserBatch = latestBatch;
        lastUserWithdrawal = userWithdrawal;
      } else {
        // Search older batches
        const batchesPath = "bridge/batches";
        const batchIds: string[] = [];

        await new Promise<void>((resolve) => {
          gun
            .get(batchesPath)
            .map()
            .once((batch: any, key: string) => {
              if (key && !key.startsWith("_") && batch?.batchId) {
                batchIds.push(batch.batchId);
              }
            });
          setTimeout(resolve, 500);
        });

        for (const batchId of batchIds.reverse()) {
          const batch = await getBatch(gun, batchId);
          if (batch) {
            const userW = batch.withdrawals.find((w: PendingWithdrawal) => {
              const wUser = (
                typeof w.user === "string" ? w.user : String(w.user || "")
              ).toLowerCase();
              return wUser === normalizedUser;
            });
            if (userW) {
              lastUserBatch = batch;
              lastUserWithdrawal = userW;
              break;
            }
          }
        }
      }
    }

    // Build verification object
    let verification: any = null;

    if (lastUserBatch && lastUserWithdrawal) {
      // Generate Merkle proof for user's last recorded withdrawal
      const withdrawals: WithdrawalLeaf[] = (lastUserBatch as Batch).withdrawals.map(
        (w: PendingWithdrawal) => ({
          user: w.user,
          amount: BigInt(typeof w.amount === "string" ? w.amount : String(w.amount)),
          nonce: BigInt(typeof w.nonce === "string" ? w.nonce : String(w.nonce)),
        })
      );

      const proof = generateProof(
        withdrawals,
        (lastUserWithdrawal as PendingWithdrawal).user,
        BigInt((lastUserWithdrawal as PendingWithdrawal).amount),
        BigInt((lastUserWithdrawal as PendingWithdrawal).nonce)
      );

      // Check if batch is finalized on-chain
      let verifiedOnChain = false;
      try {
        const client = getBridgeClient();
        const batchInfo = await client.getBatchInfo(BigInt((lastUserBatch as Batch).batchId));
        verifiedOnChain = batchInfo.finalized;
      } catch {
        // Non-critical, just means we can't verify on-chain status
      }

      verification = {
        lastBatchId: (lastUserBatch as Batch).batchId,
        lastBatchRoot: (lastUserBatch as Batch).root,
        lastBatchTxHash: (lastUserBatch as Batch).txHash || null,
        lastBatchTimestamp: (lastUserBatch as Batch).timestamp,
        lastWithdrawal: {
          amount: (lastUserWithdrawal as PendingWithdrawal).amount,
          nonce: (lastUserWithdrawal as PendingWithdrawal).nonce,
          timestamp: (lastUserWithdrawal as PendingWithdrawal).timestamp,
        },
        merkleProof: proof,
        verifiedOnChain,
      };
    }

    // Get processed deposits count
    const processedDeposits = await getProcessedDepositsForUser(gun, normalizedUser);

    res.json({
      success: true,
      user: userAddress,
      balance: balance.toString(),
      balanceEth: ethers.formatEther(balance),
      verification,
      stats: {
        processedDepositsCount: processedDeposits.length,
        hasVerificationData: verification !== null,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error }, "Error getting balance info");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * GET /api/v1/bridge/state
 *
 * Get current bridge state (root, batchId, contract balance, etc.)
 */
router.get("/state", async (req, res) => {
  try {
    const client = getBridgeClient();

    const [stateRoot, batchId, sequencer, balance] = await Promise.all([
      client.getCurrentStateRoot(),
      client.getCurrentBatchId(),
      client.getSequencer(),
      client.getBalance(),
    ]);

    res.json({
      success: true,
      state: {
        currentStateRoot: stateRoot,
        currentBatchId: batchId.toString(),
        sequencer,
        contractBalance: balance.toString(),
        contractBalanceEth: ethers.formatEther(balance),
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error }, "Error getting bridge state");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * POST /api/v1/bridge/refresh-trusted-relays
 *
 * Force refresh the trusted relays cache from the on-chain registry.
 */
router.post("/refresh-trusted-relays", express.json(), async (req, res) => {
  try {
    const chainId = req.body?.chainId
      ? parseInt(req.body.chainId)
      : parseInt(process.env.REGISTRY_CHAIN_ID || "84532");

    log.debug({ chainId }, "Forcing refresh of trusted relays cache");

    const trustedRelays = await refreshTrustedRelaysCache(chainId);

    res.json({
      success: true,
      trustedRelays: trustedRelays.map((pub) => ({
        pubKey: pub.substring(0, 32) + "...", // Truncated for security
        pubKeyLength: pub.length,
      })),
      count: trustedRelays.length,
      message: "Trusted relays cache refreshed successfully",
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error }, "Error refreshing trusted relays cache");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

export default router;
