/**
 * Bridge Event Listener
 * 
 * Listens to Deposit events from the GunL2Bridge contract and credits
 * user balances in GunDB (L2 state).
 * 
 * SECURITY FEATURES:
 * - Verifies transaction exists and is confirmed before crediting
 * - Waits for minimum block confirmations (configurable)
 * - Prevents duplicate credits (idempotency check)
 * - Only processes events from verified contract
 * 
 * This runs as a background service that:
 * 1. Listens to new Deposit events
 * 2. Verifies transaction and block confirmations
 * 3. Checks for duplicate credits (idempotency)
 * 4. Credits the user's L2 balance in GunDB
 * 5. Handles reconnection and error recovery
 */

import type { IGunInstance } from "gun";
import { ethers } from "ethers";
import { createBridgeClient, type BridgeClient } from "./bridge-client";
import { creditBalance, isDepositProcessed, markDepositProcessed, getUserBalance } from "./bridge-state";
import { loggers } from "./logger";

const log = loggers.bridge || {
  info: console.log,
  error: console.error,
  warn: console.warn,
};

export interface BridgeListenerConfig {
  rpcUrl: string;
  chainId: number;
  startBlock?: number; // Block to start listening from (default: latest)
  enabled?: boolean; // Whether listener is enabled (default: true)
  minConfirmations?: number; // Minimum block confirmations before crediting (default: 3)
  relayKeyPair?: { pub: string; priv: string; epub?: string; epriv?: string } | null; // Optional: Relay SEA keypair for signing balance data
  // contractAddress is no longer needed - SDK gets it from deployments automatically
}

let listenerCleanup: (() => void) | null = null;
let isListening = false;

/**
 * Start listening to Deposit events
 */
