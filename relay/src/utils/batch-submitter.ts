import { createBridgeClient, type BridgeClient } from "./bridge-client";
import { loggers } from "./logger";
import {
  getPendingWithdrawals,
  saveBatch,
  removePendingWithdrawals,
  getBatch,
  verifyWithdrawalDebit,
  type PendingWithdrawal,
  type ForceWithdrawal,
  type Batch,
  getPendingForceWithdrawals,
  removePendingForceWithdrawals,
} from "./bridge-state";
import { buildMerkleTreeFromWithdrawals, type WithdrawalLeaf } from "./merkle-tree";
import type { IGunInstance } from "gun";
import { bridgeConfig } from "../config/env-config";

const log = loggers.bridge || console;

// Singleton client instance
let bridgeClient: BridgeClient | null = null;

function getBridgeClient(): BridgeClient {
  if (bridgeClient) {
    return bridgeClient;
  }

  const rpcUrl = bridgeConfig.getRpcUrl();
  const chainId = bridgeConfig.getChainId();
  const privateKey = bridgeConfig.sequencerPrivateKey;

  if (!rpcUrl) {
    throw new Error(
      "Bridge not configured: BRIDGE_RPC_URL or configure BRIDGE_NETWORKS with valid RPC"
    );
  }

  bridgeClient = createBridgeClient({
    rpcUrl,
    chainId,
    privateKey,
  });

  return bridgeClient;
}

export interface BatchSubmissionResult {
  success: boolean;
  batchId?: string;
  root?: string;
  withdrawalCount: number;
  verifiedCount?: number;
  excludedCount?: number;
  txHash?: string;
  blockNumber?: number;
  error?: string;
  errorCode?: any;
  errorReason?: any;
}

/**
 * Submit a batch of pending withdrawals to L1.
 *
 * This function:
 * 1. Gets all pending withdrawals from GunDB
 * 2. SECURITY: Verifies each withdrawal has a valid debit entry signed by relay
 * 3. Builds a Merkle tree (only from verified withdrawals)
 * 4. Submits the root to the L1 contract
 * 5. Saves the batch metadata to GunDB
 * 6. Removes processed withdrawals from the pending queue
 */
