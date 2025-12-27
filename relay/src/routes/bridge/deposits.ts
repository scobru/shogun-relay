import express, { Router } from "express";
import { ethers } from "ethers";
import { log, getBridgeClient } from "./utils";
import {
  getUserBalance,
  isDepositProcessed,
  markDepositProcessed,
  creditBalance,
} from "../../utils/bridge-state";
import { getRelayKeyPair, adminAuthMiddleware } from "../../utils/relay-user";
import { DepositEvent } from "../../utils/bridge-client";
import * as FrozenData from "../../utils/frozen-data";

const router: Router = Router();

/**
 * POST /api/v1/bridge/deposit
 *
 * Note: This endpoint is informational. Actual deposits should be done
 * directly on-chain by calling the contract's deposit() function.
 */
router.post("/deposit", express.json(), async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({
        success: false,
        error: "Amount required",
      });
    }

    const client = getBridgeClient();
    const contractAddress = client.contractAddress;

    res.json({
      success: true,
      message: "To deposit, send ETH to the bridge contract",
      contractAddress,
      amount: amount.toString(),
      instructions: "Call deposit() on the contract with the ETH amount",
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error }, "Error in deposit endpoint");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * POST /api/v1/bridge/sync-deposits
 *
 * Retroactively sync missed deposits from a block range.
 * SECURITY: Restricted to relay operators only (admin auth required)
 */
