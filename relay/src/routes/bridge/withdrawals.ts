import { Router } from "express";
import { ethers } from "ethers";
import { log, getBridgeClient, strictLimiter, getRelayHost, getSigningKeyPair } from "./utils";
import {
  getUserBalance,
  debitBalance,
  addPendingWithdrawal,
  getPendingWithdrawals,
  setLastNonce,
  getLastNonce,
  getLastNonceAsync,
  getBatch,
  validateNonceIncremental,
  verifyDualSignatures,
  PendingWithdrawal,
  Batch,
} from "../../utils/bridge-state";
import {
  isValidEthereumAddress,
  isValidAmount,
  validateString,
  isValidSignatureFormat,
} from "../../utils/security";
import * as Reputation from "../../utils/relay-reputation";
import { WithdrawalLeaf, generateProof } from "../../utils/merkle-tree";

const router: Router = Router();

/**
 * POST /api/v1/bridge/withdraw
 *
 * Request a withdrawal from L2.
 */
router.post("/withdraw", strictLimiter, async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({
        success: false,
        error: "GunDB not initialized",
      });
    }

    const { user, amount, nonce, message, seaSignature, ethSignature, gunPubKey } = req.body;

    if (!user || !amount || !message || !seaSignature || !ethSignature || !gunPubKey) {
      return res.status(400).json({
        success: false,
        error: "user, amount, message, seaSignature, ethSignature, and gunPubKey required",
      });
    }

    let userAddress: string;
    try {
      userAddress = ethers.getAddress(user);
    } catch {
      return res.status(400).json({
        success: false,
        error: "Invalid user address",
      });
    }

    if (!isValidEthereumAddress(user)) {
      return res.status(400).json({
        success: false,
        error: "Invalid user address format",
      });
    }

    const amountBigInt = BigInt(amount);
    const amountValidation = isValidAmount(amountBigInt);
    if (!amountValidation.valid) {
      return res.status(400).json({
        success: false,
        error: amountValidation.error || "Invalid amount",
      });
    }

    // Auto-generate nonce if not provided
    let nonceBigInt: bigint;
    if (nonce !== undefined && nonce !== null && nonce !== "") {
      nonceBigInt = BigInt(nonce);
      const nonceValidation = validateNonceIncremental(userAddress, nonceBigInt);
      if (!nonceValidation.valid) {
        return res.status(400).json({
          success: false,
          error: nonceValidation.error,
          lastNonce: nonceValidation.lastNonce?.toString(),
        });
      }
    } else {
      const lastNonce = getLastNonce(userAddress);
      nonceBigInt = lastNonce + 1n;
    }

    const messageValidation = validateString(message, "message", 10000, 1);
    if (!messageValidation.valid) {
      return res.status(400).json({
        success: false,
        error: messageValidation.error,
      });
    }

    if (!isValidSignatureFormat(seaSignature, "sea")) {
      return res.status(400).json({
        success: false,
        error: "Invalid SEA signature format",
      });
    }

    if (!isValidSignatureFormat(ethSignature, "eth")) {
      return res.status(400).json({
        success: false,
        error: "Invalid Ethereum signature format",
      });
    }

    const verifiedMessage = await verifyDualSignatures(
      message,
      seaSignature,
      ethSignature,
      userAddress,
      gunPubKey,
      {
        amount: amountBigInt.toString(),
        nonce: nonceBigInt.toString(),
        timestamp: Date.now(),
      }
    );

    if (!verifiedMessage) {
      return res.status(401).json({
        success: false,
        error:
          "Invalid signatures: must provide valid SEA and Ethereum signatures with correct message content",
      });
    }

    const relayKeyPair = req.app.get("relayKeyPair") || null;
    const balance = await getUserBalance(gun, userAddress);
    if (balance < amountBigInt) {
      return res.status(400).json({
        success: false,
        error: `Insufficient balance: ${balance.toString()} < ${amountBigInt.toString()}`,
      });
    }

    const client = getBridgeClient();
    const isProcessed = await client.isWithdrawalProcessed(userAddress, amountBigInt, nonceBigInt);

    if (isProcessed) {
      return res.status(400).json({
        success: false,
        error: "Withdrawal with this nonce has already been processed on-chain",
      });
    }

    const debitHash = await debitBalance(
      gun,
      userAddress,
      amountBigInt,
      relayKeyPair,
      nonceBigInt.toString()
    );

    setLastNonce(userAddress, nonceBigInt);

    const withdrawal: PendingWithdrawal = {
      user: userAddress,
      amount: amountBigInt.toString(),
      nonce: nonceBigInt.toString(),
      timestamp: Date.now(),
      debitHash,
    };

    try {
      await addPendingWithdrawal(gun, withdrawal);

      res.json({
        success: true,
        withdrawal: {
          user: userAddress,
          amount: amountBigInt.toString(),
          nonce: nonceBigInt.toString(),
          timestamp: withdrawal.timestamp,
        },
        message: "Withdrawal queued. Wait for batch submission to generate proof.",
      });
    } catch (addError) {
      const addErrorMessage = addError instanceof Error ? addError.message : String(addError);
      res.status(500).json({
        success: false,
        error: `Withdrawal balance debited but failed to queue: ${addErrorMessage}. Please contact support.`,
      });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error }, "Error in withdraw endpoint");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * GET /api/v1/bridge/pending-withdrawals
 *
 * Get all pending withdrawals (waiting for batch submission)
 */
