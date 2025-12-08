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
      proof: string[]
    ): Promise<{ txHash: string; blockNumber: number }> {
      if (!wallet) {
        throw new Error("BridgeClient: Private key required for withdrawals");
      }

      log.info(
        { amount: ethers.formatEther(amount), nonce: nonce.toString() },
        "Withdrawing from bridge"
      );

      const tx = await bridge.withdraw(amount, nonce, proof);
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

      const listener = async (user: string, amount: bigint, timestamp: bigint, event: ethers.Log) => {
        const depositEvent: DepositEvent = {
          user: ethers.getAddress(user),
          amount,
          timestamp,
          blockNumber: event.blockNumber,
          txHash: event.transactionHash,
        };

        try {
          await callback(depositEvent);
        } catch (error) {
          log.error({ error, depositEvent }, "Error processing deposit event");
        }
      };

      // Listen to new events
      contract.on(filter, listener);

      // Also query historical events if fromBlock is specified
      if (fromBlock !== "latest") {
        const events = await contract.queryFilter(filter, fromBlock);
        for (const event of events) {
          if ('args' in event && event.args) {
            await listener(event.args[0], event.args[1], event.args[2], event);
          }
        }
      }

      // Return cleanup function
      return () => {
        contract.off(filter, listener);
      };
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

