import { createBridgeClient, type BridgeClient } from "./bridge-client";
import { loggers } from "./logger";
import {
    getPendingWithdrawals,
    saveBatch,
    removePendingWithdrawals,
    getBatch,
    type PendingWithdrawal,
    type Batch,
} from "./bridge-state";
import {
    buildMerkleTreeFromWithdrawals,
    type WithdrawalLeaf,
} from "./merkle-tree";
import type { IGunInstance } from "gun";

const log = loggers.bridge || console;

// Singleton client instance
let bridgeClient: BridgeClient | null = null;

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

export interface BatchSubmissionResult {
    success: boolean;
    batchId?: string;
    root?: string;
    withdrawalCount: number;
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
 * 2. Builds a Merkle tree
 * 3. Submits the root to the L1 contract
 * 4. Saves the batch metadata to GunDB
 * 5. Removes processed withdrawals from the pending queue
 */
export async function submitBatch(gun: IGunInstance): Promise<BatchSubmissionResult> {
    let pending: PendingWithdrawal[] = [];

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

        log.info(
            { walletAddress: client.wallet.address },
            "Starting batch submission"
        );

        // Get pending withdrawals
        log.info({}, "Fetching pending withdrawals");
        pending = await getPendingWithdrawals(gun);
        log.info(
            { pendingCount: pending.length },
            "Retrieved pending withdrawals"
        );

        if (pending.length === 0) {
            log.info({}, "No pending withdrawals to batch");
            return {
                success: false,
                withdrawalCount: 0,
                error: "No pending withdrawals to batch",
            };
        }

        // Convert to withdrawal leaves
        const withdrawals: WithdrawalLeaf[] = pending.map((w) => ({
            user: w.user,
            amount: BigInt(w.amount),
            nonce: BigInt(w.nonce),
        }));

        // Build Merkle tree
        log.info({}, "Building Merkle tree");
        const { root } = buildMerkleTreeFromWithdrawals(withdrawals);
        log.info({ root, leafCount: withdrawals.length }, "Merkle tree built");

        // Submit batch to contract
        log.info({ root }, "Submitting batch to contract");
        const result = await client.submitBatch(root);
        log.info(
            { txHash: result.txHash, blockNumber: result.blockNumber, batchId: result.batchId.toString() },
            "Batch submitted to contract successfully"
        );

        // Get current batch ID (should match result.batchId)
        // Use the batch ID from the transaction event to ensure we match the specific batch submitted
        const batchId = result.batchId.toString();

        // Save batch to GunDB
        log.info({ batchId: batchId.toString(), withdrawalCount: pending.length }, "Saving batch to GunDB");
        const batch: Batch = {
            batchId: batchId.toString(),
            root,
            withdrawals: pending,
            timestamp: Date.now(),
            blockNumber: result.blockNumber,
            txHash: result.txHash,
        };

        await saveBatch(gun, batch);
        log.info({ batchId: batchId.toString() }, "Batch saved to GunDB");

        // Wait a bit for GunDB to propagate the data
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Verify the batch was saved correctly
        try {
            const savedBatch = await getBatch(gun, batchId.toString());
            if (savedBatch) {
                log.info(
                    { batchId: savedBatch.batchId },
                    "Batch verification: Successfully read back saved batch"
                );
            } else {
                log.warn({ batchId: batchId.toString() }, "Batch verification: Could not read back saved batch rapidly");
            }
        } catch (error) {
            log.warn({ error, batchId: batchId.toString() }, "Batch verification: Error reading back saved batch");
        }

        // Remove processed withdrawals from pending queue
        log.info({ withdrawalCount: pending.length }, "Removing processed withdrawals from pending queue");
        await removePendingWithdrawals(gun, pending);
        log.info({}, "Processed withdrawals removed from pending queue");

        return {
            success: true,
            batchId: batchId.toString(),
            root,
            withdrawalCount: pending.length,
            txHash: result.txHash,
            blockNumber: result.blockNumber,
        };

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;

        // Enhanced error logging
        if (error && typeof error === 'object' && 'code' in error) {
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