router.get("/pending-withdrawals", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({
        success: false,
        error: "GunDB not initialized",
      });
    }

    const pending = await getPendingWithdrawals(gun);

    res.json({
      success: true,
      withdrawals: pending,
      count: pending.length,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error }, "Error getting pending withdrawals");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * GET /api/v1/bridge/nonce/:user
 *
 * Get the next nonce for a user (for withdrawal requests).
 */
router.get("/nonce/:user", async (req, res) => {
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

    // Use async version to read from GunDB if not in cache
    let lastNonce = await getLastNonceAsync(gun, userAddress);

    // Also check pending withdrawals to ensure we have the most recent nonce
    // This handles cases where the nonce hasn't been persisted yet
    try {
      const pendingWithdrawals = await getPendingWithdrawals(gun);
      const userPendingWithdrawals = pendingWithdrawals.filter(
        (w: PendingWithdrawal) => w.user.toLowerCase() === userAddress.toLowerCase()
      );

      if (userPendingWithdrawals.length > 0) {
        // Find the highest nonce among pending withdrawals
        const maxPendingNonce = userPendingWithdrawals.reduce(
          (max: bigint, w: PendingWithdrawal) => {
            const nonce = BigInt(w.nonce);
            return nonce > max ? nonce : max;
          },
          0n
        );

        // Use the higher of the two: persisted nonce or max pending nonce
        if (maxPendingNonce > lastNonce) {
          log.debug(
            {
              user: userAddress,
              persistedNonce: lastNonce.toString(),
              maxPendingNonce: maxPendingNonce.toString(),
            },
            "Found higher nonce in pending withdrawals"
          );
          lastNonce = maxPendingNonce;
        }
      }
    } catch (err) {
      log.warn(
        { user: userAddress, err },
        "Failed to check pending withdrawals for nonce calculation"
      );
    }

    const nextNonce = lastNonce + 1n;

    log.debug(
      {
        user: userAddress,
        lastNonce: lastNonce.toString(),
        nextNonce: nextNonce.toString(),
      },
      "Returning next nonce for user"
    );

    res.json({
      success: true,
      lastNonce: lastNonce.toString(),
      nextNonce: nextNonce.toString(),
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error }, "Error getting next nonce");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * GET /api/v1/bridge/proof/:user/:amount/:nonce
 *
 * Generate Merkle proof for a withdrawal.
 */
router.get("/proof/:user/:amount/:nonce", async (req, res) => {
  const startTime = Date.now();
  let proofGenerated = false;

  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({
        success: false,
        error: "GunDB not initialized",
      });
    }

    const { user, amount, nonce } = req.params;

    let userAddress: string;
    try {
      userAddress = ethers.getAddress(user);
    } catch {
      return res.status(400).json({
        success: false,
        error: "Invalid user address",
      });
    }

    const amountBigInt = BigInt(amount);
    const nonceBigInt = BigInt(nonce);

    const pendingWithdrawals = await getPendingWithdrawals(gun);
    const normalizedUserAddressForPending = userAddress.toLowerCase();
    const pendingWithdrawal = pendingWithdrawals.find((w: PendingWithdrawal) => {
      const wUser = (typeof w.user === "string" ? w.user : String(w.user || "")).toLowerCase();
      const wAmount = typeof w.amount === "string" ? w.amount : String(w.amount || "0");
      const wNonce = typeof w.nonce === "string" ? w.nonce : String(w.nonce || "0");
      return (
        wUser === normalizedUserAddressForPending &&
        wAmount === amountBigInt.toString() &&
        wNonce === nonceBigInt.toString()
      );
    });

    if (pendingWithdrawal) {
      return res.status(202).json({
        success: false,
        status: "pending",
        message:
          "Withdrawal is queued but not yet included in a batch. Please wait for the next batch submission.",
        withdrawal: {
          user: userAddress,
          amount: amountBigInt.toString(),
          nonce: nonceBigInt.toString(),
          timestamp: pendingWithdrawal.timestamp,
        },
        estimatedWaitTime: "Up to 5 minutes (batch interval)",
      });
    }

    // Collect all batch IDs
    const batchesPath = "bridge/batches";
    const batchIdsMap = new Map<string, string>();
    const collectedKeys = new Set<string>();

    const parentNode = gun.get(batchesPath);
    parentNode.map().on((batch: any, key: string) => {
      if (key && !key.startsWith("_") && batch?.batchId) {
        if (!collectedKeys.has(key)) {
          collectedKeys.add(key);
          batchIdsMap.set(key, batch.batchId);
        }
      }
    });

    // Also read directly
    parentNode.once((parentData: any) => {
      if (parentData && typeof parentData === "object") {
        Object.keys(parentData).forEach((key) => {
          if (key !== "_" && !key.startsWith("_")) {
            const batch = parentData[key];
            if (batch?.batchId && !collectedKeys.has(key)) {
              collectedKeys.add(key);
              batchIdsMap.set(key, batch.batchId);
            }
          }
        });
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Try contract batch ID
    try {
      const client = getBridgeClient();
      const currentBatchId = await client.getCurrentBatchId();
      if (currentBatchId > 0n) {
        const batchIdStr = currentBatchId.toString();
        if (!Array.from(batchIdsMap.values()).includes(batchIdStr)) {
          batchIdsMap.set(batchIdStr, batchIdStr);
        }
      }
    } catch (e) {}

    const batchIds = Array.from(batchIdsMap.values());
    if (batchIds.length === 0) {
      return res.status(404).json({ success: false, error: "No batches found" });
    }

    const batchPromises = batchIds.map((id) => getBatch(gun, id));
    const batches = await Promise.all(batchPromises);
    const validBatches = batches.filter((b: Batch | null): b is Batch => b !== null);

    const normalizedUserAddress = userAddress.toLowerCase();
    const normalizedAmount = amountBigInt.toString();
    const normalizedNonce = nonceBigInt.toString();

    let foundBatch: Batch | null = null;
    let foundWithdrawal: PendingWithdrawal | null = null;

    for (const batch of validBatches) {
      const withdrawal = batch.withdrawals.find((w: PendingWithdrawal) => {
        const withdrawalUser = (
          typeof w.user === "string" ? w.user : String(w.user || "")
        ).toLowerCase();
        const withdrawalAmount = typeof w.amount === "string" ? w.amount : String(w.amount || "0");
        const withdrawalNonce = typeof w.nonce === "string" ? w.nonce : String(w.nonce || "0");

        return (
          withdrawalUser === normalizedUserAddress &&
          withdrawalAmount === normalizedAmount &&
          withdrawalNonce === normalizedNonce
        );
      });

      if (withdrawal) {
        foundBatch = batch;
        foundWithdrawal = withdrawal;
        break;
      }
    }

    if (!foundBatch || !foundWithdrawal) {
      // Fallback check on-chain
      try {
        const client = getBridgeClient();
        const isProcessedOnChain = await client.isWithdrawalProcessed(
          userAddress,
          amountBigInt,
          nonceBigInt
        );

        if (isProcessedOnChain) {
          return res.status(200).json({
            success: true,
            status: "already_processed",
            message:
              "This withdrawal has already been processed on-chain. Check your wallet for the funds.",
            withdrawal: {
              user: userAddress,
              amount: amountBigInt.toString(),
              nonce: nonceBigInt.toString(),
            },
          });
        }
      } catch (e) {}

      return res.status(404).json({
        success: false,
        error:
          "Withdrawal not found in any submitted batch. It may still be pending batch submission.",
        suggestion:
          "Please wait for the next batch submission (every 5 minutes) or check your pending withdrawals.",
      });
    }

    const withdrawals: WithdrawalLeaf[] = foundBatch.withdrawals.map((w: PendingWithdrawal) => ({
      user: w.user,
      amount: BigInt(typeof w.amount === "string" ? w.amount : String(w.amount)),
      nonce: BigInt(typeof w.nonce === "string" ? w.nonce : String(w.nonce)),
    }));

    const proof = generateProof(withdrawals, userAddress, amountBigInt, nonceBigInt);

    if (!proof) {
      // Failure rep tracking
      try {
        const relayHost = getRelayHost(req);
        const keyPair = getSigningKeyPair();
        if (keyPair) {
          await Reputation.recordBridgeProofFailure(gun, relayHost, keyPair);
        }
      } catch (e) {}

      return res.status(500).json({ success: false, error: "Failed to generate proof" });
    }

    proofGenerated = true;
    const responseTime = Date.now() - startTime;

    // Success rep tracking
    try {
      const relayHost = getRelayHost(req);
      const keyPair = getSigningKeyPair();
      if (keyPair) {
        await Reputation.recordBridgeProofSuccess(gun, relayHost, responseTime, keyPair);
      }
    } catch (e) {}

    res.json({
      success: true,
      proof,
      batchId: foundBatch.batchId,
      root: foundBatch.root,
      withdrawal: {
        user: userAddress,
        amount: amountBigInt.toString(),
        nonce: nonceBigInt.toString(),
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error }, "Error generating proof");

    if (!proofGenerated) {
      try {
        const gun = req.app.get("gunInstance");
        if (gun) {
          const relayHost = getRelayHost(req);
          const keyPair = getSigningKeyPair();
          if (keyPair) await Reputation.recordBridgeProofFailure(gun, relayHost, keyPair);
        }
      } catch (e) {}
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

export default router;
