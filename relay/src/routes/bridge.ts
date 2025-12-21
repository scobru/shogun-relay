/**
 * Bridge Routes - L2 Bridge API
 *
 * Endpoints:
 * - POST /api/v1/bridge/deposit - Deposit ETH to bridge (client-side, emits event)
 * - POST /api/v1/bridge/transfer - Transfer balance between users (L2 -> L2)
 * - POST /api/v1/bridge/withdraw - Request withdrawal from L2 (creates pending withdrawal)
 * - POST /api/v1/bridge/submit-batch - Submit batch with Merkle root (sequencer only)
 * - GET /api/v1/bridge/balance/:user - Get user L2 balance
 * - GET /api/v1/bridge/pending-withdrawals - Get pending withdrawals
 * - GET /api/v1/bridge/proof/:user/:amount/:nonce - Generate Merkle proof for withdrawal
 * - GET /api/v1/bridge/state - Get current bridge state (root, batchId, etc.)
 * - POST /api/v1/bridge/sync-deposits - Retroactively sync missed deposits (admin/relay only)
 * - POST /api/v1/bridge/process-deposit - Force process a specific deposit by txHash (admin/relay only)
 */

import express, { Request, Response } from "express";
import { loggers } from "../utils/logger";
import { createBridgeClient, type BridgeClient, type DepositEvent } from "../utils/bridge-client";
import {
  getUserBalance,
  creditBalance,
  debitBalance,
  transferBalance,
  addPendingWithdrawal,
  getPendingWithdrawals,
  removePendingWithdrawals,
  saveBatch,
  getBatch,
  getLatestBatch,
  isDepositProcessed,
  markDepositProcessed,
  verifyDualSignatures,
  reconcileUserBalance,
  validateNonceIncremental,
  setLastNonce,
  getLastNonce,
  listL2Transfers,
  getProcessedDepositsForUser,
  refreshTrustedRelaysCache,
  clearTrustedRelaysCache,
  type PendingWithdrawal,
  type Batch,
} from "../utils/bridge-state";
import {
  buildMerkleTreeFromWithdrawals,
  generateProof,
  type WithdrawalLeaf,
} from "../utils/merkle-tree";
import * as FrozenData from "../utils/frozen-data";
import { ethers } from "ethers";
import { submitBatch } from "../utils/batch-submitter";
import { adminAuthMiddleware } from "../middleware/admin-auth";
import rateLimit from "express-rate-limit";
import {
  isValidEthereumAddress,
  isValidAmount,
  validateString,
  isValidSignatureFormat,
  sanitizeForLog,
} from "../utils/security";
import * as Reputation from "../utils/relay-reputation";
import { getRelayKeyPair } from "../utils/relay-user";
import { relayConfig, bridgeConfig } from "../config/env-config";

const router = express.Router();
const log = loggers.server || console;

// Helper to get relay host identifier
function getRelayHost(req: Request): string {
  return relayConfig.endpoint || req.headers.host || "localhost";
}

// Helper to get signing keypair for reputation tracking
function getSigningKeyPair(): any {
  return getRelayKeyPair() || null;
}

