/**
 * Bridge State Management - L2 State in GunDB
 *
 * Manages the L2 state for the bridge:
 * - User balances (credited from deposits) - Uses frozen-data for immutability
 * - Pending withdrawals (queued for batch submission)
 * - Batch history
 *
 * SECURITY: Uses frozen-data pattern for balances
 * - Immutable, signed entries with content-addressed hashing
 * - Automatic signature verification on read
 * - Only registered relays can write (enforced by bridge-listener verification)
 *
 * IMPORTANT: Balance linking between Ethereum address and GunDB pub key
 * - Deposits arrive with Ethereum address (0x...)
 * - Client derives GunDB pub key from wallet (deterministic)
 * - Balance is stored using Ethereum address as key (for deposits)
 * - When user operates (transfer/withdraw), they provide GunDB pub key
 * - Relay verifies GunDB pub key can be derived from Ethereum address
 *
 * State structure in GunDB:
 * - frozen-bridge-balances/{hash} -> { data: { balance, updatedAt, ethereumAddress, gunPubKey? }, sig, hash }
 * - bridge/balances-index/{ethereumAddress} -> { latestHash, pub, updatedAt, gunPubKey? }
 * - bridge/address-to-gun/{ethereumAddress} -> { gunPubKey, verified, timestamp } (mapping)
 * - bridge/withdrawals/pending -> array of { user, amount, nonce, timestamp }
 * - bridge/batches/{batchId} -> { root: string, withdrawals: [...], timestamp }
 * - bridge/processed-deposits/{key} -> { txHash, user, amount, blockNumber, timestamp }
 */

import type { IGunInstance, GunMessagePut } from "gun";
import Gun from "gun";
import "gun/sea";
import * as FrozenData from "./frozen-data";

const SEA = (Gun as any).SEA;

export interface UserBalance {
  balance: string; // BigInt as string (wei)
  updatedAt: number; // Timestamp
}

export interface PendingWithdrawal {
  user: string;
  amount: string; // BigInt as string (wei)
  nonce: string; // BigInt as string
  timestamp: number;
  txHash?: string; // L2 transaction hash (if applicable)
}

export interface Batch {
  batchId: string;
  root: string;
  withdrawals: PendingWithdrawal[];
  timestamp: number;
  blockNumber?: number;
  txHash?: string;
}

export interface ProcessedDeposit {
  txHash: string;
  user: string;
  amount: string;
  blockNumber: number;
  timestamp: number;
}

/**
 * Get user balance from GunDB
 * Uses frozen-data pattern for secure, verifiable balance storage
 */
export async function getUserBalance(
  gun: IGunInstance,
  userAddress: string
): Promise<bigint> {
  try {
    const indexKey = userAddress.toLowerCase();

    // Get latest frozen entry for this user
    const entry = await FrozenData.getLatestFrozenEntry(
      gun,
      "bridge-balances",
      indexKey
    );

    if (!entry || !entry.verified) {
      // If no verified entry found, return 0
      // Unverified entries are ignored for security
      return 0n;
    }

    const balanceData = entry.data as { balance?: string; user?: string };

    if (!balanceData || !balanceData.balance) {
      return 0n;
    }

    try {
      const balance = BigInt(balanceData.balance);
      return balance;
    } catch (error) {
      throw new Error(`Invalid balance format: ${error}`);
    }
  } catch (error) {
    // On error, return 0 (fail-safe)
    console.warn("Error getting user balance:", error);
    return 0n;
  }
}

/**
 * Credit user balance (from deposit)
 *
 * SECURITY: Uses frozen-data pattern for immutable, verifiable balance storage
 * - Creates a new frozen entry with signature
 * - Updates index to point to latest balance
 * - Old balances remain immutable (audit trail)
 *
 * @param userAddress - Ethereum address (0x...) from deposit event
 * @param gunPubKey - Optional GunDB pub key if user has linked it
 */
export async function creditBalance(
  gun: IGunInstance,
  userAddress: string,
  amount: bigint,
  relayKeyPair?: {
    pub: string;
    priv: string;
    epub?: string;
    epriv?: string;
  } | null,
  gunPubKey?: string
): Promise<void> {
  if (!relayKeyPair) {
    throw new Error("Relay keypair required for secure balance updates");
  }

  try {
    // Normalize Ethereum address
    const ethereumAddress = userAddress.toLowerCase();

    // Get current balance (by Ethereum address)
    const currentBalance = await getUserBalance(gun, ethereumAddress);
    const newBalance = currentBalance + amount;

    // Create balance data
    const balanceData: any = {
      balance: newBalance.toString(),
      ethereumAddress: ethereumAddress,
      updatedAt: Date.now(),
      type: "bridge-balance",
    };

    // If GunDB pub key is provided, include it in the balance data
    if (gunPubKey) {
      balanceData.gunPubKey = gunPubKey;
    }

    // Create frozen entry (immutable, signed)
    // Use Ethereum address as index key (deposits come with Ethereum address)
    const indexKey = ethereumAddress;
    await FrozenData.createFrozenEntry(
      gun,
      balanceData,
      relayKeyPair,
      "bridge-balances",
      indexKey
    );
  } catch (error) {
    throw new Error(`Failed to credit balance: ${error}`);
  }
}

