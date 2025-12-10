/**
 * Bridge Client - Interact with GunL2Bridge contract
 * 
 * Uses Shogun SDK instead of hardcoded ABIs for better maintainability.
 * 
 * Provides utilities for:
 * - Depositing ETH to bridge
 * - Submitting batches (sequencer only)
 * - Withdrawing with Merkle proof
 * - Listening to Deposit events
 */

import { ethers } from "ethers";
import { ShogunSDK } from "shogun-contracts-sdk";
import { createLogger } from "./logger";

const log = createLogger("bridge");

export interface BridgeConfig {
  rpcUrl: string;
  chainId: number;
  privateKey?: string; // Optional, for sequencer operations
  // contractAddress is no longer needed - SDK gets it from deployments automatically
}

export interface DepositEvent {
  user: string;
  amount: bigint;
  timestamp: bigint;
  blockNumber: number;
  txHash: string;
}

export interface BatchSubmittedEvent {
  batchId: bigint;
  stateRoot: string;
  blockNumber: number;
  txHash: string;
}

/**
 * Create a bridge client using Shogun SDK
 */
export function createBridgeClient(config: BridgeConfig) {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);

  // Create SDK instance
  const sdk = new ShogunSDK({
    provider,
    chainId: config.chainId,
    signer: config.privateKey ? new ethers.Wallet(config.privateKey, provider) : undefined,
  });

  // Get GunL2Bridge instance from SDK
  const bridge = sdk.getGunL2Bridge();

  // Get the underlying contract for event listening
  const contract = bridge.getContract();

  let wallet: ethers.Wallet | null = null;
  if (config.privateKey) {
    wallet = new ethers.Wallet(config.privateKey, provider);
  }

  return {
    provider,
    contract, // For event listening (backward compatibility)
    bridge, // SDK bridge instance
    wallet,
    config,
    // Get contract address from SDK (not from config)
    get contractAddress() {
      return bridge.getAddress();
    },

    /**
     * Deposit ETH to bridge
     */
    async deposit(amount: bigint): Promise<{ txHash: string; blockNumber: number }> {
      if (!wallet) {
        throw new Error("BridgeClient: Private key required for deposits");
      }

      log.info({ amount: ethers.formatEther(amount) }, "Depositing ETH to bridge");

      const tx = await bridge.deposit(amount);
      const receipt = await tx.wait();

      if (!receipt) {
        throw new Error("BridgeClient: Transaction receipt not found");
      }

      log.info(
        { txHash: receipt.hash, blockNumber: receipt.blockNumber },
        "Deposit successful"
      );

      return {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
      };
    },

    /**
     * Submit a batch (sequencer only)
     */
    async submitBatch(stateRoot: string): Promise<{ txHash: string; blockNumber: number; batchId: bigint }> {
      if (!wallet) {
        throw new Error("BridgeClient: Private key required for batch submission");
      }

      log.info({ stateRoot }, "Submitting batch to bridge");

      const tx = await bridge.submitBatch(stateRoot);
      const receipt = await tx.wait();

      if (!receipt) {
        throw new Error("BridgeClient: Transaction receipt not found");
      }

      // Get the batch ID from the event or by querying the contract
      const event = receipt.logs.find(
        (log: ethers.Log) => log.topics[0] === ethers.id("BatchSubmitted(uint256,bytes32)")
      );

      let batchId = 0n;
      if (event) {
        const parsed = contract.interface.parseLog(event);
        if (parsed) {
          batchId = parsed.args[0];
        }
      } else {
        // Fallback: query current batch ID
        batchId = await bridge.getCurrentBatchId();
      }

      log.info(
        { txHash: receipt.hash, blockNumber: receipt.blockNumber, batchId: batchId.toString() },
        "Batch submitted successfully"
      );

      return {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        batchId,
      };
    },

    /**
     * Withdraw ETH using Merkle proof
     */
    async withdraw(
      amount: bigint,
      nonce: bigint,
      batchId: bigint,
      proof: string[]
    ): Promise<{ txHash: string; blockNumber: number }> {
      if (!wallet) {
        throw new Error("BridgeClient: Private key required for withdrawals");
      }

      log.info(
        { amount: ethers.formatEther(amount), nonce: nonce.toString(), batchId: batchId.toString() },
        "Withdrawing from bridge"
      );

      const tx = await bridge.withdraw(amount, nonce, batchId, proof);
      const receipt = await tx.wait();

      if (!receipt) {
        throw new Error("BridgeClient: Transaction receipt not found");
      }

      log.info(
        { txHash: receipt.hash, blockNumber: receipt.blockNumber },
        "Withdrawal successful"
      );

      return {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
      };
    },

    /**
     * Get current state root
     */
    async getCurrentStateRoot(): Promise<string> {
      return await bridge.getCurrentStateRoot();
    },

    /**
     * Get current batch ID
     */
    async getCurrentBatchId(): Promise<bigint> {
      return await bridge.getCurrentBatchId();
    },

    /**
     * Get sequencer address
     */
    async getSequencer(): Promise<string> {
      return await bridge.getSequencer();
    },

    /**
     * Check if withdrawal is already processed
     */
    async isWithdrawalProcessed(
      user: string,
      amount: bigint,
      nonce: bigint
    ): Promise<boolean> {
      return await bridge.isWithdrawalProcessed(user, amount, nonce);
    },

    /**
     * Get contract balance
     */
    async getBalance(): Promise<bigint> {
      return await bridge.getBalance();
    },

    /**
     * Listen to Deposit events
     */
    async listenToDeposits(
      fromBlock: number | "latest",
      callback: (event: DepositEvent) => void | Promise<void>
    ): Promise<() => void> {
      const filter = contract.filters.Deposit();

      // Helper to extract event data from either parsed EventLog or raw args
      const extractEventData = (eventOrArgs: any): { user: string; amount: bigint; timestamp: bigint; log: ethers.Log } | null => {
        if (!eventOrArgs || typeof eventOrArgs !== 'object') {
          return null;
        }

        // First, try to find the actual log object with transactionHash
        let actualLog: ethers.Log | null = null;

        // Check if eventOrArgs itself is a log object
        if ('transactionHash' in eventOrArgs && typeof eventOrArgs.transactionHash === 'string') {
          actualLog = eventOrArgs as ethers.Log;
        }
        // Check if there's a nested log property
        else if (eventOrArgs.log && typeof eventOrArgs.log === 'object' && 'transactionHash' in eventOrArgs.log) {
          actualLog = eventOrArgs.log as ethers.Log;
        }
        // Check if there's a nested event.log structure
        else if (eventOrArgs.event && typeof eventOrArgs.event === 'object' && eventOrArgs.event.log) {
          const nestedLog = eventOrArgs.event.log;
          if (nestedLog && typeof nestedLog === 'object' && 'transactionHash' in nestedLog) {
            actualLog = nestedLog as ethers.Log;
          }
        }

        // Now extract args - could be in args property or directly in eventOrArgs
        let args: any[] | null = null;

        if (eventOrArgs.args && Array.isArray(eventOrArgs.args) && eventOrArgs.args.length >= 3) {
          args = eventOrArgs.args;
        } else if (Array.isArray(eventOrArgs) && eventOrArgs.length >= 3) {
          args = eventOrArgs;
        }

        // If we have both args and log, return the extracted data
        if (args && actualLog) {
          return {
            user: args[0],
            amount: args[1],
            timestamp: args[2],
            log: actualLog,
          };
        }

        return null;
      };

      const listener = async (...args: any[]) => {
        // Handle different event formats from ethers
        let user: string;
        let amount: bigint;
        let timestamp: bigint;
        let event: ethers.Log;

        // Check if first arg is a parsed EventLog
        const extracted = extractEventData(args[0]);
        if (extracted) {
          user = extracted.user;
          amount = extracted.amount;
          timestamp = extracted.timestamp;
          event = extracted.log;
        } else if (args.length >= 4) {
          // Standard format: (user, amount, timestamp, event)
          [user, amount, timestamp, event] = args;
          // Validate event is a Log object
          if (!event || typeof event !== 'object' || !('transactionHash' in event)) {
            log.error({ args }, "Invalid event log object in deposit listener");
            return;
          }
        } else if (args.length === 1 && args[0] && typeof args[0] === 'object') {
          // Single EventLog object - may have nested log structure
          const logEvent = args[0] as any;
          if (logEvent.args && Array.isArray(logEvent.args) && logEvent.args.length >= 3) {
            user = logEvent.args[0];
            amount = logEvent.args[1];
            timestamp = logEvent.args[2];
            // Use nested log if available, otherwise use the event itself
            event = (logEvent.log && typeof logEvent.log === 'object' && 'transactionHash' in logEvent.log)
              ? logEvent.log
              : logEvent;
          } else {
            log.error({ event: logEvent }, "Invalid event format in deposit listener");
            return;
          }
        } else {
          log.error({ args }, "Unexpected event format in deposit listener");
          return;
        }

        // Normalize event - ensure we have the actual log object with transactionHash
        // Some event formats have nested log structure: { args: [...], log: { transactionHash, ... } }
        if (event && typeof event === 'object' && !('transactionHash' in event)) {
          // Try to find log in nested structure
          const eventAny = event as any;
          if (eventAny.log && typeof eventAny.log === 'object' && 'transactionHash' in eventAny.log) {
            event = eventAny.log as ethers.Log;
          } else if (eventAny.event && typeof eventAny.event === 'object' && 'log' in eventAny.event) {
            const nestedLog = eventAny.event.log;
            if (nestedLog && typeof nestedLog === 'object' && 'transactionHash' in nestedLog) {
              event = nestedLog as ethers.Log;
            }
          } else {
            // Last resort: check if the original args[0] has a log property we missed
            if (args.length > 0 && args[0] && typeof args[0] === 'object') {
              const firstArg = args[0] as any;
              if (firstArg.log && typeof firstArg.log === 'object' && 'transactionHash' in firstArg.log) {
                event = firstArg.log as ethers.Log;
              } else if (firstArg.event && typeof firstArg.event === 'object' && firstArg.event.log) {
                const nestedLog = firstArg.event.log;
                if (nestedLog && typeof nestedLog === 'object' && 'transactionHash' in nestedLog) {
                  event = nestedLog as ethers.Log;
                }
              }
            }
          }
        }

        try {
          // Validate user address before processing
          if (!user || typeof user !== 'string') {
            const txHash = event && typeof event === 'object' && 'transactionHash' in event
              ? (event as any).transactionHash
              : 'unknown';
            log.error(
              { user, amount: amount?.toString(), timestamp: timestamp?.toString(), txHash },
              "Invalid user address in deposit event: user is missing or not a string"
            );
            return;
          }

          // Validate and normalize address
          let normalizedUser: string;
          try {
            normalizedUser = ethers.getAddress(user);
          } catch (error) {
            log.error(
              { user, amount: amount?.toString(), timestamp: timestamp?.toString(), txHash: event.transactionHash, error },
              "Invalid user address format in deposit event"
            );
            return;
          }

          // Validate amount and timestamp
          if (amount === undefined || amount === null || typeof amount !== 'bigint') {
            log.error(
              { user: normalizedUser, amount, timestamp: timestamp?.toString(), txHash: event.transactionHash },
              "Invalid amount in deposit event"
            );
            return;
          }

          if (timestamp === undefined || timestamp === null || typeof timestamp !== 'bigint') {
            log.error(
              { user: normalizedUser, amount: amount.toString(), timestamp, txHash: event.transactionHash },
              "Invalid timestamp in deposit event"
            );
            return;
          }

          // Final check: if transactionHash is still not found, try one more time to extract from nested structure
          if (!event || typeof event !== 'object' || !('transactionHash' in event)) {
            // Last resort: check if args[0] has the log we need
            if (args.length > 0 && args[0] && typeof args[0] === 'object') {
              const firstArg = args[0] as any;
              if (firstArg.log && typeof firstArg.log === 'object' && 'transactionHash' in firstArg.log) {
                event = firstArg.log as ethers.Log;
              }
            }
          }

          // Validate transactionHash - should be available after normalization
          if (!event || typeof event !== 'object' || !('transactionHash' in event) || typeof event.transactionHash !== 'string') {
            log.error(
              {
                user: normalizedUser,
                amount: amount.toString(),
                eventKeys: event ? Object.keys(event) : [],
                eventType: event ? typeof event : 'null',
                argsLength: args.length,
                firstArgKeys: args.length > 0 && args[0] && typeof args[0] === 'object' ? Object.keys(args[0]) : [],
                event
              },
              "Invalid transactionHash in deposit event - event does not have transactionHash after normalization"
            );
            return;
          }

          // Get blockNumber - may be null for pending events, try to get from receipt
          let blockNumber: number | null = event.blockNumber ?? null;

          // Log if blockNumber is missing for debugging
          if (blockNumber === null || blockNumber === undefined) {
            log.debug(
              {
                user: normalizedUser,
                txHash: event.transactionHash,
                eventBlockNumber: event.blockNumber,
                eventKeys: Object.keys(event)
              },
              "Event blockNumber is null/undefined, attempting to retrieve from receipt"
            );
          }

          // If blockNumber is null or undefined, try to get it from the transaction receipt
          if (blockNumber === null || blockNumber === undefined) {
            try {
              const receipt = await provider.getTransactionReceipt(event.transactionHash);
              if (receipt && receipt.blockNumber !== null) {
                blockNumber = receipt.blockNumber;
                log.info(
                  { user: normalizedUser, txHash: event.transactionHash, blockNumber },
                  "Retrieved blockNumber from transaction receipt"
                );
              } else {
                log.warn(
                  { user: normalizedUser, txHash: event.transactionHash },
                  "Transaction receipt found but blockNumber is null (transaction may be pending)"
                );
              }
            } catch (error) {
              log.warn(
                { user: normalizedUser, txHash: event.transactionHash, error },
                "Could not retrieve blockNumber from receipt, event may be pending"
              );
            }
          }

          // If still no blockNumber, this might be a pending event - skip it for now
          // It will be processed again when the block is confirmed
          if (blockNumber === null || blockNumber === undefined) {
            log.info(
              { user: normalizedUser, amount: amount.toString(), txHash: event.transactionHash },
              "Skipping deposit event with no blockNumber (likely pending)"
            );
            return;
          }

          // Validate blockNumber is a valid number
          if (typeof blockNumber !== 'number' || isNaN(blockNumber) || blockNumber < 0) {
            log.error(
              { user: normalizedUser, amount: amount.toString(), txHash: event.transactionHash, blockNumber },
              "Invalid blockNumber value in deposit event"
            );
            return;
          }

          const depositEvent: DepositEvent = {
            user: normalizedUser,
            amount,
            timestamp,
            blockNumber,
            txHash: event.transactionHash,
          };

          await callback(depositEvent);
        } catch (error) {
          log.error(
            { error, user, amount: amount?.toString(), timestamp: timestamp?.toString(), txHash: event.transactionHash },
            "Error processing deposit event"
          );
          // Don't throw - continue processing other events
        }
      };

      // Listen to new events
      contract.on(filter, listener);

      // Also query historical events if fromBlock is specified
      if (fromBlock !== "latest") {
        try {
          const events = await contract.queryFilter(filter, fromBlock);
          for (const event of events) {
            // For queryFilter results, pass the event object directly to listener
            // The listener will handle extracting args and log
            await listener(event);
          }
        } catch (error) {
          log.error(
            { error, fromBlock },
            "Error querying historical deposit events"
          );
          // Don't throw - continue with live listener
        }
      }

      // Return cleanup function
      return () => {
        contract.off(filter, listener);
      };
    },

    /**
     * Query all Deposit events in a block range
     * Useful for retroactive synchronization of missed deposits
     */
    async queryDeposits(
      fromBlock: number,
      toBlock: number | "latest",
      userAddress?: string
    ): Promise<DepositEvent[]> {
      try {
        // Create filter - if userAddress is provided, filter by user
        const filter = userAddress
          ? contract.filters.Deposit(userAddress)
          : contract.filters.Deposit();

        // Resolve "latest" to actual block number
        let toBlockNumber: number;
        if (toBlock === "latest") {
          toBlockNumber = await provider.getBlockNumber();
        } else {
          toBlockNumber = toBlock;
        }

        const contractAddr = bridge.getAddress();
        log.info(
          { fromBlock, toBlock: toBlockNumber, contractAddress: contractAddr, userAddress },
          "Querying deposit events"
        );

        // Ensure fromBlock is not negative
        const safeFromBlock = Math.max(0, fromBlock);

        const events = await contract.queryFilter(filter, safeFromBlock, toBlockNumber);
        const depositEvents: DepositEvent[] = [];

        for (const event of events) {
          try {
            // Extract event data
            let user: string;
            let amount: bigint;
            let timestamp: bigint;
            let blockNumber: number;
            let txHash: string;

            if (event.args && Array.isArray(event.args) && event.args.length >= 3) {
              user = event.args[0];
              amount = event.args[1];
              timestamp = event.args[2];
            } else {
              log.warn({ event }, "Invalid event args format");
              continue;
            }

            // Get block number and transaction hash
            if (event.log) {
              blockNumber = event.log.blockNumber;
              txHash = event.log.transactionHash;
            } else if (event.blockNumber !== undefined && event.transactionHash) {
              blockNumber = event.blockNumber;
              txHash = event.transactionHash;
            } else {
              log.warn({ event }, "Missing block number or transaction hash");
              continue;
            }

            const normalizedUser = user.toLowerCase();
            depositEvents.push({
              user: normalizedUser,
              amount,
              timestamp,
              blockNumber,
              txHash,
            });
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            log.error({ error: errorMsg, event }, "Error parsing deposit event");
            // Continue with other events
          }
        }

        log.info(
          { fromBlock: safeFromBlock, toBlock: toBlockNumber, count: depositEvents.length },
          "Deposit events queried"
        );

        return depositEvents;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        log.error({
          error: errorMsg,
          errorStack,
          fromBlock,
          toBlock,
          fromBlockType: typeof fromBlock,
          toBlockType: typeof toBlock
        }, "Error querying deposits");
        throw error;
      }
    },

    /**
     * Listen to BatchSubmitted events
     */
    async listenToBatches(
      fromBlock: number | "latest",
      callback: (event: BatchSubmittedEvent) => void | Promise<void>
    ): Promise<() => void> {
      const filter = contract.filters.BatchSubmitted();

      const listener = async (batchId: bigint, stateRoot: string, event: ethers.Log) => {
        const batchEvent: BatchSubmittedEvent = {
          batchId,
          stateRoot,
          blockNumber: event.blockNumber,
          txHash: event.transactionHash,
        };

        try {
          await callback(batchEvent);
        } catch (error) {
          log.error({ error, batchEvent }, "Error processing batch event");
        }
      };

      contract.on(filter, listener);

      if (fromBlock !== "latest") {
        const events = await contract.queryFilter(filter, fromBlock);
        for (const event of events) {
          if ('args' in event && event.args) {
            await listener(event.args[0], event.args[1], event);
          }
        }
      }

      return () => {
        contract.off(filter, listener);
      };
    },
  };
}

export type BridgeClient = ReturnType<typeof createBridgeClient>;