export async function submitBatch(
  gun: IGunInstance,
  relayPub?: string
): Promise<BatchSubmissionResult> {
  let pending: PendingWithdrawal[] = [];
  let verifiedWithdrawals: PendingWithdrawal[] = [];

  try {
    const client = getBridgeClient();

    // Verify wallet is configured (required for batch submission)
    if (!client.wallet) {
      log.error({}, "Wallet not configured in submitBatch");
      return {
        success: false,
        withdrawalCount: 0,
        error: "Wallet required for batch submission",
      };
    }

    log.debug({ walletAddress: client.wallet.address }, "Starting batch submission");

    // Get pending withdrawals
    log.debug({}, "Fetching pending withdrawals");
    pending = await getPendingWithdrawals(gun);
    log.debug({ pendingCount: pending.length }, "Retrieved pending withdrawals");

    // Get pending force withdrawals
    const pendingForceWithdrawals = await getPendingForceWithdrawals(gun);
    log.debug(
      { forceCount: pendingForceWithdrawals.length },
      "Retrieved pending force withdrawals"
    );

    if (pending.length === 0 && pendingForceWithdrawals.length === 0) {
      log.debug({}, "No pending withdrawals to batch");
      return {
        success: false,
        withdrawalCount: 0,
        error: "No pending withdrawals to batch",
      };
    }

    // SECURITY: Verify each withdrawal before including in batch
    // Only withdrawals with valid debit entries signed by the relay are included
    if (relayPub) {
      log.debug(
        { relayPub: relayPub.substring(0, 16) },
        "Verifying withdrawals with trusted relays from registry"
      );

      // Get chainId from env if available
      const chainId = process.env.REGISTRY_CHAIN_ID
        ? parseInt(process.env.REGISTRY_CHAIN_ID)
        : undefined;

      for (const withdrawal of pending) {
        // Pass undefined for relayPub to use trusted relays from registry
        const verification = await verifyWithdrawalDebit(gun, withdrawal, undefined, chainId);

        if (verification.valid) {
          verifiedWithdrawals.push(withdrawal);
        } else {
          // SECURITY WARNING: This withdrawal is suspicious
          log.warn(
            {
              user: withdrawal.user,
              amount: withdrawal.amount,
              nonce: withdrawal.nonce,
              debitHash: withdrawal.debitHash,
              reason: verification.reason,
            },
            "SECURITY WARNING: Excluding unverified withdrawal from batch"
          );
        }
      }

      log.debug(
        {
          totalPending: pending.length,
          verified: verifiedWithdrawals.length,
          excluded: pending.length - verifiedWithdrawals.length,
        },
        "Withdrawal verification complete"
      );

      if (verifiedWithdrawals.length === 0 && pendingForceWithdrawals.length === 0) {
        log.warn({}, "No verified withdrawals or force withdrawals to batch");
        return {
          success: false,
          withdrawalCount: pending.length,
          verifiedCount: 0,
          excludedCount: pending.length,
          error: "No verified withdrawals to batch - all withdrawals failed security checks",
        };
      }
    } else {
      // No relayPub provided - skip verification (backward compatibility)
      log.warn({}, "No relayPub provided - skipping withdrawal verification (less secure)");
      verifiedWithdrawals = pending;
    }

    // Convert to withdrawal leaves (only verified withdrawals)
    const withdrawals: WithdrawalLeaf[] = verifiedWithdrawals.map((w) => ({
      user: w.user,
      amount: BigInt(w.amount),
      nonce: BigInt(w.nonce),
    }));

    // Build Merkle tree
    const { root } = buildMerkleTreeFromWithdrawals(withdrawals);

    // Submit batch to contract

    const forceWithdrawalHashes = pendingForceWithdrawals.map((w) => w.withdrawalHash);

    const result = await client.submitBatch(root, forceWithdrawalHashes);
    log.info(
      {
        txHash: result.txHash,
        blockNumber: result.blockNumber,
        batchId: result.batchId.toString(),
        withdrawalCount: withdrawals.length,
      },
      "Batch submitted to L1"
    );

    // Get current batch ID (should match result.batchId)
    // Use the batch ID from the transaction event to ensure we match the specific batch submitted
    const batchId = result.batchId.toString();

    // Save batch to GunDB (only verified withdrawals)
    const batch: Batch = {
      batchId: batchId.toString(),
      root,
      withdrawals: verifiedWithdrawals,
      forceWithdrawals: pendingForceWithdrawals,
      timestamp: Date.now(),
      blockNumber: result.blockNumber,
      txHash: result.txHash,
    };

    await saveBatch(gun, batch);
    log.debug({ batchId: batchId.toString() }, "Batch saved to GunDB");

    // Wait a bit for GunDB to propagate the data
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify the batch was saved correctly
    try {
      const savedBatch = await getBatch(gun, batchId.toString());
      if (savedBatch) {
        // Batch verification: Successfully read back saved batch - only log if issues occur
      } else {
        log.warn(
          { batchId: batchId.toString() },
          "Batch verification: Could not read back saved batch rapidly"
        );
      }
    } catch (error) {
      log.warn(
        { error, batchId: batchId.toString() },
        "Batch verification: Error reading back saved batch"
      );
    }

    // Remove processed withdrawals from pending queue (only verified ones)
    await removePendingWithdrawals(gun, verifiedWithdrawals);

    if (pendingForceWithdrawals.length > 0) {
      await removePendingForceWithdrawals(gun, pendingForceWithdrawals);
      // Removed processed force withdrawals - only log if issues occur
    }

    // Processed withdrawals removed from pending queue - only log if issues occur

    return {
      success: true,
      batchId: batchId.toString(),
      root,
      withdrawalCount: verifiedWithdrawals.length,
      verifiedCount: verifiedWithdrawals.length,
      excludedCount: pending.length - verifiedWithdrawals.length,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    // Enhanced error logging
    if (error && typeof error === "object" && "code" in error) {
      log.error(
        {
          error,
          errorMessage,
          errorCode: (error as any).code,
          errorReason: (error as any).reason,
          pendingCount: pending?.length || 0,
        },
        "Error in submitBatch (with error code)"
      );

      return {
        success: false,
        withdrawalCount: pending?.length || 0,
        error: errorMessage,
        errorCode: (error as any).code,
        errorReason: (error as any).reason,
      };
    } else {
      log.error(
        {
          error,
          errorMessage,
          errorStack,
          pendingCount: pending?.length || 0,
        },
        "Error in submitBatch"
      );

      return {
        success: false,
        withdrawalCount: pending?.length || 0,
        error: errorMessage,
      };
    }
  }
}