export async function startBridgeListener(
  gun: IGunInstance,
  config: BridgeListenerConfig
): Promise<void> {
  if (isListening) {
    log.warn("Bridge listener already running");
    return;
  }

  if (config.enabled === false) {
    log.info("Bridge listener disabled by config");
    return;
  }

  try {
    const client = createBridgeClient({
      rpcUrl: config.rpcUrl,
      chainId: config.chainId,
    });

    const contractAddress = client.contractAddress;

    log.info(
      {
        contractAddress,
        chainId: config.chainId,
        startBlock: config.startBlock || "latest",
      },
      "Starting bridge deposit listener"
    );

    const minConfirmations = config.minConfirmations || 3;

    // Start listening to Deposit events
    const cleanup = await client.listenToDeposits(
      config.startBlock || "latest",
      async (event) => {
        try {
          // SECURITY: Check if deposit already processed (idempotency)
          // Normalize user address to ensure consistent key
          const normalizedUser = event.user.toLowerCase();
          const depositKey = `${event.txHash}:${normalizedUser}:${event.amount}`;
          
          log.info(
            {
              txHash: event.txHash,
              user: normalizedUser,
              amount: event.amount.toString(),
              depositKey,
            },
            "Received deposit event, checking if already processed"
          );
          
          const alreadyProcessed = await isDepositProcessed(gun, depositKey);
          
          if (alreadyProcessed) {
            // CRITICAL: Verify that the balance was actually written
            // If deposit is marked as processed but balance doesn't exist, reprocess it
            const currentBalance = await getUserBalance(gun, normalizedUser);
            const balanceBefore = currentBalance;
            const expectedBalance = balanceBefore + event.amount;
            
            // Check if we need to reprocess (balance might be missing due to previous failure)
            // We check if the balance is less than expected, which means the deposit wasn't fully processed
            // Note: This is a heuristic - if user made other transactions, balance might be different
            // But if balance is 0 and deposit should have credited, we definitely need to reprocess
            if (currentBalance === 0n && event.amount > 0n) {
              log.warn(
                {
                  txHash: event.txHash,
                  user: normalizedUser,
                  amount: event.amount.toString(),
                  depositKey,
                  currentBalance: currentBalance.toString(),
                },
                "Deposit marked as processed but balance is 0 - reprocessing"
              );
              // Continue processing instead of returning
            } else {
              log.warn(
                {
                  txHash: event.txHash,
                  user: normalizedUser,
                  amount: event.amount.toString(),
                  depositKey,
                  currentBalance: currentBalance.toString(),
                },
                "Deposit already processed, skipping"
              );
              return;
            }
          }
          
          log.info(
            {
              txHash: event.txHash,
              user: normalizedUser,
              amount: event.amount.toString(),
              depositKey,
            },
            "Deposit not yet processed, proceeding with verification"
          );

          log.info(
            {
              user: event.user,
              amount: event.amount.toString(),
              txHash: event.txHash,
              blockNumber: event.blockNumber,
              minConfirmations,
            },
            "Processing deposit event"
          );

          // SECURITY: Verify transaction exists and get current block
          const provider = client.provider;
          const currentBlock = await provider.getBlockNumber();
          const confirmations = currentBlock - event.blockNumber;

          if (confirmations < minConfirmations) {
            log.info(
              {
                txHash: event.txHash,
                blockNumber: event.blockNumber,
                currentBlock,
                confirmations,
                required: minConfirmations,
              },
              "Waiting for more confirmations"
            );
            return; // Will be processed again when more blocks are mined
          }

          // SECURITY: Verify transaction receipt exists and is successful
          const receipt = await provider.getTransactionReceipt(event.txHash);
          if (!receipt) {
            log.warn(
              { txHash: event.txHash },
              "Transaction receipt not found, skipping"
            );
            return;
          }

          if (receipt.status !== 1) {
            log.warn(
              { txHash: event.txHash, status: receipt.status },
              "Transaction failed, skipping"
            );
            return;
          }

          // SECURITY: Verify event is from the correct contract
          const contractAddress = client.contractAddress.toLowerCase();
          const eventContract = receipt.logs.find(
            (log) => log.address.toLowerCase() === contractAddress
          );

          if (!eventContract) {
            log.warn(
              { txHash: event.txHash, contractAddress },
              "Event not from bridge contract, skipping"
            );
            return;
          }

          // SECURITY: Double-check pattern to prevent race conditions
          // Another listener instance might have processed this deposit while we were verifying
          const stillNotProcessed = !(await isDepositProcessed(gun, depositKey));
          if (!stillNotProcessed) {
            log.warn(
              {
                txHash: event.txHash,
                user: event.user,
                amount: event.amount.toString(),
              },
              "Deposit was processed by another instance, skipping"
            );
            return;
          }

          // All security checks passed - credit balance (with signature if relay keypair available)
          // SECURITY: Only mark as processed AFTER successful credit AND verification to ensure idempotency
          // If creditBalance fails, the deposit will be retried (which is correct behavior)
          
          log.info(
            {
              user: normalizedUser,
              amount: event.amount.toString(),
              txHash: event.txHash,
            },
            "Crediting balance to L2"
          );
          
          // Get balance before credit to calculate expected balance
          const balanceBefore = await getUserBalance(gun, normalizedUser);
          const expectedBalance = balanceBefore + event.amount;
          
          await creditBalance(gun, normalizedUser, event.amount, config.relayKeyPair);
          
          // CRITICAL: Wait and verify balance was actually written before marking as processed
          // GunDB is eventually consistent, so we need to poll until the balance appears
          let verifyBalance = await getUserBalance(gun, normalizedUser);
          let retries = 0;
          const maxRetries = 10;
          const retryDelay = 500; // 500ms between retries
          
          while (verifyBalance < expectedBalance && retries < maxRetries) {
            log.info(
              {
                user: normalizedUser,
                expected: expectedBalance.toString(),
                current: verifyBalance.toString(),
                retry: retries + 1,
              },
              "Waiting for balance to be written to GunDB"
            );
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            verifyBalance = await getUserBalance(gun, normalizedUser);
            retries++;
          }
          
          if (verifyBalance < expectedBalance) {
            log.error(
              {
                user: normalizedUser,
                expected: expectedBalance.toString(),
                actual: verifyBalance.toString(),
                txHash: event.txHash,
              },
              "Balance verification failed - balance not written correctly"
            );
            throw new Error(`Balance verification failed: expected ${expectedBalance.toString()}, got ${verifyBalance.toString()}`);
          }
          
          log.info(
            {
              user: normalizedUser,
              amount: event.amount.toString(),
              txHash: event.txHash,
              balanceBefore: balanceBefore.toString(),
              balanceAfter: verifyBalance.toString(),
            },
            "Balance credited and verified, marking deposit as processed"
          );
          
          // Mark as processed (idempotency) - only if creditBalance succeeded AND verified
          await markDepositProcessed(gun, depositKey, {
            txHash: event.txHash,
            user: normalizedUser,
            amount: event.amount.toString(),
            blockNumber: event.blockNumber,
            timestamp: Date.now(),
          });

          log.info(
            {
              user: normalizedUser,
              amount: ethers.formatEther(event.amount),
              txHash: event.txHash,
              confirmations,
              newBalance: ethers.formatEther(verifyBalance),
              balance: "credited",
            },
            "Deposit credited to L2 balance - verified and marked as processed"
          );
        } catch (error) {
          log.error(
            { error, event },
            "Error processing deposit event"
          );
          // Don't throw - continue processing other events
        }
      }
    );

    listenerCleanup = cleanup;
    isListening = true;

    log.info("Bridge deposit listener started successfully");
  } catch (error) {
    log.error({ error, config }, "Failed to start bridge listener");
    throw error;
  }
}

/**
 * Stop listening to Deposit events
 */
export function stopBridgeListener(): void {
  if (listenerCleanup) {
    listenerCleanup();
    listenerCleanup = null;
    isListening = false;
    log.info("Bridge deposit listener stopped");
  }
}

/**
 * Check if listener is running
 */
export function isBridgeListenerRunning(): boolean {
  return isListening;
}