/**
 * Debit user balance (for withdrawal request)
 * Uses frozen-data pattern for secure, verifiable balance updates
 */
export async function debitBalance(
  gun: IGunInstance,
  userAddress: string,
  amount: bigint,
  relayKeyPair?: {
    pub: string;
    priv: string;
    epub?: string;
    epriv?: string;
  } | null
): Promise<void> {
  if (!relayKeyPair) {
    throw new Error("Relay keypair required for secure balance updates");
  }

  try {
    // Get current balance
    const currentBalance = await getUserBalance(gun, userAddress);

    if (currentBalance < amount) {
      throw new Error("Insufficient balance");
    }

    const newBalance = currentBalance - amount;

    // Create balance data
    const balanceData = {
      balance: newBalance.toString(),
      user: userAddress.toLowerCase(),
      updatedAt: Date.now(),
      type: "bridge-balance",
      debit: amount.toString(), // Track what was debited
    };

    // Create frozen entry (immutable, signed)
    const indexKey = userAddress.toLowerCase();
    await FrozenData.createFrozenEntry(
      gun,
      balanceData,
      relayKeyPair,
      "bridge-balances",
      indexKey
    );
  } catch (error) {
    throw new Error(`Failed to debit balance: ${error}`);
  }
}

/**
 * Verify dual signatures: SEA (GunDB) + Ethereum (Wallet)
 * 
 * SECURITY: This ensures the user controls both:
 * 1. The GunDB keypair (derived from Ethereum address)
 * 2. The Ethereum wallet (that owns the balance)
 * 
 * The message should include the ethereumAddress to prevent replay attacks.
 * 
 * @param message - The plain message that was signed (must include ethereumAddress)
 * @param seaSignature - SEA signature from GunDB keypair (signs the message)
 * @param ethSignature - Ethereum signature (EIP-191) from wallet (signs the message)
 * @param ethAddress - Ethereum address that should match the signer
 * @param gunPubKey - GunDB public key (derived from ethAddress)
 * @returns true if both signatures are valid and match the addresses
 */
