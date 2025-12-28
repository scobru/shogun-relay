import express, { Router } from "express";
import { ethers } from "ethers";
import { log, getBridgeClient, getRelayHost, getSigningKeyPair } from "./utils";
import {
  getBatch,
  getPendingWithdrawals,
  getLatestBatch,
  getProcessedDepositsForUser,
  listL2Transfers,
} from "../../utils/bridge-state";
import { submitBatch } from "../../utils/batch-submitter";
import * as Reputation from "../../utils/relay-reputation";
import { PendingWithdrawal, Batch } from "../../utils/bridge-state";

const router: Router = Router();

/**
 * POST /api/v1/bridge/submit-batch
 *
 * Sequencer endpoint: Submit a batch with Merkle root.
 */
router.post("/submit-batch", express.json(), async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      log.error({}, "GunDB not initialized in submit-batch");
      return res.status(503).json({
        success: false,
        error: "GunDB not initialized",
      });
    }

    const relayKeyPair = req.app.get("relayKeyPair");
    const relayPub = relayKeyPair?.pub;

    const result = await submitBatch(gun, relayPub);

    if (result.success) {
      try {
        const relayHost = getRelayHost(req);
        const keyPair = getSigningKeyPair();
        if (keyPair) {
          await Reputation.recordBatchSubmissionSuccess(
            gun,
            relayHost,
            result.withdrawalCount || 0,
            keyPair
          );
        }
      } catch (e) {
        log.warn({ err: e }, "Failed to record batch submission success for reputation");
      }

      res.json({
        success: true,
        batch: {
          batchId: result.batchId,
          root: result.root,
          withdrawalCount: result.withdrawalCount,
          txHash: result.txHash,
          blockNumber: result.blockNumber,
        },
      });
    } else {
      if (result.error !== "No pending withdrawals to batch") {
        try {
          const relayHost = getRelayHost(req);
          const keyPair = getSigningKeyPair();
          if (keyPair) {
            await Reputation.recordBatchSubmissionFailure(gun, relayHost, keyPair);
          }
        } catch (e) {
          log.warn({ err: e }, "Failed to record batch submission failure for reputation");
        }
      }

      res.status(result.error === "No pending withdrawals to batch" ? 400 : 500).json({
        success: false,
        error: result.error,
        errorCode: (result as any).errorCode,
        errorReason: (result as any).errorReason,
      });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error: errorMessage }, "Error in submit-batch endpoint");

    try {
      const gun = req.app.get("gunInstance");
      if (gun) {
        const relayHost = getRelayHost(req);
        const keyPair = getSigningKeyPair();
        if (keyPair) {
          await Reputation.recordBatchSubmissionFailure(gun, relayHost, keyPair);
        }
      }
    } catch (e) {
      log.warn({ err: e }, "Failed to record batch submission failure for reputation");
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * GET /api/v1/bridge/batch-history/:user
 *
 * Get batch history for a user.
 */
router.get("/batch-history/:user", async (req, res) => {
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

    // Collect all batch IDs
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
      setTimeout(resolve, 1000);
    });

    const userBatches: Array<{
      batchId: string;
      root: string;
      txHash: string | null;
      timestamp: number;
      finalized: boolean;
      withdrawals: Array<{
        amount: string;
        nonce: string;
        timestamp: number;
      }>;
    }> = [];

    const client = getBridgeClient();

    for (const batchId of batchIds) {
      const batch = await getBatch(gun, batchId);
      if (!batch) continue;

      const userWithdrawals = batch.withdrawals.filter((w: PendingWithdrawal) => {
        const wUser = (typeof w.user === "string" ? w.user : String(w.user || "")).toLowerCase();
        return wUser === normalizedUser;
      });

      if (userWithdrawals.length > 0) {
        let finalized = false;
        try {
          const batchInfo = await client.getBatchInfo(BigInt(batchId));
          finalized = batchInfo.finalized;
        } catch {}

        userBatches.push({
          batchId: batch.batchId,
          root: batch.root,
          txHash: batch.txHash || null,
          timestamp: batch.timestamp,
          finalized,
          withdrawals: userWithdrawals.map((w: PendingWithdrawal) => ({
            amount: typeof w.amount === "string" ? w.amount : String(w.amount),
            nonce: typeof w.nonce === "string" ? w.nonce : String(w.nonce),
            timestamp: w.timestamp,
          })),
        });
      }
    }

    const processedDeposits = await getProcessedDepositsForUser(gun, normalizedUser);

    userBatches.sort((a, b) => b.timestamp - a.timestamp);

    res.json({
      success: true,
      user: userAddress,
      batches: userBatches,
      deposits: processedDeposits.map((d) => ({
        txHash: d.txHash,
        amount: d.amount,
        amountEth: ethers.formatEther(BigInt(d.amount)),
        blockNumber: d.blockNumber,
        timestamp: d.timestamp,
      })),
      summary: {
        totalBatches: userBatches.length,
        totalDeposits: processedDeposits.length,
        totalWithdrawals: userBatches.reduce((sum, b) => sum + b.withdrawals.length, 0),
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error }, "Error getting batch history");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * GET /api/v1/bridge/transactions/:user
 *
 * Get all transactions (deposits, withdrawals, transfers) for a user.
 */
router.get("/transactions/:user", async (req, res) => {
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
    const relayKeyPair = req.app.get("relayKeyPair");
    const client = getBridgeClient();

    const [onChainDeposits, onChainWithdrawals, l2Transfers, processedDeposits] = await Promise.all(
      [
        client.queryDeposits(0, "latest", normalizedUser).catch((err) => {
          log.warn({ error: err }, "Failed to query on-chain deposits");
          return [];
        }),
        client.queryWithdrawals(0, "latest", normalizedUser).catch((err) => {
          log.warn({ error: err }, "Failed to query on-chain withdrawals");
          return [];
        }),
        listL2Transfers(gun).catch((err) => {
          log.warn({ error: err }, "Failed to query L2 transfers");
          return [];
        }),
        getProcessedDepositsForUser(gun, normalizedUser).catch((err) => {
          log.warn({ error: err }, "Failed to query processed deposits");
          return [];
        }),
      ]
    );

    const transactions: Array<{
      type: "deposit" | "withdrawal" | "transfer";
      txHash: string;
      from?: string;
      to?: string;
      amount: string;
      amountEth: string;
      timestamp: number;
      blockNumber?: number;
      nonce?: string;
      batchId?: string;
      status: "pending" | "completed" | "batched";
    }> = [];

    for (const deposit of onChainDeposits) {
      const processed = processedDeposits.find(
        (p) => p.txHash === deposit.txHash && p.user.toLowerCase() === normalizedUser
      );

      transactions.push({
        type: "deposit",
        txHash: deposit.txHash,
        to: deposit.user,
        amount: deposit.amount.toString(),
        amountEth: ethers.formatEther(deposit.amount),
        timestamp: processed?.timestamp || deposit.blockNumber * 1000 || Date.now(),
        blockNumber: deposit.blockNumber,
        status: processed ? "completed" : "pending",
      });
    }

    for (const withdrawal of onChainWithdrawals) {
      transactions.push({
        type: "withdrawal",
        txHash: withdrawal.txHash || "",
        from: withdrawal.user,
        amount: withdrawal.amount.toString(),
        amountEth: ethers.formatEther(withdrawal.amount),
        timestamp: withdrawal.blockNumber * 1000 || Date.now(),
        blockNumber: withdrawal.blockNumber,
        nonce: withdrawal.nonce.toString(),
        status: "completed",
      });
    }

    for (const transfer of l2Transfers) {
      const from = transfer.from?.toLowerCase();
      const to = transfer.to?.toLowerCase();

      if (from === normalizedUser || to === normalizedUser) {
        transactions.push({
          type: "transfer",
          txHash: transfer.transferHash,
          from: transfer.from,
          to: transfer.to,
          amount: transfer.amount,
          amountEth: ethers.formatEther(BigInt(transfer.amount)),
          timestamp: transfer.timestamp || Date.now(),
          status: "completed",
        });
      }
    }

    const pendingWithdrawals = await getPendingWithdrawals(gun).catch(() => []);
    for (const withdrawal of pendingWithdrawals) {
      const wUser = (
        typeof withdrawal.user === "string" ? withdrawal.user : String(withdrawal.user || "")
      ).toLowerCase();
      if (wUser === normalizedUser) {
        const exists = transactions.some(
          (t) => t.type === "withdrawal" && t.nonce === withdrawal.nonce
        );

        if (!exists) {
          transactions.push({
            type: "withdrawal",
            txHash: "",
            from: withdrawal.user,
            amount:
              typeof withdrawal.amount === "string"
                ? withdrawal.amount
                : String(withdrawal.amount || "0"),
            amountEth: ethers.formatEther(
              BigInt(
                typeof withdrawal.amount === "string"
                  ? withdrawal.amount
                  : String(withdrawal.amount || "0")
              )
            ),
            timestamp: withdrawal.timestamp || Date.now(),
            nonce:
              typeof withdrawal.nonce === "string"
                ? withdrawal.nonce
                : String(withdrawal.nonce || "0"),
            status: "pending",
          });
        }
      }
    }

    transactions.sort((a, b) => b.timestamp - a.timestamp);

    res.json({
      success: true,
      user: userAddress,
      transactions,
      count: transactions.length,
      summary: {
        deposits: transactions.filter((t) => t.type === "deposit").length,
        withdrawals: transactions.filter((t) => t.type === "withdrawal").length,
        transfers: transactions.filter((t) => t.type === "transfer").length,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error }, "Error getting transaction history");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * GET /api/v1/bridge/transaction/:txHash
 *
 * Get detailed information about a specific transaction by hash.
 */
router.get("/transaction/:txHash", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({
        success: false,
        error: "GunDB not initialized",
      });
    }

    const { txHash } = req.params;

    if (!txHash || typeof txHash !== "string") {
      return res.status(400).json({
        success: false,
        error: "Invalid transaction hash",
      });
    }

    const relayKeyPair = req.app.get("relayKeyPair");
    const client = getBridgeClient();

    let transaction: any = null;
    let source: "deposit" | "withdrawal" | "transfer" | null = null;

    try {
      const deposits = await client.queryDeposits(0, "latest");
      const deposit = deposits.find((d) => d.txHash.toLowerCase() === txHash.toLowerCase());

      if (deposit) {
        const processed = await getProcessedDepositsForUser(gun, deposit.user).catch(() => []);
        const processedDeposit = processed.find(
          (p) => p.txHash.toLowerCase() === txHash.toLowerCase()
        );

        transaction = {
          type: "deposit",
          txHash: deposit.txHash,
          from: null,
          to: deposit.user,
          amount: deposit.amount.toString(),
          amountEth: ethers.formatEther(deposit.amount),
          timestamp: processedDeposit?.timestamp || deposit.blockNumber * 1000 || Date.now(),
          blockNumber: deposit.blockNumber,
          status: processedDeposit ? "completed" : "pending",
        };
        source = "deposit";
      }
    } catch (err) {}

    if (!transaction) {
      try {
        const withdrawals = await client.queryWithdrawals(0, "latest");
        const withdrawal = withdrawals.find(
          (w) => w.txHash?.toLowerCase() === txHash.toLowerCase()
        );

        if (withdrawal) {
          transaction = {
            type: "withdrawal",
            txHash: withdrawal.txHash || txHash,
            from: withdrawal.user,
            to: null,
            amount: withdrawal.amount.toString(),
            amountEth: ethers.formatEther(withdrawal.amount),
            timestamp: withdrawal.blockNumber * 1000 || Date.now(),
            blockNumber: withdrawal.blockNumber,
            nonce: withdrawal.nonce.toString(),
            status: "completed",
          };
          source = "withdrawal";
        }
      } catch (err) {}
    }

    if (!transaction) {
      try {
        let transfer: {
          from: string;
          to: string;
          amount: string;
          transferHash: string;
          timestamp: number;
        } | null = null;

        try {
          const FrozenData = await import("../../utils/frozen-data");
          const entry = await FrozenData.readFrozenEntry(
            gun,
            "bridge-transfers",
            txHash.trim(),
            relayKeyPair?.pub || ""
          );

          if (entry && entry.verified && entry.data) {
            const transferData = entry.data as any;
            if (
              transferData.type === "bridge-transfer" &&
              transferData.from &&
              transferData.to &&
              transferData.amount
            ) {
              transfer = {
                from: transferData.from,
                to: transferData.to,
                amount: transferData.amount,
                transferHash: transferData.transferHash || txHash.trim(),
                timestamp: transferData.timestamp || Date.now(),
              };
            }
          }
        } catch (err) {}

        if (!transfer) {
          const transfers = await listL2Transfers(gun);
          transfer = transfers.find((t) => t.transferHash === txHash.trim()) || null;

          if (!transfer) {
            transfer =
              transfers.find((t) => t.transferHash.toLowerCase() === txHash.toLowerCase().trim()) ||
              null;
          }

          if (!transfer) {
            const normalizedTxHash = txHash.trim().toLowerCase();
            for (const t of transfers) {
              try {
                const indexNode = gun
                  .get("shogun-index")
                  .get("bridge-transfers")
                  .get(t.transferHash);
                const indexEntry: any = await new Promise((resolve) => {
                  const timeout = setTimeout(() => resolve(null), 2000);
                  indexNode.once((data: any) => {
                    clearTimeout(timeout);
                    resolve(data);
                  });
                });

                if (indexEntry && indexEntry.latestHash) {
                  if (
                    indexEntry.latestHash === txHash.trim() ||
                    indexEntry.latestHash.toLowerCase() === normalizedTxHash
                  ) {
                    transfer = t;
                    break;
                  }
                }
              } catch (err) {}
            }
          }
        }

        if (transfer) {
          transaction = {
            type: "transfer",
            txHash: transfer.transferHash,
            from: transfer.from,
            to: transfer.to,
            amount: transfer.amount,
            amountEth: ethers.formatEther(BigInt(transfer.amount)),
            timestamp: transfer.timestamp || Date.now(),
            status: "completed",
          };
          source = "transfer";
        }
      } catch (err) {}
    }

    if (!transaction) {
      return res.status(404).json({ success: false, error: "Transaction not found" });
    }

    res.json({
      success: true,
      transaction,
      source,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error, txHash: req.params.txHash }, "Error getting transaction details");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

export default router;