router.post(
  "/sync-deposits",
  adminAuthMiddleware,
  express.json({ limit: "10mb" }),
  async (req, res) => {
    try {
      const gun = req.app.get("gunInstance");
      if (!gun) {
        return res.status(503).json({
          success: false,
          error: "GunDB not initialized",
        });
      }

      if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({
          success: false,
          error: "Invalid request body",
        });
      }

      const { fromBlock, toBlock, user } = req.body;
      const client = getBridgeClient();
      const relayKeyPair = req.app.get("relayKeyPair");

      if (!relayKeyPair) {
        return res.status(500).json({
          success: false,
          error: "Relay keypair not configured",
        });
      }

      const fromBlockNumber = fromBlock !== undefined ? Number(fromBlock) : 0;
      const toBlockNumber =
        toBlock !== "latest" && toBlock !== undefined ? Number(toBlock) : "latest";

      log.debug(
        { fromBlock: fromBlockNumber, toBlock: toBlockNumber, user },
        "Starting retroactive deposit sync"
      );

      let allDeposits: DepositEvent[];
      try {
        allDeposits = await client.queryDeposits(
          fromBlockNumber,
          toBlockNumber,
          user ? ethers.getAddress(user) : undefined
        );
      } catch (error) {
        throw error;
      }

      const depositsToCheck = allDeposits;
      const results = {
        total: depositsToCheck.length,
        processed: 0,
        skipped: 0,
        failed: 0,
        withdrawals: 0, // Gets updated later if withdrawals are checked
        errors: [] as string[],
      };

      // Query L1 withdrawals to calculate correct net balance
      let userDepositsMap = new Map<string, bigint>();
      let userWithdrawalsMap = new Map<string, bigint>();

      // Populate userDepositsMap
      for (const deposit of depositsToCheck) {
        const normalizedUser = deposit.user.toLowerCase();
        const currentTotal = userDepositsMap.get(normalizedUser) || 0n;
        userDepositsMap.set(normalizedUser, currentTotal + deposit.amount);
      }

      // Populate userWithdrawalsMap
      try {
        const usersToCheck = user
          ? [user.toLowerCase()]
          : [...new Set(depositsToCheck.map((d) => d.user.toLowerCase()))];

        for (const userAddr of usersToCheck) {
          const userWithdrawals = await client.queryWithdrawals(
            fromBlockNumber,
            toBlockNumber,
            userAddr
          );
          results.withdrawals += userWithdrawals.length;
          for (const w of userWithdrawals) {
            const normalizedUser = w.user.toLowerCase();
            const currentTotal = userWithdrawalsMap.get(normalizedUser) || 0n;
            userWithdrawalsMap.set(normalizedUser, currentTotal + w.amount);
          }
        }
      } catch (error) {
        log.warn({ error }, "Failed to query L1 withdrawals");
      }

      let userExpectedBalanceMap = new Map<string, bigint>();
      for (const [user, deposits] of userDepositsMap.entries()) {
        const withdrawals = userWithdrawalsMap.get(user) || 0n;
        const netBalance = deposits - withdrawals;
        userExpectedBalanceMap.set(user, netBalance > 0n ? netBalance : 0n);
      }

      for (const deposit of depositsToCheck) {
        try {
          const normalizedUser = deposit.user.toLowerCase();
          const depositKey = `${deposit.txHash}:${normalizedUser}:${deposit.amount}`;

          let alreadyProcessed = await isDepositProcessed(gun, depositKey);

          if (alreadyProcessed) {
            const currentL2Balance = await getUserBalance(gun, normalizedUser);
            if (currentL2Balance === 0n) {
              alreadyProcessed = false;
            } else {
              results.skipped++;
              continue;
            }
          }

          const provider = client.provider;
          const receipt = await provider.getTransactionReceipt(deposit.txHash);

          if (!receipt || receipt.status !== 1) {
            results.skipped++;
            continue;
          }

          await creditBalance(gun, normalizedUser, deposit.amount, relayKeyPair);

          let balanceVerified = false;
          let attempts = 0;
          const maxAttempts = 10;
          while (!balanceVerified && attempts < maxAttempts) {
            const verifyBalance = await getUserBalance(gun, normalizedUser);
            if (verifyBalance >= deposit.amount) {
              balanceVerified = true;
            } else {
              await new Promise((resolve) => setTimeout(resolve, 500));
              attempts++;
            }
          }

          if (!balanceVerified) {
            results.failed++;
            results.errors.push(`${deposit.txHash}: Balance verification failed`);
            continue;
          }

          await markDepositProcessed(gun, depositKey, {
            txHash: deposit.txHash,
            user: normalizedUser,
            amount: deposit.amount.toString(),
            blockNumber: deposit.blockNumber,
            timestamp: Date.now(),
          });

          results.processed++;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          results.failed++;
          results.errors.push(`${deposit.txHash}: ${errorMsg}`);
        }
      }

      // Verify/Correct balances
      if (userExpectedBalanceMap.size > 0) {
        for (const [normalizedUser, expectedTotal] of userExpectedBalanceMap.entries()) {
          try {
            const actualBalance = await getUserBalance(gun, normalizedUser);
            if (actualBalance !== expectedTotal) {
              const balanceData: any = {
                balance: expectedTotal.toString(),
                ethereumAddress: normalizedUser,
                updatedAt: Date.now(),
                type: "bridge-balance",
                corrected: true,
              };

              await FrozenData.createFrozenEntry(
                gun,
                balanceData,
                relayKeyPair,
                "bridge-balances",
                normalizedUser
              );
              results.processed++; // Count corrections
            }
          } catch (e) {
            results.errors.push(`Balance correction failed for ${normalizedUser}`);
          }
        }
      }

      res.json({
        success: true,
        results,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error({ error }, "Error in sync-deposits endpoint");
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

/**
 * POST /api/v1/bridge/process-deposit
 *
 * Force process a specific deposit by transaction hash.
 * SECURITY: Restricted to relay operators only (admin auth required)
 */
router.post(
  "/process-deposit",
  adminAuthMiddleware,
  express.json({ limit: "10mb" }),
  async (req, res) => {
    try {
      const gun = req.app.get("gunInstance");
      if (!gun) {
        return res.status(503).json({
          success: false,
          error: "GunDB not initialized",
        });
      }

      if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({
          success: false,
          error: "Invalid request body",
        });
      }

      const { txHash } = req.body;

      if (!txHash || typeof txHash !== "string") {
        return res.status(400).json({
          success: false,
          error: "txHash is required",
        });
      }

      const client = getBridgeClient();
      const relayKeyPair = req.app.get("relayKeyPair");

      if (!relayKeyPair) {
        return res.status(500).json({
          success: false,
          error: "Relay keypair not configured",
        });
      }

      const provider = client.provider;
      const receipt = await provider.getTransactionReceipt(txHash);

      if (!receipt || receipt.status !== 1) {
        return res.status(400).json({ success: false, error: "Transaction failed or not found" });
      }

      const contractAddress = client.contractAddress.toLowerCase();
      const depositLog = receipt.logs.find((log) => log.address.toLowerCase() === contractAddress);

      if (!depositLog) {
        return res.status(400).json({ success: false, error: "Deposit event not found" });
      }

      const contract = client.contract;
      const parsedLog = contract.interface.parseLog({
        topics: depositLog.topics as string[],
        data: depositLog.data,
      });

      if (!parsedLog || parsedLog.name !== "Deposit") {
        return res.status(400).json({ success: false, error: "Invalid deposit event" });
      }

      const user = parsedLog.args[0] as string;
      const amount = parsedLog.args[1] as bigint;
      const normalizedUser = user.toLowerCase();
      const depositKey = `${txHash}:${normalizedUser}:${amount}`;

      const alreadyProcessed = await isDepositProcessed(gun, depositKey);

      if (alreadyProcessed) {
        return res.json({
          success: true,
          message: "Deposit already processed",
          deposit: {
            txHash,
            user: normalizedUser,
            amount: amount.toString(),
            amountEth: ethers.formatEther(amount),
          },
        });
      }

      await creditBalance(gun, normalizedUser, amount, relayKeyPair);

      await markDepositProcessed(gun, depositKey, {
        txHash,
        user: normalizedUser,
        amount: amount.toString(),
        blockNumber: receipt.blockNumber,
        timestamp: Date.now(),
      });

      const balance = await getUserBalance(gun, normalizedUser);

      res.json({
        success: true,
        deposit: {
          txHash,
          user: normalizedUser,
          amount: amount.toString(),
          amountEth: ethers.formatEther(amount),
          blockNumber: receipt.blockNumber,
        },
        balance: {
          wei: balance.toString(),
          eth: ethers.formatEther(balance),
        },
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error({ error, txHash: req.body.txHash }, "Error in process-deposit endpoint");
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

export default router;
