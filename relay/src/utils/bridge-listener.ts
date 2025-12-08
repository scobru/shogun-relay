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
import { creditBalance, isDepositProcessed, markDepositProcessed } from "./bridge-state";
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
          const depositKey = `${event.txHash}:${event.user}:${event.amount}`;
          const alreadyProcessed = await isDepositProcessed(gun, depositKey);
          
          if (alreadyProcessed) {
            log.warn(
              {
                txHash: event.txHash,
                user: event.user,
                amount: event.amount.toString(),
              },
              "Deposit already processed, skipping"
            );
            return;
          }

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

          // All security checks passed - credit balance (with signature if relay keypair available)
          await creditBalance(gun, event.user, event.amount, config.relayKeyPair);
          
          // Mark as processed (idempotency)
          await markDepositProcessed(gun, depositKey, {
            txHash: event.txHash,
            user: event.user,
            amount: event.amount.toString(),
            blockNumber: event.blockNumber,
            timestamp: Date.now(),
          });

          log.info(
            {
              user: event.user,
              amount: ethers.formatEther(event.amount),
              txHash: event.txHash,
              confirmations,
              balance: "credited",
            },
            "Deposit credited to L2 balance"
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