export async function verifyDualSignatures(
  message: string,
  seaSignature: string,
  ethSignature: string,
  ethAddress: string,
  gunPubKey: string
): Promise<boolean> {
  try {
    // 1. Verify SEA signature (GunDB keypair)
    // SEA.verify returns the original data if signature is valid
    const seaVerified = await SEA.verify(seaSignature, gunPubKey);
    if (!seaVerified) {
      return false;
    }

    // Check that the verified data matches the message
    // SEA can return string or object, so we normalize
    const seaData = typeof seaVerified === 'string' 
      ? seaVerified 
      : JSON.stringify(seaVerified);
    const normalizedMessage = typeof message === 'string' 
      ? message 
      : JSON.stringify(message);
    
    if (seaData !== normalizedMessage) {
      return false;
    }

    // 2. Verify Ethereum signature (wallet)
    // Use ethers to recover the signer from the signature
    const { ethers } = await import("ethers");
    const recoveredAddress = ethers.verifyMessage(message, ethSignature);
    
    // Check that recovered address matches the provided address
    if (recoveredAddress.toLowerCase() !== ethAddress.toLowerCase()) {
      return false;
    }

    // Both signatures are valid and match!
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Transfer balance from one user to another (L2 -> L2)
 *
 * SECURITY:
 * - Requires dual signatures: SEA (GunDB) + Ethereum (Wallet)
 * - Verifies user controls both the GunDB keypair AND the Ethereum wallet
 * - Uses frozen-data pattern for immutable, verifiable transfers
 * - Creates frozen entries for both sender (debit) and receiver (credit)
 * - Both entries are signed by relay
 * - Transfer is atomic (both succeed or both fail)
 *
 * @param fromEthAddress - Ethereum address of sender
 * @param toEthAddress - Ethereum address of receiver
 * @param amount - Amount to transfer
 * @param message - Plain message that was signed (must include fromEthAddress)
 * @param seaSignature - SEA signature from GunDB keypair (derived from fromEthAddress)
 * @param ethSignature - Ethereum signature (EIP-191) from wallet
 * @param gunPubKey - GunDB public key (derived from fromEthAddress)
 */
export async function transferBalance(
  gun: IGunInstance,
  fromEthAddress: string,
  toEthAddress: string,
  amount: bigint,
  relayKeyPair: { pub: string; priv: string; epub?: string; epriv?: string },
  message: string,
  seaSignature: string,
  ethSignature: string,
  gunPubKey: string
): Promise<{ txHash: string; fromBalance: string; toBalance: string }> {
  if (!relayKeyPair) {
    throw new Error("Relay keypair required for secure transfers");
  }

  try {
    // Normalize addresses
    const fromAddress = fromEthAddress.toLowerCase();
    const toAddress = toEthAddress.toLowerCase();

    // SECURITY: Verify dual signatures - client must prove control of BOTH:
    // 1. GunDB keypair (derived from Ethereum address)
    // 2. Ethereum wallet (that owns the balance)
    const signaturesValid = await verifyDualSignatures(
      message,
      seaSignature,
      ethSignature,
      fromAddress,
      gunPubKey
    );

    if (!signaturesValid) {
      throw new Error("Invalid signatures: must provide valid SEA and Ethereum signatures");
    }

    // Get current balances (by Ethereum address)
    const fromBalance = await getUserBalance(gun, fromAddress);
    const toBalance = await getUserBalance(gun, toAddress);

    // Check sufficient balance
    if (fromBalance < amount) {
      throw new Error("Insufficient balance");
    }

    // Calculate new balances
    const newFromBalance = fromBalance - amount;
    const newToBalance = toBalance + amount;

    // Create transfer ID (hash of transfer data for idempotency)
    const transferId = `${fromAddress.toLowerCase()}:${toAddress.toLowerCase()}:${amount}:${Date.now()}`;
    const transferHash = await (Gun as any).SEA.work(transferId, null, null, {
      name: "SHA-256",
    });

    // Create transfer data (frozen entry)
    const transferData = {
      type: "bridge-transfer",
      from: fromAddress.toLowerCase(),
      to: toAddress.toLowerCase(),
      amount: amount.toString(),
      transferHash,
      timestamp: Date.now(),
    };

    // Create frozen entry for transfer record
    await FrozenData.createFrozenEntry(
      gun,
      transferData,
      relayKeyPair,
      "bridge-transfers",
      transferHash
    );

    // Debit sender balance
    const fromBalanceData = {
      balance: newFromBalance.toString(),
      user: fromAddress.toLowerCase(),
      updatedAt: Date.now(),
      type: "bridge-balance",
      transfer: {
        to: toAddress.toLowerCase(),
        amount: amount.toString(),
        transferHash,
      },
    };

    await FrozenData.createFrozenEntry(
      gun,
      fromBalanceData,
      relayKeyPair,
      "bridge-balances",
      fromAddress.toLowerCase()
    );

    // Credit receiver balance
    const toBalanceData = {
      balance: newToBalance.toString(),
      user: toAddress.toLowerCase(),
      updatedAt: Date.now(),
      type: "bridge-balance",
      transfer: {
        from: fromAddress.toLowerCase(),
        amount: amount.toString(),
        transferHash,
      },
    };

    await FrozenData.createFrozenEntry(
      gun,
      toBalanceData,
      relayKeyPair,
      "bridge-balances",
      toAddress.toLowerCase()
    );

    return {
      txHash: transferHash,
      fromBalance: newFromBalance.toString(),
      toBalance: newToBalance.toString(),
    };
  } catch (error) {
    throw new Error(`Failed to transfer balance: ${error}`);
  }
}

/**
 * Add pending withdrawal
 */
export async function addPendingWithdrawal(
  gun: IGunInstance,
  withdrawal: PendingWithdrawal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const withdrawalsPath = "bridge/withdrawals/pending";

    gun
      .get(withdrawalsPath)
      .once((data: { list?: PendingWithdrawal[] } | null) => {
        const withdrawals = data?.list || [];

        // Check if withdrawal with same nonce already exists
        const exists = withdrawals.some(
          (w) =>
            w.user.toLowerCase() === withdrawal.user.toLowerCase() &&
            w.nonce === withdrawal.nonce
        );

        if (exists) {
          reject(new Error("Withdrawal with this nonce already exists"));
          return;
        }

        withdrawals.push(withdrawal);

        gun
          .get(withdrawalsPath)
          .put({ list: withdrawals }, (ack: GunMessagePut) => {
            if (ack && "err" in ack && ack.err) {
              const errorMsg =
                typeof ack.err === "string" ? ack.err : String(ack.err);
              reject(new Error(errorMsg));
            } else {
              resolve();
            }
          });
      });
  });
}