// Rate limiting for bridge endpoints
const bridgeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute per IP
  message: {
    success: false,
    error: "Too many requests, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiting for withdrawal and transfer endpoints
const strictLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per IP
  message: {
    success: false,
    error: "Too many requests, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Bridge client (lazy initialization)
let bridgeClient: BridgeClient | null = null;

/**
 * Initialize bridge client from environment variables
 */
function getBridgeClient(): BridgeClient {
  if (bridgeClient) {
    return bridgeClient;
  }

  const rpcUrl = bridgeConfig.getRpcUrl();
  const chainId = bridgeConfig.getChainId();
  const privateKey = bridgeConfig.sequencerPrivateKey;

  if (!rpcUrl) {
    throw new Error("Bridge not configured: BRIDGE_RPC_URL or configure BRIDGE_NETWORKS with valid RPC");
  }

  bridgeClient = createBridgeClient({
    rpcUrl,
    chainId,
    privateKey,
  });

  return bridgeClient;
}


/**
 * POST /api/v1/bridge/deposit
 *
 * Note: This endpoint is informational. Actual deposits should be done
 * directly on-chain by calling the contract's deposit() function.
 * This endpoint can be used to verify deposits or get deposit instructions.
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
 * POST /api/v1/bridge/transfer
 *
 * Transfer balance from one user to another (L2 -> L2).
 * This is a pure L2 operation - no on-chain transaction needed.
 *
 * Flow:
 * 1. Check sender has sufficient balance
 * 2. Debit sender balance (frozen entry)
 * 3. Credit receiver balance (frozen entry)
 * 4. Create transfer record (frozen entry)
 * 5. Return transfer details
 */
router.post("/transfer", strictLimiter, express.json(), async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({
        success: false,
        error: "GunDB not initialized",
      });
    }

    const { from, to, amount, message, seaSignature, ethSignature, gunPubKey } = req.body;

    // DEBUG: Log received parameters to trace 400 errors
    log.debug(
      {
        hasFrom: !!from,
        hasTo: !!to,
        hasAmount: !!amount,
        hasMessage: !!message,
        hasSeaSignature: !!seaSignature,
        hasEthSignature: !!ethSignature,
        hasGunPubKey: !!gunPubKey,
        fromType: typeof from,
        toType: typeof to,
        amountType: typeof amount,
      },
      "Transfer request received - param check"
    );

    if (!from || !to || !amount || !message || !seaSignature || !ethSignature || !gunPubKey) {
      log.warn(
        {
          from: from || "MISSING",
          to: to || "MISSING",
          amount: amount || "MISSING",
          messageLength: message?.length || 0,
          seaSignatureLength: seaSignature?.length || 0,
          ethSignatureLength: ethSignature?.length || 0,
          gunPubKey: gunPubKey || "MISSING",
        },
        "Transfer failed - missing required parameters"
      );
      return res.status(400).json({
        success: false,
        error: "from, to, amount, message, seaSignature, ethSignature, and gunPubKey required",
      });
    }


    // Validate addresses
    let fromAddress: string;
    let toAddress: string;
    try {
      fromAddress = ethers.getAddress(from);
      toAddress = ethers.getAddress(to);
    } catch (addrError) {
      log.warn(
        { from, to, error: String(addrError) },
        "Transfer failed - invalid address format"
      );
      return res.status(400).json({
        success: false,
        error: "Invalid address format",
      });
    }

    if (fromAddress.toLowerCase() === toAddress.toLowerCase()) {
      log.warn(
        { from: fromAddress, to: toAddress },
        "Transfer failed - cannot transfer to self"
      );
      return res.status(400).json({
        success: false,
        error: "Cannot transfer to self",
      });
    }

    const amountBigInt = BigInt(amount);

    if (amountBigInt <= 0n) {
      log.warn(
        { amount: amount, amountBigInt: amountBigInt.toString() },
        "Transfer failed - amount must be positive"
      );
      return res.status(400).json({
        success: false,
        error: "Amount must be positive",
      });
    }


    // Get relay keypair for signing
    const relayKeyPair = req.app.get("relayKeyPair") || null;

    if (!relayKeyPair) {
      return res.status(503).json({
        success: false,
        error: "Relay keypair not available - transfers require relay signature",
      });
    }

    // Perform transfer (with dual signature verification: SEA + Ethereum)
    const result = await transferBalance(
      gun,
      fromAddress,
      toAddress,
      amountBigInt,
      relayKeyPair,
      message,
      seaSignature,
      ethSignature,
      gunPubKey
    );

    log.debug(
      sanitizeForLog({
        from: fromAddress,
        to: toAddress,
        amount: amountBigInt.toString(),
        txHash: result.txHash,
      }),
      "Balance transferred"
    );

    res.json({
      success: true,
      transfer: {
        from: fromAddress,
        to: toAddress,
        amount: amountBigInt.toString(),
        txHash: result.txHash,
        fromBalance: result.fromBalance,
        toBalance: result.toBalance,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error }, "Error in transfer endpoint");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * POST /api/v1/bridge/withdraw
 *
 * Request a withdrawal from L2. This:
 * 1. Checks user has sufficient balance
 * 2. Debits the balance
 * 3. Adds to pending withdrawals queue
 * 4. Returns withdrawal details (user needs to wait for batch submission to get proof)
 */
router.post("/withdraw", strictLimiter, express.json(), async (req, res) => {
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

    // Validate address
    let userAddress: string;
    try {
      userAddress = ethers.getAddress(user);
    } catch {
      return res.status(400).json({
        success: false,
        error: "Invalid user address",
      });
    }

    // Validate input
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
      // Validate nonce is incremental
      const nonceValidation = validateNonceIncremental(userAddress, nonceBigInt);
      if (!nonceValidation.valid) {
        return res.status(400).json({
          success: false,
          error: nonceValidation.error,
          lastNonce: nonceValidation.lastNonce?.toString(),
        });
      }
    } else {
      // Auto-generate: lastNonce + 1
      const lastNonce = getLastNonce(userAddress);
      nonceBigInt = lastNonce + 1n;
      log.debug(
        { user: userAddress, autoNonce: nonceBigInt.toString() },
        "Auto-generated nonce for withdrawal"
      );
    }

    // Validate message and signatures
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

    // SECURITY: Verify dual signatures before processing withdrawal

    log.debug(
      {
        user: userAddress,
        amount: amountBigInt.toString(),
        nonce: nonceBigInt.toString(),
        messageLength: message?.length,
        messagePreview: message?.substring(0, 200),
        hasSeaSignature: !!seaSignature,
        hasEthSignature: !!ethSignature,
        hasGunPubKey: !!gunPubKey,
      },
      "Verifying dual signatures for withdrawal"
    );

    const verifiedMessage = await verifyDualSignatures(
      message,
      seaSignature,
      ethSignature,
      userAddress,
      gunPubKey,
      {
        amount: amountBigInt.toString(),
        nonce: nonceBigInt.toString(),
        timestamp: Date.now(), // Will check message timestamp is recent (5 min window)
      }
    );

    if (!verifiedMessage) {
      log.warn(
        {
          user: userAddress,
          amount: amountBigInt.toString(),
          nonce: nonceBigInt.toString(),
        },
        "Dual signature verification failed for withdrawal"
      );
      return res.status(401).json({
        success: false,
        error:
          "Invalid signatures: must provide valid SEA and Ethereum signatures with correct message content",
      });
    }

    log.debug(
      {
        user: userAddress,
        amount: amountBigInt.toString(),
        nonce: nonceBigInt.toString(),
      },
      "Dual signatures verified successfully"
    );

    // Get relay keypair for signing and signature verification
    const relayKeyPair = req.app.get("relayKeyPair") || null;

    // Check balance from any trusted relay
    const balance = await getUserBalance(gun, userAddress);
    if (balance < amountBigInt) {
      return res.status(400).json({
        success: false,
        error: `Insufficient balance: ${balance.toString()} < ${amountBigInt.toString()}`,
      });
    }

    // SECURITY: Check if withdrawal with this nonce is already processed on-chain
    // This prevents users from losing balance if they try to reuse a nonce
    const client = getBridgeClient();
    const isProcessed = await client.isWithdrawalProcessed(userAddress, amountBigInt, nonceBigInt);

    if (isProcessed) {
      return res.status(400).json({
        success: false,
        error: "Withdrawal with this nonce has already been processed on-chain",
      });
    }

    // Debit balance (requires relay keypair for security)
    // Pass the nonce so the debit entry can be linked to this specific withdrawal
    const debitHash = await debitBalance(
      gun,
      userAddress,
      amountBigInt,
      relayKeyPair,
      nonceBigInt.toString()
    );

    // Update last nonce for this user (only after successful debit)
    setLastNonce(userAddress, nonceBigInt);

    // Add pending withdrawal with debitHash for verification during batch submission
    const withdrawal: PendingWithdrawal = {
      user: userAddress,
      amount: amountBigInt.toString(),
      nonce: nonceBigInt.toString(),
      timestamp: Date.now(),
      debitHash, // Include debit proof for batch verification
    };

    try {
      await addPendingWithdrawal(gun, withdrawal);

      log.debug(
        { user: userAddress, amount: amountBigInt.toString(), nonce: nonceBigInt.toString() },
        "Withdrawal requested successfully"
      );

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
      log.error(
        {
          error: addError,
          errorMessage: addErrorMessage,
          user: userAddress,
          amount: amountBigInt.toString(),
          nonce: nonceBigInt.toString(),
        },
        "Error adding pending withdrawal (balance already debited)"
      );
      // Balance was already debited, so this is a critical error
      // We should still return success to avoid double-debiting on retry
      // The withdrawal can be manually recovered from the balance history
      res.status(500).json({
        success: false,
        error: `Withdrawal balance debited but failed to queue: ${addErrorMessage}. Please contact support.`,
      });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    log.error(
      {
        error,
        errorMessage,
        errorStack,
        user: req.body?.user,
        amount: req.body?.amount,
        nonce: req.body?.nonce,
      },
      "Error in withdraw endpoint"
    );
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * POST /api/v1/bridge/submit-batch
 *
 * Sequencer endpoint: Submit a batch with Merkle root.
 * This:
 * 1. Gets all pending withdrawals
 * 2. Builds Merkle tree
 * 3. Submits root to contract
 * 4. Saves batch to GunDB
 * 5. Removes processed withdrawals from pending queue
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

    // Get relay keypair for withdrawal verification
    const relayKeyPair = req.app.get("relayKeyPair");
    const relayPub = relayKeyPair?.pub;

    const result = await submitBatch(gun, relayPub);

    if (result.success) {
      // Record batch submission success for reputation tracking
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
      // Record batch submission failure for reputation tracking (except for "no withdrawals" case)
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

    // Record batch submission failure for reputation tracking
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
              const wUser = (typeof w.user === "string" ? w.user : String(w.user || "")).toLowerCase();
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
      const withdrawals: WithdrawalLeaf[] = lastUserBatch.withdrawals.map((w: PendingWithdrawal) => ({
        user: w.user,
        amount: BigInt(typeof w.amount === "string" ? w.amount : String(w.amount)),
        nonce: BigInt(typeof w.nonce === "string" ? w.nonce : String(w.nonce)),
      }));

      const proof = generateProof(
        withdrawals,
        lastUserWithdrawal.user,
        BigInt(lastUserWithdrawal.amount),
        BigInt(lastUserWithdrawal.nonce)
      );

      // Check if batch is finalized on-chain
      let verifiedOnChain = false;
      try {
        const client = getBridgeClient();
        const batchInfo = await client.getBatchInfo(BigInt(lastUserBatch.batchId));
        verifiedOnChain = batchInfo.finalized;
      } catch {
        // Non-critical, just means we can't verify on-chain status
      }

      verification = {
        lastBatchId: lastUserBatch.batchId,
        lastBatchRoot: lastUserBatch.root,
        lastBatchTxHash: lastUserBatch.txHash || null,
        lastBatchTimestamp: lastUserBatch.timestamp,
        lastWithdrawal: {
          amount: lastUserWithdrawal.amount,
          nonce: lastUserWithdrawal.nonce,
          timestamp: lastUserWithdrawal.timestamp,
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
 * GET /api/v1/bridge/batch-history/:user
 *
 * Get batch history for a user - all batches where user has deposits or withdrawals.
 * This enables users to track their complete on-chain activity.
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

    // Find all batches with user withdrawals
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
        // Check on-chain status
        let finalized = false;
        try {
          const batchInfo = await client.getBatchInfo(BigInt(batchId));
          finalized = batchInfo.finalized;
        } catch {
          // Non-critical
        }

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

    // Get processed deposits
    const processedDeposits = await getProcessedDepositsForUser(gun, normalizedUser);

    // Sort by timestamp (newest first)
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
 * This allows clients to include the nonce in their signed message.
 */
router.get("/nonce/:user", async (req, res) => {
  try {
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

    const lastNonce = getLastNonce(userAddress);
    const nextNonce = lastNonce + 1n;

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
 * The withdrawal must be included in the latest batch.
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

    // Proof request received - only log errors, not every request

    // FIRST: Check if this withdrawal is still in the pending queue (not yet batched)
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
      // Withdrawal is pending batching - not yet included in a batch
      // Only log this as debug if there's an issue, not for every check
      // Return 202 Accepted to indicate the withdrawal is valid but pending
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

    // Collect all batch IDs from GunDB (similar to getLatestBatch but we'll search all)
    const batchesPath = "bridge/batches";
    const batchIdsMap = new Map<string, string>(); // key -> batchId
    const collectedKeys = new Set<string>();
    let lastUpdateTime = Date.now();

    const parentNode = gun.get(batchesPath);

    // Use map().on() to collect all batch IDs
    parentNode.map().on((batch: any, key: string) => {
      // Skip metadata keys
      if (key === "_" || key.startsWith("_") || !key) {
        return;
      }

      lastUpdateTime = Date.now();

      if (
        batch &&
        typeof batch === "object" &&
        typeof batch.batchId === "string" &&
        typeof batch.root === "string"
      ) {
        if (!collectedKeys.has(key)) {
          collectedKeys.add(key);
          batchIdsMap.set(key, batch.batchId);
          // Found batch ID in GunDB - too verbose when iterating over many batches
        }
      }
    });

    // Also try reading the parent node directly
    parentNode.once((parentData: any) => {
      if (parentData && typeof parentData === "object") {
        Object.keys(parentData).forEach((key) => {
          if (key === "_" || key.startsWith("_")) return;

          const batch = parentData[key];
          if (
            batch &&
            typeof batch === "object" &&
            typeof batch.batchId === "string" &&
            typeof batch.root === "string"
          ) {
            if (!collectedKeys.has(key)) {
              collectedKeys.add(key);
              batchIdsMap.set(key, batch.batchId);
              log.debug(
                {
                  key,
                  batchId: batch.batchId,
                  source: "direct-read",
                  totalFound: batchIdsMap.size,
                },
                "Found batch ID via direct read for proof search"
              );
            }
          }
        });
      }
    });

    // Wait a bit for batch IDs to be collected
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Also try getting batch from contract's current batch ID as fallback
    try {
      const client = getBridgeClient();
      const currentBatchId = await client.getCurrentBatchId();
      log.debug(
        { currentBatchId: currentBatchId.toString() },
        "Retrieved current batch ID from contract"
      );

      if (currentBatchId > 0n) {
        const batchIdStr = currentBatchId.toString();
        // Add to map if not already present
        if (!Array.from(batchIdsMap.values()).includes(batchIdStr)) {
          // Use batchId as both key and value for contract-fetched batch
          batchIdsMap.set(batchIdStr, batchIdStr);
          log.debug(
            { batchId: batchIdStr, source: "contract" },
            "Added batch ID from contract for proof search"
          );
        }
      }
    } catch (error) {
      log.warn(
        { error, user: userAddress },
        "Failed to get batch from contract's current batch ID (non-critical)"
      );
    }

    const batchIds = Array.from(batchIdsMap.values());
    log.debug({ batchIdsCount: batchIds.length, batchIds }, "Collected batch IDs for proof search");

    if (batchIds.length === 0) {
      log.warn(
        { user: userAddress, amount: amountBigInt.toString(), nonce: nonceBigInt.toString() },
        "No batches found in GunDB"
      );
      return res.status(404).json({
        success: false,
        error: "No batches found",
      });
    }

    // Fetch all batches and search for the withdrawal
    // Fetching all batches to search for withdrawal - only log if count is unusual

    const batchPromises = batchIds.map((id) => getBatch(gun, id));
    const batches = await Promise.all(batchPromises);
    const validBatches = batches.filter((b: Batch | null): b is Batch => b !== null);

    // Fetched batch data from GunDB - only log if issues occur

    if (validBatches.length === 0) {
      log.warn(
        { user: userAddress, amount: amountBigInt.toString(), nonce: nonceBigInt.toString() },
        "No valid batches found after fetching"
      );
      return res.status(404).json({
        success: false,
        error: "No valid batches found",
      });
    }

    // Search for the withdrawal in all batches
    // Normalize comparison: ensure we're comparing strings and lowercase addresses
    const normalizedUserAddress = userAddress.toLowerCase();
    const normalizedAmount = amountBigInt.toString();
    const normalizedNonce = nonceBigInt.toString();

    let foundBatch: Batch | null = null;
    let foundWithdrawal: PendingWithdrawal | null = null;

    for (const batch of validBatches) {
      // Searching batch for withdrawal - too verbose for production

      const withdrawal = batch.withdrawals.find((w: PendingWithdrawal) => {
        // Robust matching: handle both string and number types
        const withdrawalUser = (
          typeof w.user === "string" ? w.user : String(w.user || "")
        ).toLowerCase();
        const withdrawalAmount = typeof w.amount === "string" ? w.amount : String(w.amount || "0");
        const withdrawalNonce = typeof w.nonce === "string" ? w.nonce : String(w.nonce || "0");

        const userMatch = withdrawalUser === normalizedUserAddress;
        const amountMatch = withdrawalAmount === normalizedAmount;
        const nonceMatch = withdrawalNonce === normalizedNonce;

        if (userMatch && amountMatch && nonceMatch) {
          log.debug(
            {
              batchId: batch.batchId,
              requestedUser: normalizedUserAddress,
              requestedAmount: normalizedAmount,
              requestedNonce: normalizedNonce,
              withdrawalUser,
              withdrawalAmount,
              withdrawalNonce,
            },
            "Found matching withdrawal in batch"
          );
        }

        return userMatch && amountMatch && nonceMatch;
      });

      if (withdrawal) {
        foundBatch = batch;
        foundWithdrawal = withdrawal;
        break;
      }
    }

    if (!foundBatch || !foundWithdrawal) {
      log.warn(
        {
          requestedUser: normalizedUserAddress,
          requestedAmount: normalizedAmount,
          requestedNonce: normalizedNonce,
          searchedBatchesCount: validBatches.length,
          searchedBatches: validBatches.map((b: Batch) => ({
            batchId: b.batchId,
            withdrawalCount: b.withdrawals.length,
            withdrawals: b.withdrawals.map((w: PendingWithdrawal) => ({
              user: w.user?.toLowerCase(),
              amount: typeof w.amount === "string" ? w.amount : String(w.amount),
              nonce: typeof w.nonce === "string" ? w.nonce : String(w.nonce),
            })),
          })),
        },
        "Withdrawal not found in any batch"
      );

      // FALLBACK: Check if the withdrawal was already processed on-chain
      // This can happen if the relay was restarted and GunDB has stale data
      try {
        const client = getBridgeClient();
        const isProcessedOnChain = await client.isWithdrawalProcessed(
          userAddress,
          amountBigInt,
          nonceBigInt
        );

        if (isProcessedOnChain) {
          log.debug(
            { user: userAddress, amount: amountBigInt.toString(), nonce: nonceBigInt.toString() },
            "Withdrawal already processed on-chain (detected via fallback check)"
          );
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
      } catch (onChainError) {
        log.warn(
          { error: onChainError, user: userAddress },
          "Failed to check on-chain withdrawal status (non-critical)"
        );
      }

      return res.status(404).json({
        success: false,
        error:
          "Withdrawal not found in any submitted batch. It may still be pending batch submission.",
        suggestion:
          "Please wait for the next batch submission (every 5 minutes) or check your pending withdrawals.",
      });
    }

    // Generate proof
    const withdrawals: WithdrawalLeaf[] = foundBatch.withdrawals.map((w: PendingWithdrawal) => ({
      user: w.user,
      amount: BigInt(typeof w.amount === "string" ? w.amount : String(w.amount)),
      nonce: BigInt(typeof w.nonce === "string" ? w.nonce : String(w.nonce)),
    }));

    // Generating Merkle proof - only log errors

    const proof = generateProof(withdrawals, userAddress, amountBigInt, nonceBigInt);

    if (!proof) {
      log.error(
        {
          batchId: foundBatch.batchId,
          user: userAddress,
          amount: normalizedAmount,
          nonce: normalizedNonce,
        },
        "Failed to generate proof"
      );

      // Record proof failure for reputation tracking
      try {
        const relayHost = getRelayHost(req);
        const keyPair = getSigningKeyPair();
        if (keyPair) {
          await Reputation.recordBridgeProofFailure(gun, relayHost, keyPair);
        }
      } catch (e) {
        log.warn({ err: e }, "Failed to record bridge proof failure for reputation");
      }

      return res.status(500).json({
        success: false,
        error: "Failed to generate proof",
      });
    }

    proofGenerated = true;
    const responseTime = Date.now() - startTime;

    // Proof generated successfully - only log errors or for significant operations

    // Record proof success for reputation tracking
    try {
      const relayHost = getRelayHost(req);
      const keyPair = getSigningKeyPair();
      if (keyPair) {
        await Reputation.recordBridgeProofSuccess(gun, relayHost, responseTime, keyPair);
      }
    } catch (e) {
      log.warn({ err: e }, "Failed to record bridge proof success for reputation");
    }

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
    log.error(
      { error, user: req.params.user, amount: req.params.amount, nonce: req.params.nonce },
      "Error generating proof"
    );

    // Record proof failure for reputation tracking (if not already recorded)
    if (!proofGenerated) {
      try {
        const gun = req.app.get("gunInstance");
        if (gun) {
          const relayHost = getRelayHost(req);
          const keyPair = getSigningKeyPair();
          if (keyPair) {
            await Reputation.recordBridgeProofFailure(gun, relayHost, keyPair);
          }
        }
      } catch (e) {
        log.warn({ err: e }, "Failed to record bridge proof failure for reputation");
      }
    }

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
 * This is useful when:
 * - A new relay has been registered
 * - A relay has been removed/unstaked
 * - You want to ensure you have the latest relay list
 *
 * SECURITY: Public endpoint (no auth required) - cache refresh is safe
 *
 * Response includes the list of trusted relay public keys.
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
 * POST /api/v1/bridge/sync-deposits
 *
 * Retroactively sync missed deposits from a block range.
 * This is useful if the relay missed some deposits due to downtime or errors.
 *
 * SECURITY: Restricted to relay operators only (admin auth required)
 *
 * Body: { fromBlock?: number, toBlock?: number | "latest", user?: string }
 * - fromBlock: Block to start from (default: contract deployment block or 0)
 * - toBlock: Block to end at (default: "latest")
 * - user: Optional - only sync deposits for this specific user
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

      // Validate request body
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

      // Determine block range
      const fromBlockNumber = fromBlock !== undefined ? Number(fromBlock) : 0;
      const toBlockNumber =
        toBlock !== "latest" && toBlock !== undefined ? Number(toBlock) : "latest";

      log.debug(
        { fromBlock: fromBlockNumber, toBlock: toBlockNumber, user },
        "Starting retroactive deposit sync"
      );

      // Query deposits in the range (with optional user filter)
      let allDeposits: DepositEvent[];
      try {
        allDeposits = await client.queryDeposits(
          fromBlockNumber,
          toBlockNumber,
          user ? ethers.getAddress(user) : undefined
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        log.error(
          {
            error: errorMsg,
            errorStack,
            fromBlock: fromBlockNumber,
            toBlock: toBlockNumber,
            user,
          },
          "Error querying deposits"
        );
        throw error;
      }

      // All deposits are already filtered by user if user was specified
      const depositsToCheck = allDeposits;

      log.debug(
        { total: allDeposits.length, toCheck: depositsToCheck.length, user },
        "Deposits found in range"
      );

      // Query L1 withdrawals to calculate correct net balance
      let allWithdrawals: { user: string; amount: bigint; nonce: bigint }[] = [];
      try {
        // Get unique users from deposits to query their withdrawals
        const usersToCheck = user
          ? [user.toLowerCase()]
          : [...new Set(depositsToCheck.map((d) => d.user.toLowerCase()))];

        for (const userAddr of usersToCheck) {
          const userWithdrawals = await client.queryWithdrawals(
            fromBlockNumber,
            toBlockNumber,
            userAddr
          );
          allWithdrawals.push(
            ...userWithdrawals.map((w) => ({
              user: w.user.toLowerCase(),
              amount: w.amount,
              nonce: w.nonce,
            }))
          );
        }

        log.debug(
          { withdrawals: allWithdrawals.length },
          "L1 withdrawals found for balance calculation"
        );
      } catch (error) {
        log.warn(
          { error },
          "Failed to query L1 withdrawals - will calculate balance from deposits only"
        );
      }

      const results = {
        total: depositsToCheck.length,
        processed: 0,
        skipped: 0,
        failed: 0,
        withdrawals: allWithdrawals.length,
        errors: [] as string[],
      };

      // Calculate expected balances for all users: deposits - withdrawals
      // Note: L2 transfers are handled atomically and don't need recalculation
      let userDepositsMap = new Map<string, bigint>(); // user -> total deposits
      let userWithdrawalsMap = new Map<string, bigint>(); // user -> total withdrawals

      // Sum deposits by user
      for (const deposit of depositsToCheck) {
        const normalizedUser = deposit.user.toLowerCase();
        const currentTotal = userDepositsMap.get(normalizedUser) || 0n;
        userDepositsMap.set(normalizedUser, currentTotal + deposit.amount);
      }

      // Sum withdrawals by user
      for (const withdrawal of allWithdrawals) {
        const normalizedUser = withdrawal.user.toLowerCase();
        const currentTotal = userWithdrawalsMap.get(normalizedUser) || 0n;
        userWithdrawalsMap.set(normalizedUser, currentTotal + withdrawal.amount);
      }

      // Calculate net expected balance (deposits - withdrawals) for each user
      let userExpectedBalanceMap = new Map<string, bigint>();
      for (const [user, deposits] of userDepositsMap.entries()) {
        const withdrawals = userWithdrawalsMap.get(user) || 0n;
        const netBalance = deposits - withdrawals;
        userExpectedBalanceMap.set(user, netBalance > 0n ? netBalance : 0n);

        log.debug(
          {
            user,
            deposits: deposits.toString(),
            withdrawals: withdrawals.toString(),
            netBalance: netBalance.toString(),
          },
          "Calculated expected net balance for user"
        );
      }

      // Process each deposit
      for (const deposit of depositsToCheck) {
        try {
          const normalizedUser = deposit.user.toLowerCase();
          const depositKey = `${deposit.txHash}:${normalizedUser}:${deposit.amount}`;

          // Check if already processed
          let alreadyProcessed = await isDepositProcessed(gun, depositKey);

          // If marked as processed, verify the balance was actually credited
          if (alreadyProcessed) {
            const currentL2Balance = await getUserBalance(gun, normalizedUser);

            // If balance is 0, the deposit was marked as processed but not actually credited
            // This can happen if creditBalance failed silently or was interrupted
            if (currentL2Balance === 0n) {
              log.warn(
                {
                  txHash: deposit.txHash,
                  user: normalizedUser,
                  amount: deposit.amount.toString(),
                  depositKey,
                  currentL2Balance: currentL2Balance.toString(),
                },
                "Deposit marked as processed but L2 balance is 0. Reprocessing to ensure funds are credited."
              );
              alreadyProcessed = false; // Force reprocessing
            } else {
              log.debug(
                { txHash: deposit.txHash, user: normalizedUser },
                "Deposit already processed, skipping"
              );
              results.skipped++;
              continue;
            }
          }

          // Verify transaction receipt
          const provider = client.provider;
          const receipt = await provider.getTransactionReceipt(deposit.txHash);

          if (!receipt) {
            log.warn({ txHash: deposit.txHash }, "Transaction receipt not found, skipping");
            results.skipped++;
            continue;
          }

          if (receipt.status !== 1) {
            log.warn(
              { txHash: deposit.txHash, status: receipt.status },
              "Transaction failed, skipping"
            );
            results.skipped++;
            continue;
          }

          // Credit balance
          await creditBalance(gun, normalizedUser, deposit.amount, relayKeyPair);

          // Poll to verify balance was actually written
          let balanceVerified = false;
          let attempts = 0;
          const maxAttempts = 10; // 10 attempts * 500ms = 5 seconds
          const pollInterval = 500;

          while (!balanceVerified && attempts < maxAttempts) {
            const verifyBalance = await getUserBalance(gun, normalizedUser);
            log.debug(
              {
                user: normalizedUser,
                expectedAmount: ethers.formatEther(deposit.amount),
                currentL2Balance: ethers.formatEther(verifyBalance),
                txHash: deposit.txHash,
                attempt: attempts + 1,
              },
              "Polling for L2 balance update after credit (sync)"
            );

            // Check if the balance is at least the deposited amount (or more if previous deposits exist)
            if (verifyBalance >= deposit.amount) {
              balanceVerified = true;
            } else {
              await new Promise((resolve) => setTimeout(resolve, pollInterval));
              attempts++;
            }
          }

          if (!balanceVerified) {
            log.error(
              {
                user: normalizedUser,
                amount: deposit.amount.toString(),
                txHash: deposit.txHash,
                currentL2Balance: ethers.formatEther(await getUserBalance(gun, normalizedUser)),
              },
              "Failed to verify L2 balance update after credit within timeout during sync. Deposit will be retried."
            );
            // DO NOT mark as processed, so it can be retried
            results.failed++;
            results.errors.push(`${deposit.txHash}: Balance verification failed`);
            continue;
          }

          // Mark as processed only after balance is verified
          await markDepositProcessed(gun, depositKey, {
            txHash: deposit.txHash,
            user: normalizedUser,
            amount: deposit.amount.toString(),
            blockNumber: deposit.blockNumber,
            timestamp: Date.now(),
          });

          const finalVerifyBalance = await getUserBalance(gun, normalizedUser);
          log.debug(
            {
              txHash: deposit.txHash,
              user: normalizedUser,
              amount: ethers.formatEther(deposit.amount),
              newBalance: ethers.formatEther(finalVerifyBalance),
            },
            "Deposit synced successfully and balance verified"
          );

          results.processed++;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          log.error({ error, txHash: deposit.txHash, user: deposit.user }, "Error syncing deposit");
          results.failed++;
          results.errors.push(`${deposit.txHash}: ${errorMsg}`);
        }
      }

      // Final verification and correction: Check if actual balances match expected totals
      // Expected = deposits - withdrawals (L2 transfers are already reflected in balance)
      if (userExpectedBalanceMap.size > 0) {
        log.debug(
          { userCount: userExpectedBalanceMap.size },
          "Verifying and correcting balances for all users (deposits - withdrawals)"
        );

        for (const [normalizedUser, expectedTotal] of userExpectedBalanceMap.entries()) {
          try {
            const actualBalance = await getUserBalance(gun, normalizedUser);

            if (actualBalance !== expectedTotal) {
              log.warn(
                {
                  user: normalizedUser,
                  expectedBalance: expectedTotal.toString(),
                  actualBalance: actualBalance.toString(),
                  difference: (expectedTotal - actualBalance).toString(),
                },
                "Balance mismatch detected, correcting to expected net balance (deposits - withdrawals)"
              );

              // Create a new frozen entry with the correct balance
              // This overwrites any incorrect entries due to race conditions
              const balanceData: any = {
                balance: expectedTotal.toString(),
                ethereumAddress: normalizedUser,
                updatedAt: Date.now(),
                type: "bridge-balance",
                corrected: true, // Flag to indicate this was a correction
              };

              await FrozenData.createFrozenEntry(
                gun,
                balanceData,
                relayKeyPair,
                "bridge-balances",
                normalizedUser
              );

              // Verify the correction
              await new Promise((resolve) => setTimeout(resolve, 300));
              const correctedBalance = await getUserBalance(gun, normalizedUser);

              if (correctedBalance === expectedTotal) {
                log.debug(
                  {
                    user: normalizedUser,
                    correctedBalance: correctedBalance.toString(),
                  },
                  "Balance corrected successfully"
                );
                results.processed++; // Count corrections as processed
              } else {
                log.error(
                  {
                    user: normalizedUser,
                    expectedBalance: expectedTotal.toString(),
                    correctedBalance: correctedBalance.toString(),
                  },
                  "Failed to correct balance"
                );
                results.failed++;
                results.errors.push(`Balance correction failed for ${normalizedUser}`);
              }
            } else {
              log.debug(
                {
                  user: normalizedUser,
                  balance: actualBalance.toString(),
                },
                "Balance verified correct"
              );
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            log.error({ error, user: normalizedUser }, "Error verifying/correcting balance");
            results.errors.push(`Balance verification failed for ${normalizedUser}: ${errorMsg}`);
          }
        }
      }

      log.debug(results, "Retroactive deposit sync completed");

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
 * POST /api/v1/bridge/reconcile-balance
 *
 * Reconcile a user's L2 balance by recalculating from deposits, withdrawals, and L2 transfers.
 * This fixes balance discrepancies caused by old transfer implementations that didn't properly update balances.
 *
 * Body: { user: string }
 */
router.post("/reconcile-balance", express.json(), async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({
        success: false,
        error: "GunDB not initialized",
      });
    }

    const { user } = req.body;

    if (!user) {
      return res.status(400).json({
        success: false,
        error: "user address required",
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

    // Get relay keypair (required for signing corrected balances)
    const relayKeyPair = req.app.get("relayKeyPair");
    if (!relayKeyPair) {
      return res.status(503).json({
        success: false,
        error: "Relay keypair not configured",
      });
    }

    // Get bridge client for querying on-chain data
    const client = getBridgeClient();

    log.debug({ user: userAddress }, "Starting balance reconciliation");

    const { reconcileUserBalance } = await import("../utils/bridge-state");
    const result = await reconcileUserBalance(gun, userAddress, relayKeyPair, client);

    if (result.success) {
      res.json({
        success: true,
        user: userAddress,
        currentBalance: result.currentBalance,
        calculatedBalance: result.calculatedBalance,
        corrected: result.corrected,
        message: result.corrected
          ? `Balance corrected from ${result.currentBalance} to ${result.calculatedBalance}`
          : "Balance is already correct",
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || "Reconciliation failed",
      });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error: errorMessage }, "Error in reconcile-balance endpoint");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

/**
 * POST /api/v1/bridge/process-deposit
 *
 * Force process a specific deposit by transaction hash.
 * Useful for manually recovering a missed deposit.
 *
 * SECURITY: Restricted to relay operators only (admin auth required)
 *
 * Body: { txHash: string }
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

      // Validate request body
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

      log.debug({ txHash }, "Processing specific deposit");

      // Get transaction receipt
      const provider = client.provider;
      const receipt = await provider.getTransactionReceipt(txHash);

      if (!receipt) {
        return res.status(404).json({
          success: false,
          error: "Transaction not found",
        });
      }

      if (receipt.status !== 1) {
        return res.status(400).json({
          success: false,
          error: "Transaction failed",
        });
      }

      // Find Deposit event in the receipt
      const contractAddress = client.contractAddress.toLowerCase();
      const depositLog = receipt.logs.find((log) => log.address.toLowerCase() === contractAddress);

      if (!depositLog) {
        return res.status(400).json({
          success: false,
          error: "Deposit event not found in transaction",
        });
      }

      // Parse event
      const contract = client.contract;
      const parsedLog = contract.interface.parseLog({
        topics: depositLog.topics as string[],
        data: depositLog.data,
      });

      if (!parsedLog || parsedLog.name !== "Deposit") {
        return res.status(400).json({
          success: false,
          error: "Invalid deposit event",
        });
      }

      const user = parsedLog.args[0] as string;
      const amount = parsedLog.args[1] as bigint;
      const normalizedUser = user.toLowerCase();
      const depositKey = `${txHash}:${normalizedUser}:${amount}`;

      // Check if already processed
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

      // Credit balance
      await creditBalance(gun, normalizedUser, amount, relayKeyPair);

      // Mark as processed
      await markDepositProcessed(gun, depositKey, {
        txHash,
        user: normalizedUser,
        amount: amount.toString(),
        blockNumber: receipt.blockNumber,
        timestamp: Date.now(),
      });

      // Verify balance
      const balance = await getUserBalance(gun, normalizedUser);

      log.debug(
        {
          txHash,
          user: normalizedUser,
          amount: ethers.formatEther(amount),
          balance: ethers.formatEther(balance),
        },
        "Deposit processed successfully"
      );

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

/**
 * GET /api/v1/bridge/transactions/:user
 *
 * Get all transactions (deposits, withdrawals, transfers) for a user.
 * Returns a unified list of all transaction types sorted by timestamp.
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

    log.debug({ user: normalizedUser }, "Fetching transaction history");

    // Fetch all transaction types in parallel
    const [onChainDeposits, onChainWithdrawals, l2Transfers, processedDeposits] = await Promise.all(
      [
        // On-chain deposits (from contract events)
        client.queryDeposits(0, "latest", normalizedUser).catch((err) => {
          log.warn({ error: err }, "Failed to query on-chain deposits");
          return [];
        }),
        // On-chain withdrawals (from contract events)
        client.queryWithdrawals(0, "latest", normalizedUser).catch((err) => {
          log.warn({ error: err }, "Failed to query on-chain withdrawals");
          return [];
        }),
        // L2 transfers (from GunDB frozen entries)
        listL2Transfers(gun, relayKeyPair?.pub || "").catch((err) => {
          log.warn({ error: err }, "Failed to query L2 transfers");
          return [];
        }),
        // Processed deposits (from GunDB)
        getProcessedDepositsForUser(gun, normalizedUser).catch((err) => {
          log.warn({ error: err }, "Failed to query processed deposits");
          return [];
        }),
      ]
    );

    // Build unified transaction list
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

    // Add deposits
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

    // Add withdrawals
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

    // Add L2 transfers (filter by user)
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

    // Also check pending withdrawals
    const pendingWithdrawals = await getPendingWithdrawals(gun).catch(() => []);
    for (const withdrawal of pendingWithdrawals) {
      const wUser = (
        typeof withdrawal.user === "string" ? withdrawal.user : String(withdrawal.user || "")
      ).toLowerCase();
      if (wUser === normalizedUser) {
        // Check if already in transactions (from on-chain)
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

    // Sort by timestamp (newest first)
    transactions.sort((a, b) => b.timestamp - a.timestamp);

    log.debug(
      { user: normalizedUser, count: transactions.length },
      "Transaction history retrieved"
    );

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
 * Searches across deposits, withdrawals, and transfers.
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

    log.debug({ txHash }, "Fetching transaction details");

    // Try to find in different sources
    let transaction: any = null;
    let source: "deposit" | "withdrawal" | "transfer" | null = null;

    // 1. Check on-chain deposits
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
    } catch (err) {
      log.warn({ error: err }, "Error querying deposits");
    }

    // 2. Check on-chain withdrawals
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
      } catch (err) {
        log.warn({ error: err }, "Error querying withdrawals");
      }
    }

    // 3. Check L2 transfers
    if (!transaction) {
      try {
        // First, try to read directly from frozen entries using the hash as content hash
        // This handles both transferHash (index key) and latestHash (content hash) cases
        let transfer: {
          from: string;
          to: string;
          amount: string;
          transferHash: string;
          timestamp: number;
        } | null = null;

        log.debug({ txHash: txHash.trim() }, "Searching for L2 transfer");

        try {
          const FrozenData = await import("../utils/frozen-data");
          const entry = await FrozenData.readFrozenEntry(
            gun,
            "bridge-transfers",
            txHash.trim(),
            relayKeyPair?.pub || ""
          );

          log.debug(
            {
              txHash: txHash.trim(),
              hasEntry: !!entry,
              verified: entry?.verified,
              hasData: !!entry?.data
            },
            "Direct frozen entry lookup result"
          );

          if (entry && entry.verified && entry.data) {
            const transferData = entry.data as {
              from?: string;
              to?: string;
              amount?: string;
              transferHash?: string;
              timestamp?: number;
              type?: string;
            };

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
        } catch (err) {
          log.debug(
            { error: err, hash: txHash },
            "Error reading frozen entry directly, trying list lookup"
          );
        }

        // If direct read didn't work, try searching in the transfer list
        // This handles cases where the hash is the index key (transferHash)
        if (!transfer) {
          const transfers = await listL2Transfers(gun, relayKeyPair?.pub || "");

          log.debug(
            {
              txHash: txHash.trim(),
              transferCount: transfers.length,
              transferHashes: transfers.slice(0, 5).map(t => t.transferHash.substring(0, 20) + '...')
            },
            "L2 transfers list lookup"
          );


          // Try exact match first (case-sensitive for base64)
          transfer = transfers.find((t) => t.transferHash === txHash.trim()) || null;

          // If not found, try case-insensitive match (handles hex hashes)
          if (!transfer) {
            transfer =
              transfers.find((t) => t.transferHash.toLowerCase() === txHash.toLowerCase().trim()) ||
              null;
          }

          // Also check if the hash matches any latestHash by searching the index
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
                  // Compare both as-is and lowercased (base64 might not have case, but we check both)
                  if (
                    indexEntry.latestHash === txHash.trim() ||
                    indexEntry.latestHash.toLowerCase() === normalizedTxHash
                  ) {
                    transfer = t;
                    break;
                  }
                }
              } catch (err) {
                // Continue to next transfer
              }
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
      } catch (err) {
        log.warn({ error: err }, "Error querying transfers");
      }
    }

    // 4. Check pending withdrawals (by checking all batches)
    if (!transaction) {
      try {
        const pendingWithdrawals = await getPendingWithdrawals(gun);
        // Note: pending withdrawals don't have txHash yet, so we can't match by hash
        // But we can check if this might be a batch submission tx
        const batches = await Promise.all([getLatestBatch(gun).catch(() => null)]);

        // Check if txHash matches a batch submission
        // This would require checking the contract for batch submission events
        // For now, we'll skip this as it's more complex
      } catch (err) {
        log.warn({ error: err }, "Error checking pending withdrawals");
      }
    }

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: "Transaction not found",
      });
    }

    log.debug({ txHash, type: transaction.type }, "Transaction found");

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
