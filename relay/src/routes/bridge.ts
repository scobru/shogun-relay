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
 */

import express, { Request, Response } from "express";
import { loggers } from "../utils/logger";
import { createBridgeClient, type BridgeClient } from "../utils/bridge-client";
import {
  getUserBalance,
  creditBalance,
  debitBalance,
  transferBalance,
  addPendingWithdrawal,
  getPendingWithdrawals,
  removePendingWithdrawals,
  saveBatch,
  getLatestBatch,
  type PendingWithdrawal,
} from "../utils/bridge-state";
import {
  buildMerkleTreeFromWithdrawals,
  generateProof,
  type WithdrawalLeaf,
} from "../utils/merkle-tree";
import { ethers } from "ethers";

const router = express.Router();
const log = loggers.server || console;

// Bridge client (lazy initialization)
let bridgeClient: BridgeClient | null = null;

/**
 * Initialize bridge client from environment variables
 */
function getBridgeClient(): BridgeClient {
  if (bridgeClient) {
    return bridgeClient;
  }

  const rpcUrl = process.env.BRIDGE_RPC_URL || process.env.REGISTRY_RPC_URL;
  const chainId = parseInt(process.env.BRIDGE_CHAIN_ID || process.env.REGISTRY_CHAIN_ID || "84532");
  const privateKey = process.env.BRIDGE_SEQUENCER_PRIVATE_KEY || process.env.RELAY_PRIVATE_KEY;

  if (!rpcUrl) {
    throw new Error("Bridge not configured: BRIDGE_RPC_URL or REGISTRY_RPC_URL required");
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
router.post("/transfer", express.json(), async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({
        success: false,
        error: "GunDB not initialized",
      });
    }

    const { from, to, amount, message, seaSignature, ethSignature, gunPubKey } = req.body;

    if (!from || !to || !amount || !message || !seaSignature || !ethSignature || !gunPubKey) {
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
    } catch {
      return res.status(400).json({
        success: false,
        error: "Invalid address format",
      });
    }

    if (fromAddress.toLowerCase() === toAddress.toLowerCase()) {
      return res.status(400).json({
        success: false,
        error: "Cannot transfer to self",
      });
    }

    const amountBigInt = BigInt(amount);

    if (amountBigInt <= 0n) {
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

    log.info(
      {
        from: fromAddress,
        to: toAddress,
        amount: amountBigInt.toString(),
        txHash: result.txHash,
      },
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
router.post("/withdraw", express.json(), async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({
        success: false,
        error: "GunDB not initialized",
      });
    }

    const { user, amount, nonce, message, seaSignature, ethSignature, gunPubKey } = req.body;

    if (!user || !amount || nonce === undefined || !message || !seaSignature || !ethSignature || !gunPubKey) {
      return res.status(400).json({
        success: false,
        error: "user, amount, nonce, message, seaSignature, ethSignature, and gunPubKey required",
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

    const amountBigInt = BigInt(amount);
    const nonceBigInt = BigInt(nonce);

    if (amountBigInt <= 0n) {
      return res.status(400).json({
        success: false,
        error: "Amount must be positive",
      });
    }

    // SECURITY: Verify dual signatures before processing withdrawal
    const { verifyDualSignatures } = await import("../utils/bridge-state");
    const verifiedMessage = await verifyDualSignatures(
      message,
      seaSignature,
      ethSignature,
      userAddress,
      gunPubKey,
      {
        amount: amountBigInt.toString(),
        nonce: nonceBigInt.toString(),
        timestamp: Date.now(), // Will check message timestamp is recent
      }
    );

    if (!verifiedMessage) {
      return res.status(401).json({
        success: false,
        error: "Invalid signatures: must provide valid SEA and Ethereum signatures with correct message content",
      });
    }

    // Check balance
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
    const isProcessed = await client.isWithdrawalProcessed(
      userAddress,
      amountBigInt,
      nonceBigInt
    );

    if (isProcessed) {
      return res.status(400).json({
        success: false,
        error: "Withdrawal with this nonce has already been processed on-chain",
      });
    }

    // Get relay keypair for signing (if available)
    const relayKeyPair = req.app.get("relayKeyPair") || null;
    
    // Debit balance (requires relay keypair for security)
    await debitBalance(gun, userAddress, amountBigInt, relayKeyPair);

    // Add pending withdrawal
    const withdrawal: PendingWithdrawal = {
      user: userAddress,
      amount: amountBigInt.toString(),
      nonce: nonceBigInt.toString(),
      timestamp: Date.now(),
    };

    await addPendingWithdrawal(gun, withdrawal);

    log.info(
      { user: userAddress, amount: amountBigInt.toString(), nonce: nonceBigInt.toString() },
      "Withdrawal requested"
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
      return res.status(503).json({
        success: false,
        error: "GunDB not initialized",
      });
    }

    const client = getBridgeClient();

    // Verify wallet is configured (required for batch submission)
    if (!client.wallet) {
      return res.status(403).json({
        success: false,
        error: "Wallet required for batch submission",
      });
    }

    // Note: The contract's onlySequencerOrRelay modifier will enforce:
    // - If sequencer is set (non-zero), only sequencer can submit
    // - If sequencer is zero address, any registered active relay can submit
    // We don't need to duplicate this logic here - let the contract enforce it

    // Get pending withdrawals
    const pending = await getPendingWithdrawals(gun);

    if (pending.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No pending withdrawals to batch",
      });
    }

    // Convert to withdrawal leaves
    const withdrawals: WithdrawalLeaf[] = pending.map((w) => ({
      user: w.user,
      amount: BigInt(w.amount),
      nonce: BigInt(w.nonce),
    }));

    // Build Merkle tree
    const { root, getProof } = buildMerkleTreeFromWithdrawals(withdrawals);

    // Submit batch to contract
    const result = await client.submitBatch(root);

    // Get current batch ID (should match result.batchId)
    const batchId = await client.getCurrentBatchId();

    // Save batch to GunDB
    const batch = {
      batchId: batchId.toString(),
      root,
      withdrawals: pending,
      timestamp: Date.now(),
      blockNumber: result.blockNumber,
      txHash: result.txHash,
    };

    await saveBatch(gun, batch);

    // Remove processed withdrawals from pending queue
    await removePendingWithdrawals(gun, pending);

    log.info(
      { batchId: batchId.toString(), root, withdrawalCount: pending.length },
      "Batch submitted successfully"
    );

    res.json({
      success: true,
      batch: {
        batchId: batchId.toString(),
        root,
        withdrawalCount: pending.length,
        txHash: result.txHash,
        blockNumber: result.blockNumber,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error }, "Error in submit-batch endpoint");
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

    const balance = await getUserBalance(gun, userAddress);

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
 * GET /api/v1/bridge/proof/:user/:amount/:nonce
 * 
 * Generate Merkle proof for a withdrawal.
 * The withdrawal must be included in the latest batch.
 */
router.get("/proof/:user/:amount/:nonce", async (req, res) => {
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

    // Get latest batch
    const batch = await getLatestBatch(gun);

    if (!batch) {
      return res.status(404).json({
        success: false,
        error: "No batches found",
      });
    }

    // Check if withdrawal is in this batch
    const withdrawalInBatch = batch.withdrawals.find(
      (w) =>
        w.user.toLowerCase() === userAddress.toLowerCase() &&
        w.amount === amountBigInt.toString() &&
        w.nonce === nonceBigInt.toString()
    );

    if (!withdrawalInBatch) {
      return res.status(404).json({
        success: false,
        error: "Withdrawal not found in latest batch",
      });
    }

    // Generate proof
    const withdrawals: WithdrawalLeaf[] = batch.withdrawals.map((w) => ({
      user: w.user,
      amount: BigInt(w.amount),
      nonce: BigInt(w.nonce),
    }));

    const proof = generateProof(withdrawals, userAddress, amountBigInt, nonceBigInt);

    if (!proof) {
      return res.status(500).json({
        success: false,
        error: "Failed to generate proof",
      });
    }

    res.json({
      success: true,
      proof,
      batchId: batch.batchId,
      root: batch.root,
      withdrawal: {
        user: userAddress,
        amount: amountBigInt.toString(),
        nonce: nonceBigInt.toString(),
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error }, "Error generating proof");
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

export default router;

