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
  getLatestBatch,
  isDepositProcessed,
  markDepositProcessed,
  type PendingWithdrawal,
} from "../utils/bridge-state";
import {
  buildMerkleTreeFromWithdrawals,
  generateProof,
  type WithdrawalLeaf,
} from "../utils/merkle-tree";
import * as FrozenData from "../utils/frozen-data";
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
    
    log.info(
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
        timestamp: Date.now(), // Will check message timestamp is recent
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
        error: "Invalid signatures: must provide valid SEA and Ethereum signatures with correct message content",
      });
    }
    
    log.info(
      {
        user: userAddress,
        amount: amountBigInt.toString(),
        nonce: nonceBigInt.toString(),
      },
      "Dual signatures verified successfully"
    );

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

    try {
      await addPendingWithdrawal(gun, withdrawal);
      
      log.info(
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
          nonce: nonceBigInt.toString() 
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

    log.info(
      { user: userAddress, normalizedUser: userAddress.toLowerCase() },
      "Getting user balance"
    );
    
    const balance = await getUserBalance(gun, userAddress);
    
    log.info(
      { 
        user: userAddress, 
        balance: balance.toString(), 
        balanceEth: ethers.formatEther(balance) 
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

    log.info(
      { user: userAddress, amount: amountBigInt.toString(), nonce: nonceBigInt.toString() },
      "Proof request received"
    );

    // Get latest batch
    const batch = await getLatestBatch(gun);

    if (!batch) {
      log.warn(
        { user: userAddress, amount: amountBigInt.toString(), nonce: nonceBigInt.toString() },
        "No batches found in GunDB"
      );
      return res.status(404).json({
        success: false,
        error: "No batches found",
      });
    }

    log.info(
      {
        batchId: batch.batchId,
        withdrawalCount: batch.withdrawals.length,
        requestedUser: userAddress,
        requestedAmount: amountBigInt.toString(),
        requestedNonce: nonceBigInt.toString(),
      },
      "Latest batch retrieved, checking for withdrawal"
    );

    // Check if withdrawal is in this batch
    const withdrawalInBatch = batch.withdrawals.find(
      (w) =>
        w.user.toLowerCase() === userAddress.toLowerCase() &&
        w.amount === amountBigInt.toString() &&
        w.nonce === nonceBigInt.toString()
    );

    if (!withdrawalInBatch) {
      log.warn(
        {
          batchId: batch.batchId,
          requestedUser: userAddress,
          requestedAmount: amountBigInt.toString(),
          requestedNonce: nonceBigInt.toString(),
          batchWithdrawals: batch.withdrawals.map(w => ({
            user: w.user,
            amount: w.amount,
            nonce: w.nonce,
          })),
        },
        "Withdrawal not found in latest batch"
      );
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

/**
 * POST /api/v1/bridge/sync-deposits
 * 
 * Retroactively sync missed deposits from a block range.
 * This is useful if the relay missed some deposits due to downtime or errors.
 * 
 * SECURITY: Should be restricted to relay operators only (add auth middleware if needed)
 * 
 * Body: { fromBlock?: number, toBlock?: number | "latest", user?: string }
 * - fromBlock: Block to start from (default: contract deployment block or 0)
 * - toBlock: Block to end at (default: "latest")
 * - user: Optional - only sync deposits for this specific user
 */
router.post("/sync-deposits", express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({
        success: false,
        error: "GunDB not initialized",
      });
    }

    // Validate request body
    if (!req.body || typeof req.body !== 'object') {
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
    const toBlockNumber = toBlock !== "latest" && toBlock !== undefined 
      ? Number(toBlock) 
      : "latest";

    log.info(
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
      log.error({ 
        error: errorMsg, 
        errorStack,
        fromBlock: fromBlockNumber, 
        toBlock: toBlockNumber,
        user 
      }, "Error querying deposits");
      throw error;
    }

    // All deposits are already filtered by user if user was specified
    const depositsToCheck = allDeposits;

    log.info(
      { total: allDeposits.length, toCheck: depositsToCheck.length, user },
      "Deposits found in range"
    );

    const results = {
      total: depositsToCheck.length,
      processed: 0,
      skipped: 0,
      failed: 0,
      errors: [] as string[],
    };

    // If user is specified, calculate expected total balance from all deposits
    // This allows us to verify and correct the balance if there were race conditions
    let expectedTotalBalance = 0n;
    let userDepositsMap = new Map<string, bigint>(); // user -> total deposits
    
    // Calculate expected balances for all users
    for (const deposit of depositsToCheck) {
      const normalizedUser = deposit.user.toLowerCase();
      const currentTotal = userDepositsMap.get(normalizedUser) || 0n;
      userDepositsMap.set(normalizedUser, currentTotal + deposit.amount);
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
            log.info(
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
          log.warn(
            { txHash: deposit.txHash },
            "Transaction receipt not found, skipping"
          );
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
          log.info(
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
            await new Promise(resolve => setTimeout(resolve, pollInterval));
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
        log.info(
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
        log.error(
          { error, txHash: deposit.txHash, user: deposit.user },
          "Error syncing deposit"
        );
        results.failed++;
        results.errors.push(`${deposit.txHash}: ${errorMsg}`);
      }
    }

    // Final verification and correction: Check if actual balances match expected totals
    // This fixes cases where race conditions caused incorrect balances
    if (userDepositsMap.size > 0) {
      log.info(
        { userCount: userDepositsMap.size },
        "Verifying and correcting balances for all users"
      );

      for (const [normalizedUser, expectedTotal] of userDepositsMap.entries()) {
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
              "Balance mismatch detected, correcting to expected total"
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
            await new Promise(resolve => setTimeout(resolve, 300));
            const correctedBalance = await getUserBalance(gun, normalizedUser);
            
            if (correctedBalance === expectedTotal) {
              log.info(
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
            log.info(
              {
                user: normalizedUser,
                balance: actualBalance.toString(),
              },
              "Balance verified correct"
            );
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          log.error(
            { error, user: normalizedUser },
            "Error verifying/correcting balance"
          );
          results.errors.push(`Balance verification failed for ${normalizedUser}: ${errorMsg}`);
        }
      }
    }

    log.info(results, "Retroactive deposit sync completed");

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
});

/**
 * POST /api/v1/bridge/process-deposit
 * 
 * Force process a specific deposit by transaction hash.
 * Useful for manually recovering a missed deposit.
 * 
 * SECURITY: Should be restricted to relay operators only (add auth middleware if needed)
 * 
 * Body: { txHash: string }
 */
router.post("/process-deposit", express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({
        success: false,
        error: "GunDB not initialized",
      });
    }

    // Validate request body
    if (!req.body || typeof req.body !== 'object') {
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

    log.info({ txHash }, "Processing specific deposit");

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
    const depositLog = receipt.logs.find(
      (log) => log.address.toLowerCase() === contractAddress
    );

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

    log.info(
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
});

export default router;

