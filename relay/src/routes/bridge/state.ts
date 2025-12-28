import express, { Router } from "express";
import { ethers } from "ethers";
import { log, getBridgeClient } from "./utils";
import { bridgeConfig } from "../../config";
import {
  getUserBalance,
  getLatestBatch,
  getProcessedDepositsForUser,
  getBatch,
  refreshTrustedRelaysCache,
  getPendingWithdrawals,
  compareBalances,
  syncMissingDeposits,
} from "../../utils/bridge-state";
import { getRelayKeyPair } from "../../utils/relay-user";
import { authConfig } from "../../config";
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
 * Get bridge statistics from GunDB
 */
async function getBridgeStats(gun: any): Promise<{
  totalUsers: number;
  totalDeposits: number;
  totalWithdrawals: number;
  pendingWithdrawals: number;
}> {
  const stats = {
    totalUsers: 0,
    totalDeposits: 0,
    totalWithdrawals: 0,
    pendingWithdrawals: 0,
  };

  try {
    // Get pending withdrawals
    const pending = await getPendingWithdrawals(gun);
    stats.pendingWithdrawals = pending.length;

    // Get all processed deposits
    const depositsPromise = new Promise<number>((resolve) => {
      const deposits: Set<string> = new Set();
      const timeout = setTimeout(() => resolve(deposits.size), 5000);

      gun
        .get("bridge")
        .get("processed-deposits")
        .map()
        .once((deposit: any, key?: string) => {
          if (deposit && key) {
            deposits.add(key);
          }
        });

      setTimeout(() => {
        clearTimeout(timeout);
        resolve(deposits.size);
      }, 4000);
    });

    // Get all batches and count withdrawals
    const batchesPromise = new Promise<number>((resolve) => {
      let totalWithdrawals = 0;
      const timeout = setTimeout(() => resolve(totalWithdrawals), 5000);

      gun
        .get("bridge")
        .get("batches")
        .map()
        .once(async (batch: any, key: string) => {
          if (batch && key && batch.batchId) {
            // Try to get full batch to count withdrawals
            try {
              const fullBatch = await getBatch(gun, batch.batchId);
              if (fullBatch && fullBatch.withdrawals) {
                totalWithdrawals += fullBatch.withdrawals.length;
              } else if (batch.withdrawalsCount) {
                // Fallback to withdrawalsCount if available
                totalWithdrawals += batch.withdrawalsCount;
              }
            } catch (e) {
              // Ignore errors
            }
          }
        });

      setTimeout(() => {
        clearTimeout(timeout);
        resolve(totalWithdrawals);
      }, 4000);
    });

    // Get all unique users (from balance indices)
    const usersPromise = new Promise<number>((resolve) => {
      const users: Set<string> = new Set();
      const timeout = setTimeout(() => resolve(users.size), 5000);

      gun
        .get("bridge")
        .get("balances-index")
        .map()
        .once((index: any, key?: string) => {
          if (index && key && key !== "_") {
            users.add(key.toLowerCase());
          }
        });

      setTimeout(() => {
        clearTimeout(timeout);
        resolve(users.size);
      }, 4000);
    });

    const [totalDeposits, totalWithdrawals, totalUsers] = await Promise.all([
      depositsPromise,
      batchesPromise,
      usersPromise,
    ]);

    stats.totalDeposits = totalDeposits;
    stats.totalWithdrawals = totalWithdrawals;
    stats.totalUsers = totalUsers;
  } catch (error) {
    log.error({ error }, "Error calculating bridge stats");
  }

  return stats;
}

/**
 * GET /api/v1/bridge/state
 *
 * Get current bridge state (root, batchId, contract balance, etc.)
 */
router.get("/state", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    const client = getBridgeClient();

    const [stateRoot, batchId, sequencer, balance] = await Promise.all([
      client.getCurrentStateRoot(),
      client.getCurrentBatchId(),
      client.getSequencer(),
      client.getBalance(),
    ]);

    // Get bridge statistics from GunDB
    const bridgeStats = gun ? await getBridgeStats(gun) : {
      totalUsers: 0,
      totalDeposits: 0,
      totalWithdrawals: 0,
      pendingWithdrawals: 0,
    };

    res.json({
      success: true,
      state: {
        chainId: bridgeConfig.chainId,
        currentStateRoot: stateRoot,
        currentBatchId: batchId.toString(),
        sequencer,
        contractBalance: balance.toString(),
        contractBalanceEth: ethers.formatEther(balance),
        totalUsers: bridgeStats.totalUsers,
        totalDeposits: bridgeStats.totalDeposits,
        totalWithdrawals: bridgeStats.totalWithdrawals,
        pendingWithdrawals: bridgeStats.pendingWithdrawals,
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

/**
 * GET /api/v1/bridge/compare-balance/:user
 *
 * Compare user's on-chain balance with GunDB balance.
 * Useful for detecting discrepancies and missing deposits.
 */
router.get("/compare-balance/:user", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    const client = getBridgeClient();

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

    log.debug({ user: userAddress }, "Comparing on-chain vs GunDB balance");

    const comparison = await compareBalances(gun, client, userAddress);

    res.json({
      success: true,
      user: userAddress,
      onChain: {
        totalDeposits: comparison.onChain.totalDeposits.toString(),
        totalWithdrawals: comparison.onChain.totalWithdrawals.toString(),
        netBalance: comparison.onChain.netBalance.toString(),
        netBalanceEth: ethers.formatEther(comparison.onChain.netBalance),
        depositCount: comparison.onChain.depositCount,
        withdrawalCount: comparison.onChain.withdrawalCount,
      },
      gunDb: {
        balance: comparison.gunDb.toString(),
        balanceEth: ethers.formatEther(comparison.gunDb),
      },
      discrepancy: {
        amount: comparison.discrepancy.toString(),
        amountEth: ethers.formatEther(comparison.discrepancy),
        hasDiscrepancy: comparison.hasDiscrepancy,
        status: comparison.discrepancy > 0n
          ? "on-chain higher (missing deposits in GunDB)"
          : comparison.discrepancy < 0n
          ? "GunDB higher (possible double-credit)"
          : "balanced",
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error }, "Error comparing balances");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * POST /api/v1/bridge/sync-deposits
 *
 * Sync missing deposits from on-chain to GunDB.
 * ADMIN ONLY - requires authentication.
 */
router.post("/sync-deposits", express.json(), async (req, res) => {
  try {
    // Admin authentication
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const token = bearerToken || req.headers["token"];

    if (token !== authConfig.adminPassword) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized - admin authentication required",
      });
    }

    const gun = req.app.get("gunInstance");
    const client = getBridgeClient();
    const relayKeyPair = getRelayKeyPair();

    if (!gun) {
      return res.status(503).json({
        success: false,
        error: "GunDB not initialized",
      });
    }

    if (!relayKeyPair) {
      return res.status(503).json({
        success: false,
        error: "Relay keypair not initialized",
      });
    }

    const startBlock = req.body?.startBlock ? parseInt(req.body.startBlock) : 0;

    log.info({ startBlock }, "Starting deposit sync from on-chain");

    const result = await syncMissingDeposits(gun, client, relayKeyPair, startBlock);

    res.json({
      success: true,
      synced: result.synced,
      skipped: result.skipped,
      errors: result.errors,
      details: result.details,
      message: `Synced ${result.synced} missing deposits, skipped ${result.skipped}, errors: ${result.errors}`,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error }, "Error syncing deposits");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

export default router;