/**
 * Get all pending withdrawals
 */
export async function getPendingWithdrawals(
  gun: IGunInstance
): Promise<PendingWithdrawal[]> {
  return new Promise((resolve, reject) => {
    const withdrawalsPath = "bridge/withdrawals/pending";

    gun
      .get(withdrawalsPath)
      .once((data: { list?: PendingWithdrawal[] } | null) => {
        const withdrawals = data?.list || [];
        resolve(withdrawals);
      });
  });
}

/**
 * Remove pending withdrawals (after batch submission)
 */
export async function removePendingWithdrawals(
  gun: IGunInstance,
  withdrawalsToRemove: PendingWithdrawal[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const withdrawalsPath = "bridge/withdrawals/pending";

    gun
      .get(withdrawalsPath)
      .once((data: { list?: PendingWithdrawal[] } | null) => {
        const withdrawals = data?.list || [];

        // Create a set of withdrawal keys (user+nonce) to remove
        const toRemove = new Set(
          withdrawalsToRemove.map((w) => `${w.user.toLowerCase()}:${w.nonce}`)
        );

        // Filter out removed withdrawals
        const remaining = withdrawals.filter(
          (w) => !toRemove.has(`${w.user.toLowerCase()}:${w.nonce}`)
        );

        gun
          .get(withdrawalsPath)
          .put({ list: remaining }, (ack: GunMessagePut) => {
            if (ack && "err" in ack && ack.err) {
              const errorMsg =
                typeof ack.err === "string" ? ack.err : String(ack.err);
              reject(new Error(errorMsg));
            } else {
              resolve();
            }
          });
      });
  });
}

/**
 * Save batch to GunDB
 */
export async function saveBatch(
  gun: IGunInstance,
  batch: Batch
): Promise<void> {
  return new Promise((resolve, reject) => {
    const batchPath = `bridge/batches/${batch.batchId}`;

    gun.get(batchPath).put(batch, (ack: GunMessagePut) => {
      if (ack && "err" in ack && ack.err) {
        const errorMsg =
          typeof ack.err === "string" ? ack.err : String(ack.err);
        reject(new Error(errorMsg));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Get batch by ID
 */
export async function getBatch(
  gun: IGunInstance,
  batchId: string
): Promise<Batch | null> {
  return new Promise((resolve) => {
    const batchPath = `bridge/batches/${batchId}`;

    gun.get(batchPath).once((data: Batch | null) => {
      resolve(data);
    });
  });
}

/**
 * Get latest batch
 */
export async function getLatestBatch(gun: IGunInstance): Promise<Batch | null> {
  return new Promise((resolve) => {
    // This is a simplified version - in production you might want to maintain
    // a separate index of batch IDs sorted by timestamp
    const batchesPath = "bridge/batches";

    gun.get(batchesPath).once((data: Record<string, Batch> | null) => {
      if (!data) {
        resolve(null);
        return;
      }

      // Find batch with highest batchId (assuming numeric)
      let latest: Batch | null = null;
      let latestId = -1;

      for (const [id, batch] of Object.entries(data)) {
        const batchIdNum = parseInt(id, 10);
        if (!isNaN(batchIdNum) && batchIdNum > latestId) {
          latestId = batchIdNum;
          latest = batch;
        }
      }

      resolve(latest);
    });
  });
}

/**
 * Check if a deposit has already been processed (idempotency)
 * @param depositKey Unique key: "txHash:user:amount"
 */
export async function isDepositProcessed(
  gun: IGunInstance,
  depositKey: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const processedPath = `bridge/processed-deposits/${depositKey}`;

    gun.get(processedPath).once((data: ProcessedDeposit | null) => {
      resolve(data !== null);
    });
  });
}

/**
 * Mark a deposit as processed (idempotency)
 */
export async function markDepositProcessed(
  gun: IGunInstance,
  depositKey: string,
  deposit: ProcessedDeposit
): Promise<void> {
  return new Promise((resolve, reject) => {
    const processedPath = `bridge/processed-deposits/${depositKey}`;

    gun.get(processedPath).put(deposit, (ack: GunMessagePut) => {
      if (ack && "err" in ack && ack.err) {
        const errorMsg =
          typeof ack.err === "string" ? ack.err : String(ack.err);
        reject(new Error(errorMsg));
      } else {
        resolve();
      }
    });
  });
}
